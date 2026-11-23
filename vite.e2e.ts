/**
 * vite.e2e.ts — dev-server mode for end-to-end tests without model files (`vite --mode e2e`; T62)
 *
 * Description:
 *   CI checks out without Git LFS and the models are packaged only in T66, so
 *   the end-to-end tests run the real app with two stand-ins (owner,
 *   2026-11-23):
 *     - the parser worker's model backend: parser.worker.ts's import of
 *       ./transformerBackend resolves to e2e/fakeBackend.ts (a deterministic
 *       word-list tagger with the same ParserBackend contract);
 *     - /models/*: a catalog with one small model ("E2E") whose files are a
 *       few bytes each, with real sizes and SHA-256, so downloads, integrity
 *       checks, pre-flight, and loading run as usual; its labels.json passes
 *       the model checks (files: null, so no per-file check);
 *     - /dict/*: the test dictionary of the unit tests
 *       (src/modules/dictionary/testDictionary.ts → serverFiles).
 *   The same tests run against the real models and dictionary with
 *   `npm run test:e2e:models` (vite --mode local-models). Never part of builds.
 *
 * Layer: build tooling (Vite plugin; dev server only, `apply: "serve"`).
 *
 * Status: implemented (T62).
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

const REPO = import.meta.dirname;
const { dependencies } = pkg;
const FAKE_BACKEND = resolve(REPO, "e2e", "fakeBackend.ts");
/** Folder and id of the e2e model. */
export const E2E_MODEL = { id: "e2e_model", folder: "e2e", name: "E2E" };

const sha = (body: string): string => createHash("sha256").update(body).digest("hex");
const ref = (file: string, body: string) => ({ file, bytes: Buffer.byteLength(body), sha256: sha(body) });

/** Files of the e2e model folder (relative path → body). */
function modelFiles(): Record<string, string> {
  return {
    "labels.json": JSON.stringify({
      schema_version: 2,
      model_version: "e2e-1",
      tokenizer_word_encoding: "plain",
      calibration: { temperature: 1, rel_temperature: 1, arc_temperature: 1 },
      ambiguity: { margin: 0.4, attachment_margin: 0.3 },
      nested: { bracket_threshold: 0.5, role_threshold: 0.3 },
      versions: {
        wink: {
          "wink-nlp": dependencies["wink-nlp"],
          "wink-eng-lite-web-model": dependencies["wink-eng-lite-web-model"],
        },
      },
      files: null,
    }),
    "config.json": '{"model_type":"e2e"}',
    "tokenizer.json": '{"version":"e2e"}',
    "onnx/model_quantized.onnx": "e2e model weights",
  };
}

function catalog(files: Record<string, string>): string {
  const f = (p: string) => ref(p, files[p] as string);
  return JSON.stringify({
    schema_version: 1,
    generated_at: "2026-11-23T00:00:00Z",
    models: [
      {
        id: E2E_MODEL.id,
        display_name: E2E_MODEL.name,
        description: "Test model for end-to-end tests.",
        description_ko: "종단 간 테스트용 모델입니다.",
        base_model: "e2e/fake",
        license: "CC BY-SA 4.0",
        model_version: "e2e-1",
        folder: E2E_MODEL.folder,
        labels: f("labels.json"),
        variants: { int8: f("onnx/model_quantized.onnx") },
        shared_files: [f("config.json"), f("tokenizer.json")],
        metrics: { upos: 0.97, chunk_f1: 0.97, uas: 0.94, las: 0.92 },
        nested_view: true,
        performance: { parse_5000_chars_s: { wasm: 0.1, wasm_2core: 0.2, wasm_1thread: 0.2 } },
      },
    ],
  });
}

/** Vite plugin: the e2e stand-ins (dev server only). */
export function e2eStandIns(): Plugin {
  const model = modelFiles();
  const catalogBody = catalog(model);
  let dict: Record<string, string> = {};
  return {
    name: "enparse-e2e",
    apply: "serve",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./transformerBackend" && importer?.replace(/\?.*$/, "").endsWith("parser.worker.ts")) {
        return FAKE_BACKEND;
      }
      return null;
    },
    async configureServer(server) {
      // Loaded through the dev server (not imported by the config), like the app's own modules.
      const mod = (await server.ssrLoadModule("/modules/dictionary/testDictionary.ts")) as {
        serverFiles: () => Record<string, string>;
      };
      dict = mod.serverFiles();
      server.config.logger.info("[e2e] fake model backend, e2e catalog at /models, test dictionary at /dict");
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        let body: string | undefined;
        if (path === "/models/catalog.json") body = catalogBody;
        else if (path.startsWith(`/models/${E2E_MODEL.folder}/`))
          body = model[path.slice(`/models/${E2E_MODEL.folder}/`.length)];
        else if (path.startsWith("/dict/v1/")) body = dict[path.slice("/dict/v1/".length)];
        else if (!path.startsWith("/models/") && !path.startsWith("/dict/")) return next();
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Cache-Control", "no-store");
        if (body === undefined) {
          res.statusCode = 404;
          return res.end("Not Found");
        }
        res.setHeader("Content-Type", path.endsWith(".json") ? "application/json" : "application/octet-stream");
        res.setHeader("Content-Length", String(Buffer.byteLength(body)));
        return res.end(req.method === "HEAD" ? undefined : body);
      });
    },
  };
}
