/**
 * src/modules/parser/packagedModels.test.ts — integration test of every packaged model (Phase 11, T66)
 *
 * Description:
 *   For each model in public/models/catalog.json (written by
 *   training/scripts/package_models.py), in Node with the real Transformers.js
 *   (onnxruntime-node, int8 — the variant Phase 9 compared in Node):
 *     1. every catalog file and every labels.json → files entry matches the
 *        packaged file (bytes and SHA-256; what the model library verifies on
 *        download), and labels.json carries the catalog's model_version;
 *     2. transformerBackend.ts loads it from the packaged folder and reproduces
 *        the Phase 9 Transformers.js outputs (combined label and argmax head per
 *        word) on the first parity windows covering 20 sentences
 *        (training/data/release/integration/<id>.json);
 *     3. the Parser gives a ParseResult with the model_version, wink character
 *        offsets for every word, a valid tree per sentence, and the nested view.
 *   Switching models in the app (the previous one is unloaded) and downloading
 *   through the model library are covered in the browser by e2e/release.spec.ts.
 *   Skipped when the models are not packaged (CI: no Git LFS files).
 *
 * Status: implemented (T66).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Parser } from "./parser";
import { createTransformerBackend, transformersRuntime } from "./transformerBackend";
import type { SentenceSpan } from "./types";

const PUBLIC = fileURLToPath(new URL("../../../public/models/", import.meta.url));
const REFERENCE = fileURLToPath(new URL("../../../training/data/release/integration/", import.meta.url));

type FileRef = { file: string; bytes: number; sha256: string };
type Entry = {
  id: string;
  folder: string;
  model_version: string;
  nested_view: boolean;
  labels: FileRef;
  variants: { int8?: FileRef; fp16?: FileRef };
  shared_files: FileRef[];
};
type Reference = {
  model_version: string;
  windows: { sentences: { words: string[]; labels: string[]; heads: number[] }[] }[];
};

function packagedModels(): Entry[] {
  const path = `${PUBLIC}catalog.json`;
  if (!existsSync(path)) return [];
  const models = (JSON.parse(readFileSync(path, "utf8")) as { models: Entry[] }).models;
  // Git LFS pointer files (checkout without LFS) are a few hundred bytes: treat as not packaged.
  return models.filter((m) => {
    const int8 = m.variants.int8;
    return int8 && existsSync(`${PUBLIC}${m.folder}/${int8.file}`)
      ? statSync(`${PUBLIC}${m.folder}/${int8.file}`).size === int8.bytes
      : false;
  });
}

const MODELS = packagedModels();
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Spans for consecutive sentences of one text (words separated by one space). */
function spans(sentences: readonly { words: string[] }[]): SentenceSpan[] {
  let pos = 0;
  return sentences.map((s) => {
    const start = pos;
    const words = s.words.map((text) => {
      const w = { text, start: pos, end: pos + text.length };
      pos += text.length + 1;
      return w;
    });
    return { start, end: pos - 1, words };
  });
}

const argmaxHead = (row: readonly number[]): number => {
  let best = 0;
  row.forEach((v, j) => {
    if (v > (row[best] as number)) best = j;
  });
  return best - 1; // column 0 = root → -1
};

describe.skipIf(MODELS.length === 0).each(MODELS)("packaged model $id", (entry) => {
  const dir = `${PUBLIC}${entry.folder}/`;
  const runtime = transformersRuntime({ baseUrl: PUBLIC, device: "cpu", readText: (url) => readFile(url, "utf8") });
  const model = { id: entry.id, folder: entry.folder, variant: "int8" as const, nestedView: entry.nested_view };

  it("ships the files the catalog and labels.json list (bytes, SHA-256, model_version)", () => {
    const refs = [entry.labels, ...Object.values(entry.variants), ...entry.shared_files] as FileRef[];
    for (const f of refs) {
      expect({ file: f.file, bytes: statSync(`${dir}${f.file}`).size }).toEqual({ file: f.file, bytes: f.bytes });
      expect({ file: f.file, sha256: sha256(`${dir}${f.file}`) }).toEqual({ file: f.file, sha256: f.sha256 });
    }
    const labels = JSON.parse(readFileSync(`${dir}labels.json`, "utf8")) as {
      model_version: string;
      files: Record<string, { bytes: number; sha256: string }>;
    };
    expect(labels.model_version).toBe(entry.model_version);
    for (const f of refs.filter((r) => r.file !== "labels.json")) {
      expect({ file: f.file, ...labels.files[f.file] }).toEqual({ file: f.file, bytes: f.bytes, sha256: f.sha256 });
    }
  });

  it.skipIf(!existsSync(`${REFERENCE}${entry.id}.json`))(
    "reproduces the Phase 9 outputs on 20 sentences",
    { timeout: 300_000 },
    async () => {
      const ref = JSON.parse(readFileSync(`${REFERENCE}${entry.id}.json`, "utf8")) as Reference;
      expect(ref.model_version).toBe(entry.model_version);
      const b = createTransformerBackend(runtime);
      await b.load(model, () => {});
      let sentences = 0;
      for (const w of ref.windows) {
        const tagged = await b.tag(spans(w.sentences));
        w.sentences.forEach((s, i) => {
          const t = tagged[i];
          expect(t?.words.map((x) => `${x.upos}|${x.chunkTag}`)).toEqual(s.labels);
          expect(t?.arc.map(argmaxHead)).toEqual(s.heads);
        });
        sentences += w.sentences.length;
      }
      expect(sentences).toBeGreaterThanOrEqual(20);
      await b.unload();
    },
  );

  it(
    "parses text into a ParseResult with model_version, offsets, valid trees, and phrases",
    { timeout: 300_000 },
    async () => {
      const b = createTransformerBackend(runtime);
      await b.load(model, () => {});
      const text =
        "Mackerel typically have vertical stripes on their backs and deeply forked tails. " +
        "Water in these disks could be found as water vapor or ice.\n\nShe looked it up in the dictionary.";
      const result = await new Parser(b, model).parse(text);
      expect(result.modelId).toBe(entry.id);
      expect(result.modelVersion).toBe(entry.model_version);
      expect(result.sentences).toHaveLength(3);
      for (const s of result.sentences) {
        for (const t of s.tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
        const heads = s.tokens.map((t) => t.head);
        expect(heads.filter((h) => h === -1).length).toBeGreaterThanOrEqual(1);
        // Every word reaches the root without a cycle.
        heads.forEach((_, i) => {
          let k = i;
          for (let steps = 0; k !== -1; steps++) {
            expect(steps).toBeLessThanOrEqual(heads.length);
            k = heads[k] as number;
          }
        });
        expect(s.phrases === null).toBe(!entry.nested_view);
      }
      await b.unload();
    },
  );
});
