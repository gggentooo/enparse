/**
 * src/modules/parser/transformerBackend.test.ts — tests for the ONNX backend (T63)
 *
 * Unit tests (fake tokenizer and model): word pieces and special tokens, window packing like
 * training (incl. a long sentence split with overlap), decoding (temperatures, summed
 * UPOS/chunk probabilities, arc rows and -Infinity outside the window), labels.json
 * validation, failure reasons, load/self-test/readiness.
 *
 * Integration test (skipped when the Phase 9 export is absent): the real Transformers.js
 * (Node, CPU) on training/data/onnx/deberta_v3_xsmall/<run>/ fp16 must reproduce PyTorch's
 * per-word labels and heads on the export's reference sentences (reference.json), and the
 * full Parser must label "The red dog rarely barks loudly." as a clause with a subject.
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Parser } from "./parser";
import {
  type ModelSession,
  type TokenizerLike,
  type TransformersRuntime,
  type WindowOutput,
  createTransformerBackend,
  decodeWindows,
  loadFailureReason,
  packWindows,
  specialIds,
  transformersRuntime,
  validateLabels,
  windowInput,
  wordPieces,
} from "./transformerBackend";
import { type LabelConfig, ParserLoadError, ParserNotReadyError, type SentenceSpan } from "./types";

// -- fakes ----------------------------------------------------------------------------------

const CLS = 1;
const SEP = 2;
/** Fake WordPiece-like tokenizer: one id per 3 characters; ids from char codes. */
const tok: TokenizerLike = {
  encode: (text, { add_special_tokens }) => {
    const body: number[] = [];
    const t = text.trim();
    for (let i = 0; i < t.length; i += 3) body.push(100 + (t.charCodeAt(i) % 50));
    return add_special_tokens ? [CLS, ...body, SEP] : body;
  },
};

const LABELS: LabelConfig = {
  schema_version: 2,
  labels: ["DET|B-NP", "NOUN|I-NP", "NOUN|B-NP", "VERB|B-VP", "PUNCT|O", "det", "nsubj", "root", "punct"],
  groups: { chunk: { start: 0, end: 5 }, rel: { start: 5, end: 9 } },
  dep_encoding: "biaffine_v1",
  arc: { output: "arc_scores", root_position: 0, scope: "sentence" },
  relation_subtypes: [],
  tokenizer_input: "pre_split_words",
  tokenizer_word_encoding: "plain",
  upos: [],
  chunk_tags: [],
  label_merges: {},
  window: { max_subword_tokens: 12, max_subwords_per_word: 4, long_sentence_overlap: 2 },
  versions: {
    base_model: "fake",
    data: { ud_release: "", ud_commit: "", feedback_batches: [] },
    wink: { "wink-nlp": "2.4.0", "wink-eng-lite-web-model": "1.8.1" },
  },
  calibration: { temperature: 2, rel_temperature: 1, arc_temperature: 1 },
  ambiguity: { margin: 0.3, attachment_margin: 0.3 },
  nested: { bracket_threshold: 0.5, role_threshold: 0.4 },
  model_version: "1.0.0",
  files: null,
};

const span = (words: string[]): SentenceSpan => {
  let pos = 0;
  const ws = words.map((text) => {
    const w = { text, start: pos, end: pos + text.length };
    pos += text.length + 1;
    return w;
  });
  return { start: 0, end: pos - 1, words: ws };
};

/** Fake session: label (token index % 5) wins group A, "det" wins relations; heads → token 0 (root) except token 1 → token 2. */
function fakeSession(width = LABELS.labels.length): ModelSession & { runs: number[][] } {
  const runs: number[][] = [];
  return {
    runs,
    async run(ids) {
      runs.push([...ids]);
      const T = ids.length;
      const logits = new Float32Array(T * width);
      const arc = new Float32Array(T * T);
      for (let t = 0; t < T; t++) {
        logits[t * width + (t % 5)] = 4;
        logits[t * width + 5] = 3;
        arc[t * T + 0] = 2;
        if (t === 1 && T > 2) arc[t * T + 2] = 5;
      }
      return { logits, width, tokens: T, arc };
    },
    async dispose() {},
  };
}

function fakeRuntime(overrides: Partial<TransformersRuntime> = {}, session = fakeSession()): TransformersRuntime {
  return {
    loadLabels: async () => structuredClone(LABELS),
    loadTokenizer: async () => tok,
    loadModel: async () => session,
    ...overrides,
  };
}

// -- unit -----------------------------------------------------------------------------------

