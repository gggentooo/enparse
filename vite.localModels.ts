/**
 * vite.localModels.ts — dev-server route that serves the trained models locally (`npm run dev:models`)
 *
 * Description:
 *   Lets the owner test the offered models in the real app before Phase 11
 *   packages them (public/models/ is empty until then). Emulates the deployed
 *   /models/* route (functions/models/; T12) from the training exports:
 *     /models/catalog.json        → src/modules/modelLibrary/catalog.fixture.json
 *                                   (names, metrics, speed), with each file's
 *                                   bytes and SHA-256 recomputed from disk
 *     /models/<id>/labels.json    → the export's labels.json; a null
 *                                   model_version becomes "local-<run>"
 *     /models/<id>/<file>         → training/data/onnx/<id>/<selected run>/<file>
 *     /models/_ort/<file>         → node_modules/onnxruntime-web/dist/<file>
 *   The selected run per model is read from
 *   training/data/eval/<id>/phase7_biaffine.json (Phase 7), as in the
 *   benchmark page (training/js/bench-page/). Models without an export are
 *   left out of the catalog (and reported at startup).
 *
 * Layer: build tooling (Vite plugin; dev server only, `apply: "serve"`).
 *   Never part of the app bundle or the deployed site.
 *
 * Usage: `npm run dev:models` (vite --mode local-models). See README.md →
 *   "Test the models locally".
 *
 * Hashes are cached per file (size + mtime), so re-exports are picked up
 * without restarting; the first catalog request hashes every file (~1 s per
 * 300 MB).
 *
 * Status: implemented (local model testing, 2026-11-21).
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const REPO = import.meta.dirname;
const TRAINING = join(REPO, "training");
const FIXTURE = join(REPO, "src", "modules", "modelLibrary", "catalog.fixture.json");
const ORT_DIST = join(REPO, "node_modules", "onnxruntime-web", "dist");
/** Same folder name as transformerBackend.ts → ORT_FOLDER. */
const ORT_FOLDER = "_ort";
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: "application/json",
  wasm: "application/wasm",
  mjs: "text/javascript",
};

type FileRef = { file: string; bytes: number; sha256: string };
type Entry = {
  id: string;
  labels: FileRef;
  variants: Record<string, FileRef | undefined>;
  shared_files: FileRef[];
  [key: string]: unknown;
};

/** Selected Phase 7 run of a model, or null when it has not been trained and exported. */
function selectedRun(id: string): string | null {
  const record = join(TRAINING, "data", "eval", id, "phase7_biaffine.json");
  if (!existsSync(record)) return null;
  const run = (JSON.parse(readFileSync(record, "utf8")) as { selected_run?: unknown }).selected_run;
  return typeof run === "string" && existsSync(join(TRAINING, "data", "onnx", id, run)) ? run : null;
}

/** labels.json as served: the export's, with a model_version so pre-flight accepts it. */
function labelsBody(id: string, run: string): Buffer {
  const labels = JSON.parse(readFileSync(join(TRAINING, "data", "onnx", id, run, "labels.json"), "utf8")) as {
    model_version?: string | null;
  };
  return Buffer.from(JSON.stringify({ ...labels, model_version: labels.model_version ?? `local-${run}` }));
}

const hashCache = new Map<string, { key: string; ref: { bytes: number; sha256: string } }>();

/** Size and SHA-256 of a file, cached until its size or mtime changes. */
async function digest(path: string): Promise<{ bytes: number; sha256: string }> {
  const st = statSync(path);
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = hashCache.get(path);
  if (hit?.key === key) return hit.ref;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  const ref = { bytes: st.size, sha256: hash.digest("hex") };
  hashCache.set(path, { key, ref });
  return ref;
}

/** The catalog fixture limited to exported models, with every file reference matching disk. */
async function buildCatalog(): Promise<{ catalog: unknown; missing: string[] }> {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { models: Entry[]; [k: string]: unknown };
  const models: Entry[] = [];
  const missing: string[] = [];
  for (const entry of fixture.models) {
    const run = selectedRun(entry.id);
    if (!run) {
      missing.push(entry.id);
      continue;
    }
    const dir = join(TRAINING, "data", "onnx", entry.id, run);
    const ref = async (f: FileRef): Promise<FileRef | null> =>
      existsSync(join(dir, f.file)) ? { file: f.file, ...(await digest(join(dir, f.file))) } : null;
    const body = labelsBody(entry.id, run);
    const shared = await Promise.all(entry.shared_files.map(ref));
    if (shared.some((f) => f === null)) {
      missing.push(entry.id);
      continue;
    }
    const variants: Record<string, FileRef> = {};
    for (const [name, f] of Object.entries(entry.variants)) {
      const r = f ? await ref(f) : null;
      if (r) variants[name] = r;
    }
    if (Object.keys(variants).length === 0) {
      missing.push(entry.id);
      continue;
    }
    models.push({
      ...entry,
      model_version: `local-${run}`,
      labels: { file: "labels.json", bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") },
      shared_files: shared as FileRef[],
      variants,
    });
  }
  return { catalog: { ...fixture, generated_at: new Date().toISOString(), models }, missing };
}

/** Absolute path for a /models/<rel> request, or null if it leaves its folder or is unknown. */
function resolveFile(rel: string): string | null {
  const [first, ...rest] = rel.split("/");
  if (!first || rest.length === 0) return null;
  const base =
    first === ORT_FOLDER
      ? ORT_DIST
      : (() => {
          const run = selectedRun(first);
          return run ? join(TRAINING, "data", "onnx", first, run) : null;
        })();
  if (!base) return null;
  const path = resolve(base, ...rest);
  return path.startsWith(base + sep) && existsSync(path) ? path : null;
}

/** Vite plugin: the local /models/* route (dev server only). */
export function localModels(): Plugin {
  return {
    name: "enparse-local-models",
    apply: "serve",
    configureServer(server) {
      void buildCatalog().then(({ catalog, missing }) => {
        const ids = (catalog as { models: Entry[] }).models.map((m) => m.id);
        server.config.logger.info(`[local-models] serving ${ids.join(", ") || "no models"} from training/data/onnx`);
        if (missing.length) server.config.logger.warn(`[local-models] no export for: ${missing.join(", ")}`);
      });
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!path.startsWith("/models/")) return next();
        const rel = decodeURIComponent(path.slice("/models/".length));
        // Same-origin assets only (the app's COEP require-corp accepts them).
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Cache-Control", "no-store");
        const fail = (status: number, message: string): void => {
          res.statusCode = status;
          res.end(message);
        };
        if (rel === "catalog.json") {
          buildCatalog().then(
            ({ catalog }) => {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(catalog));
            },
            (e: unknown) => fail(500, `catalog: ${e instanceof Error ? e.message : String(e)}`),
          );
          return;
        }
        const [id, ...rest] = rel.split("/");
        if (id && id !== ORT_FOLDER && rest.join("/") === "labels.json") {
          const run = selectedRun(id);
          if (!run) return fail(404, "Not Found");
          res.setHeader("Content-Type", "application/json");
          return res.end(labelsBody(id, run));
        }
        const file = resolveFile(rel);
        if (!file) return fail(404, "Not Found");
        const ext = file.slice(file.lastIndexOf(".") + 1);
        res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
        res.setHeader("Content-Length", String(statSync(file).size));
        if (req.method === "HEAD") return res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
}