describe("word pieces and windows", () => {
  it("takes special tokens from encoding an empty string and caps pieces per word", () => {
    expect(specialIds(tok)).toEqual({ prefix: [CLS], suffix: [SEP] });
    expect(wordPieces(tok, ["a", "abcdefghijklmnop"], 4, "plain").map((p) => p.length)).toEqual([1, 4]);
    const spaced: string[] = [];
    wordPieces({ encode: (t) => (spaced.push(t), [5]) }, ["x"], 4, "space");
    expect(spaced).toEqual([" x"]);
  });

  it("packs whole sentences until the budget, like training", () => {
    expect(packWindows([[3, 3], [2], [4, 1]], 8, 2).map((w) => w.map((r) => `${r.sentence}.${r.word}`))).toEqual([
      ["0.0", "0.1", "1.0"],
      ["2.0", "2.1"],
    ]);
  });

  it("splits a sentence longer than the budget, repeating at least `overlap` tokens", () => {
    const w = packWindows([[2, 2, 2, 2, 2]], 6, 2).map((x) => x.map((r) => r.word));
    expect(w).toEqual([
      [0, 1, 2],
      [2, 3, 4],
    ]);
    expect(() => packWindows([[9]], 6, 2)).toThrow(/more than 6 subword tokens/);
  });

  it("builds ids with specials and a first-token map", () => {
    const pieces = [[[10, 11], [12]]];
    expect(
      windowInput(
        [
          { sentence: 0, word: 0 },
          { sentence: 0, word: 1 },
        ],
        pieces,
        { prefix: [CLS], suffix: [SEP] },
      ),
    ).toEqual({
      ids: [CLS, 10, 11, 12, SEP],
      tokenWord: [-1, 0, 0, 1, -1],
      first: [1, 3],
    });
  });
});

describe("decodeWindows", () => {
  it("applies temperatures, sums UPOS/chunk probabilities, and builds arc rows", () => {
    const s = span(["The", "dog"]);
    const windows = [
      [
        { sentence: 0, word: 0 },
        { sentence: 0, word: 1 },
      ],
    ];
    const inputs = [windowInput(windows[0] ?? [], [[[10], [11]]], { prefix: [CLS], suffix: [SEP] })];
    const T = 4;
    const logits = new Float32Array(T * 9);
    logits[1 * 9 + 1] = 2; // word 0: NOUN|I-NP vs NOUN|B-NP tie-ish
    logits[1 * 9 + 2] = 2;
    logits[1 * 9 + 6] = 5; // nsubj
    const arc = new Float32Array(T * T);
    arc[1 * T + 2] = 3; // word 0 → word 1
    const out: WindowOutput = { logits, width: 9, tokens: T, arc };
    const [t] = decodeWindows([s], windows, inputs, [out], LABELS);
    const w0 = t?.words[0];
    expect(w0?.upos).toBe("NOUN");
    // Temperature 2: exp(1) each for the two NOUN labels, exp(0) for the other three.
    const z = 2 * Math.E + 3;
    expect(w0?.uposProb).toBeCloseTo((2 * Math.E) / z, 9);
    expect(w0?.relations[0]?.relation).toBe("nsubj");
    expect(t?.arc[0]).toEqual([0, -Infinity, 3]);
    expect(t?.arc[1]?.[2]).toBe(-Infinity); // self
  });

  it("takes each word of a split sentence from the window where it is farthest from the edge", () => {
    const s = span(["aa", "bb", "cc", "dd", "ee"]);
    const pieces = [[[10], [11], [12], [13], [14]]];
    const windows = packWindows([[1, 1, 1, 1, 1]], 3, 1);
    expect(windows.map((w) => w.map((r) => r.word))).toEqual([
      [0, 1, 2],
      [2, 3, 4],
    ]);
    const special = { prefix: [CLS], suffix: [SEP] };
    const inputs = windows.map((w) => windowInput(w, pieces, special));
    const outs = inputs.map((inp, wi) => {
      const T = inp.ids.length;
      const logits = new Float32Array(T * 9);
      for (let t = 0; t < T; t++) logits[t * 9 + (wi === 0 ? 0 : 3)] = 5; // window 0 → DET, window 1 → VERB
      return { logits, width: 9, tokens: T, arc: new Float32Array(T * T) };
    });
    const [t] = decodeWindows([s], windows, inputs, outs, LABELS);
    // Word 2 ("cc") is at the edge of both windows; word 1 only in window 0; word 3 only in window 1.
    expect(t?.words.map((w) => w.upos)).toEqual(["DET", "DET", "DET", "VERB", "VERB"]);
    expect(t?.arc[1]?.[4]).toBe(-Infinity); // word 3 is not in word 1's window
  });
});

describe("validateLabels and loadFailureReason", () => {
  it("accepts a complete labels.json and lists what is missing", () => {
    expect(validateLabels(LABELS)).toEqual([]);
    const bad = {
      ...LABELS,
      model_version: null,
      nested: { bracket_threshold: 0.5, role_threshold: null },
      schema_version: 1,
    };
    expect(validateLabels(bad)).toEqual(
      expect.arrayContaining(["schema_version must be 2", "nested thresholds not set", "model_version not set"]),
    );
    expect(validateLabels(null)).toEqual(["labels.json is not an object"]);
  });

  it("maps errors to status reasons", () => {
    expect(loadFailureReason(new Error("Failed to fetch"))).toBe("network");
    expect(loadFailureReason(new Error("WebGPU is not supported"))).toBe("unsupported");
    expect(loadFailureReason(new RangeError("Out of memory"))).toBe("out-of-memory");
    expect(loadFailureReason(new Error("Protobuf parsing failed"))).toBe("invalid-model");
    expect(loadFailureReason(new ParserLoadError("network", "x"))).toBe("network");
  });
});

describe("createTransformerBackend", () => {
  const model = { id: "m", folder: "m", variant: "int8" as const, nestedView: true };

  it("is not ready before load and refuses to tag", async () => {
    const b = createTransformerBackend(fakeRuntime());
    expect(b.isReady()).toBe(false);
    expect(() => b.info()).toThrow(ParserNotReadyError);
    await expect(b.tag([span(["a"])])).rejects.toBeInstanceOf(ParserNotReadyError);
  });

  it("loads, self-tests, reports progress and the device, and tags", async () => {
    const session = fakeSession();
    const b = createTransformerBackend(fakeRuntime({}, session));
    const progress: number[] = [];
    await b.load(model, (p) => progress.push(p.progress ?? -1));
    expect(b.isReady()).toBe(true);
    expect(b.info().backend).toBe("wasm");
    expect(progress.at(-1)).toBe(1);
    expect(session.runs.length).toBe(1); // self-test
    const [t] = await b.tag([span(["The", "dog", "barks"]), span(["Hi"])]);
    expect(t?.words).toHaveLength(3);
    expect(session.runs.length).toBe(2); // both sentences packed into one window
    await b.unload();
    expect(b.isReady()).toBe(false);
  });

  it("rejects an invalid labels.json as invalid-model and a wrong output width in the self-test", async () => {
    const noVersion = fakeRuntime({ loadLabels: async () => ({ ...LABELS, model_version: null }) });
    await expect(createTransformerBackend(noVersion).load(model, () => {})).rejects.toMatchObject({
      reason: "invalid-model",
    });
    const wrongWidth = fakeRuntime({}, fakeSession(3));
    const b = createTransformerBackend(wrongWidth);
    await expect(b.load(model, () => {})).rejects.toMatchObject({
      reason: "invalid-model",
      message: expect.stringMatching(/self-test/),
    });
    expect(b.isReady()).toBe(false);
  });

  it("maps runtime failures to typed reasons", async () => {
    const offline = fakeRuntime({ loadTokenizer: async () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(createTransformerBackend(offline).load(model, () => {})).rejects.toMatchObject({ reason: "network" });
  });
});

// -- integration (real Transformers.js, Phase 9 export) -------------------------------------

const EXPORT_ROOT = fileURLToPath(new URL("../../../training/data/onnx/deberta_v3_xsmall/", import.meta.url));
const RUN = "lr0.0003_w2_s42_bf";
const HAS_EXPORT = existsSync(`${EXPORT_ROOT}${RUN}/onnx/model_fp16.onnx`);

describe.skipIf(!HAS_EXPORT)("integration: DeBERTa-v3-xsmall export (fp16, Node CPU)", () => {
  // The export's labels.json has no model_version until Phase 11 packaging; fill it for the test.
  const runtime = transformersRuntime({
    baseUrl: EXPORT_ROOT,
    device: "cpu",
    readText: async (url) => {
      const l = JSON.parse(await readFile(url, "utf8"));
      return JSON.stringify({ ...l, model_version: l.model_version ?? "phase9-test" });
    },
  });
  const model = { id: "deberta", folder: RUN, variant: "fp16" as const, nestedView: true };

  it("reproduces PyTorch's labels and heads on the reference sentences", { timeout: 120_000 }, async () => {
    const b = createTransformerBackend(runtime);
    await b.load(model, () => {});
    const labels = b.info().labels;
    const ref = JSON.parse(readFileSync(`${EXPORT_ROOT}${RUN}/reference.json`, "utf8")) as {
      sentences: { words: string[]; torch_chunk_ids: number[]; torch_heads: number[] }[];
    };
    for (const s of ref.sentences) {
      const [t] = await b.tag([span(s.words)]);
      const got = t?.words.map((w) => `${w.upos}|${w.chunkTag}`);
      expect(got).toEqual(s.torch_chunk_ids.map((id) => labels.labels[id]));
      const heads = t?.arc.map((row) => {
        let best = 0;
        row.forEach((v, j) => {
          if (v > (row[best] as number)) best = j;
        });
        return best - 1; // column 0 = root → -1
      });
      expect(heads).toEqual(s.torch_heads);
    }
    await b.unload();
  });

  it(
    "parses end to end with the Parser (wink words, MST, gated and labeled phrases)",
    { timeout: 120_000 },
    async () => {
      const b = createTransformerBackend(runtime);
      await b.load(model, () => {});
      const result = await new Parser(b, model).parse("The red dog rarely barks loudly.");
      const [s] = result.sentences;
      expect(s?.tokens.map((t) => t.upos)).toEqual(["DET", "ADJ", "NOUN", "ADV", "VERB", "ADV", "PUNCT"]);
      expect(s?.tokens.map((t) => t.head)).toEqual([2, 2, 4, 4, -1, 4, 4]);
      const top = s?.phrases?.find((x) => "children" in x);
      expect(top && "category" in top ? top.category : null).toBe("S");
      await b.unload();
    },
  );
});
