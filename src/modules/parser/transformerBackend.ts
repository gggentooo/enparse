/**
 * src/modules/parser/transformerBackend.ts — primary ParserBackend (ONNX tagger)
 *
 * Description:
 *   Runs the in-house UPOS|CHUNK token classifier in the browser with
 *   Transformers.js and decodes logits into labels with probabilities.
 *
 * Layer: modules/ (parser). Runs only inside parser.worker.ts.
 *
 * Tasks:
 *   1. load(model: ModelRef): load the chosen model from its folder under
 *      public/models/<model-id>/ (own static host only). Files are already in
 *      Cache Storage (downloaded and verified by modules/modelLibrary);
 *      Transformers.js reads them from the cache (no remote models). WebGPU
 *      (fp16) first, WASM (int8) if WebGPU is unavailable. Throw
 *      ParserLoadError on failure.
 *   1b. unload(): dispose the ONNX session and tokenizer to free memory
 *      (before switching models or deleting the active one).
 *   2. Pack whole wink sentences into windows of up to
 *      labels.json → window.max_subword_tokens (256) subword tokens including
 *      special tokens, no overlap, exactly like training (prepare_data.py →
 *      build_windows; the whole input text is one document). Only a sentence
 *      longer than a window is split at word boundaries, repeating at least
 *      window.long_sentence_overlap (32) tokens of context.
 *   3. Take first-subword logits per word. For a split sentence, each word
 *      takes its scores from the window where it is farthest from the edge
 *      (arc scores to heads outside that window: −∞).
 *   4. Apply calibration temperature from labels.json; softmax.
 *   5. Decode: top combined label per word; UPOS and chunk probabilities by
 *      summing combined-label probabilities; keep top-k for ambiguity.ts.
 *   6. Report load progress per phase (download, initialize) for the UI.
 *   7. Self-test after loading: parse a fixed sentence and compare with the
 *      expected labels; failure → ParserLoadError (`invalid-model`). The
 *      backend is ready only after it passes.
 *   8. Map load failures to typed reasons (network, unsupported,
 *      out-of-memory, invalid-model) for the `failed` status.
 *   Device capability and file-integrity checks are not done here: they run
 *   in modules/preflight before and after loading (architecture.md → Model
 *   readiness → Pre-flight checks). This backend still validates the full
 *   labels.json against LabelConfig.
 *   9. Tests: decoding with fixed logits; integration test on 20 fixed
 *      sentences vs Phase 9 outputs per packaged model (plan-training.md
 *      Phase 11; packagedModels.test.ts, T66).
 *
 * Dependencies:
 *   External: @huggingface/transformers (Transformers.js).
 *   Internal: ./parser.ts (ParserBackend), ./types.ts.
 *   Assets: public/models/<model-id>/ (built by training/; one folder per
 *           offered model, listed in public/models/catalog.json).
 *   Used by: ./parser.worker.ts.
 *
 * Open items (todo.md): model library (hosting limits).
 *
 * Design:
 *   - Pure steps are exported and unit-tested with a mocked tokenizer and
 *     model (transformerBackend.test.ts): wordPieces, packWindows,
 *     windowInput, decodeWindows, validateLabels, loadFailureReason.
 *   - Word encoding follows training/js/lib/inference.mjs (the code that
 *     passed Phase 9 parity): each word encoded alone ("plain", or with a
 *     leading space for "space"), first max_subwords_per_word pieces, special
 *     tokens from encoding "".
 *   - Variant → device: fp16 → WebGPU, int8 → WASM. Which variant to load is
 *     chosen outside (pre-flight + parserService); the backend loads exactly
 *     the ModelRef it is given.
 *   - Self-test: a fixed sentence must give a logits width equal to
 *     labels.json, a square arc output, and finite scores. TODO(self-test-expected):
 *     labels.json has no expected labels yet (proposed: a `self_test` field
 *     written in Phase 11 from the export's reference.json).
 *   - Transformers.js is reached through a TransformersRuntime (default:
 *     the real library with remote models disabled and models read from the
 *     app's own /models/ folder); tests inject a fake one.
 *     Cache Storage (T31 spike, 2026-11-21): Transformers.js looks files up in
 *     the "transformers-cache" cache under `/models/<folder>/<file>` before
 *     fetching, so modelLibrary's verified downloads stored there are reused.
 *   - ONNX Runtime Web's WASM is loaded from `/models/_ort/` (never a CDN).
 *
 * Status: implemented (T63). Tests: transformerBackend.test.ts (unit; an
 *   integration test runs the real Phase 9 DeBERTa export when present).
 */

import { decodeArcTree } from "./treeDecoder";
import {
  type ArcScores,
  type BackendInfo,
  type ComputeBackend,
  type LabelCandidate,
  type LabelConfig,
  LABEL_SCHEMA_VERSION,
  type LoadFailureReason,
  type LoadProgress,
  type ModelRef,
  type ParserBackend,
  ParserLoadError,
  ParserNotReadyError,
  ParserRuntimeError,
  type RelationCandidate,
  type SentenceSpan,
  type TaggedSentence,
  type TaggedWord,
} from "./types";

/** Group A candidates and relation candidates kept per word (training: phase7.dep_top_k = 5). */
export const TOP_K = 5;

/** Fixed self-test sentence (runtime words; same as configs/eval.yaml → smoke.reference_sentences[0]). */
export const SELF_TEST_WORDS: readonly string[] = ["The", "red", "dog", "rarely", "barks", "loudly", "."];

/** Default base URL of the model folders (public/models/ on the app's own host). */
export const MODEL_BASE_URL = "/models/";

/**
 * ONNX Runtime Web files, served next to the models (`/models/_ort/`; R2 in production, since the
 * .wasm is 26.9 MB, over Pages' 25 MiB file limit). Copied from onnxruntime-web/dist at the version
 * pinned by @huggingface/transformers (Phase 11 packaging). The asyncify build is the one
 * Transformers.js 4.3.2 selects for WebGPU and WASM (Safari ≥ 26, Chrome).
 */
export const ORT_FOLDER = "_ort";
export const ORT_WASM_FILE = "ort-wasm-simd-threaded.asyncify";

// -- tokenizer and windows ------------------------------------------------------------------

/** The part of a Transformers.js tokenizer the backend uses. */
export interface TokenizerLike {
  encode(text: string, options: { add_special_tokens: boolean }): number[];
}

/** Special-token ids before and after the words (from encoding an empty string). */
export function specialIds(tok: TokenizerLike): { prefix: number[]; suffix: number[] } {
  const ids = tok.encode("", { add_special_tokens: true });
  if (ids.length === 0) return { prefix: [], suffix: [] };
  return { prefix: ids.slice(0, 1), suffix: ids.slice(1) };
}

/** Subword ids per word (pre-split words; first maxPerWord pieces). */
export function wordPieces(
  tok: TokenizerLike,
  words: readonly string[],
  maxPerWord: number,
  encoding: "plain" | "space",
): number[][] {
  return words.map((w) =>
    tok.encode(encoding === "space" ? ` ${w}` : w, { add_special_tokens: false }).slice(0, maxPerWord),
  );
}

/** A word inside a window: sentence index and word index in the sentence. */
export type WordRef = { sentence: number; word: number };

/**
 * Pack sentences into windows of ≤ budget subword tokens (special tokens excluded), like
 * training's build_windows (one document). A sentence longer than budget is split at word
 * boundaries, each next piece repeating at least `overlap` tokens of the previous one.
 * @param counts subword count per word, per sentence
 */
export function packWindows(counts: readonly (readonly number[])[], budget: number, overlap: number): WordRef[][] {
  const windows: WordRef[][] = [];
  let current: WordRef[] = [];
  let used = 0;
  const flush = (): void => {
    if (current.length) windows.push(current);
    current = [];
    used = 0;
  };
  counts.forEach((c, si) => {
    const total = c.reduce((a, b) => a + b, 0);
    if (current.length && used + total > budget) flush();
    if (total <= budget) {
      c.forEach((_, wi) => current.push({ sentence: si, word: wi }));
      used += total;
      return;
    }
    flush();
    if (Math.max(...c) > budget) throw new ParserRuntimeError(`a word has more than ${budget} subword tokens`);
    let start = 0;
    while (start < c.length) {
      let end = start;
      let size = 0;
      while (end < c.length && size + (c[end] as number) <= budget) size += c[end++] as number;
      windows.push(Array.from({ length: end - start }, (_, k) => ({ sentence: si, word: start + k })));
      if (end >= c.length) break;
      let back = end;
      let ctx = 0;
      while (back > start + 1 && ctx < overlap) ctx += c[--back] as number;
      start = back;
    }
  });
  flush();
  return windows;
}

/** Model input of one window: ids, token → window word (-1 = special), first token per window word. */
export type WindowInput = { ids: number[]; tokenWord: number[]; first: number[] };

/** Build one window's input from its words' pieces and the special tokens. */
export function windowInput(
  refs: readonly WordRef[],
  pieces: readonly (readonly (readonly number[])[])[],
  special: { prefix: number[]; suffix: number[] },
): WindowInput {
  const ids = [...special.prefix];
  const tokenWord = special.prefix.map(() => -1);
  const first: number[] = [];
  refs.forEach((r, k) => {
    first.push(ids.length);
    for (const id of pieces[r.sentence]?.[r.word] ?? []) {
      ids.push(id);
      tokenWord.push(k);
    }
  });
  ids.push(...special.suffix);
  tokenWord.push(...special.suffix.map(() => -1));
  return { ids, tokenWord, first };
}

// -- decoding -------------------------------------------------------------------------------

/** Raw outputs of one window: logits [T, C] and arc scores [T, T], row-major. */
export type WindowOutput = { logits: ArrayLike<number>; width: number; tokens: number; arc: ArrayLike<number> };

function softmax(values: number[], t: number): number[] {
  const scaled = values.map((v) => v / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const z = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / z);
}

function topK<T>(items: T[], score: (x: T) => number, k: number): T[] {
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, k);
}

/** Calibration temperatures and label slices used to decode (from labels.json). */
type Decoding = {
  chunkLabels: { upos: string; chunkTag: string }[];
  relations: string[];
  chunk: { start: number; end: number };
  rel: { start: number; end: number };
  root: number;
  t: number;
  relT: number;
  arcT: number;
};

function decodingOf(labels: LabelConfig): Decoding {
  const { chunk, rel } = labels.groups;
  return {
    chunkLabels: labels.labels.slice(chunk.start, chunk.end).map((l) => {
      const [upos, chunkTag] = l.split("|");
      return { upos: upos ?? l, chunkTag: chunkTag ?? "O" };
    }),
    relations: labels.labels.slice(rel.start, rel.end),
    chunk,
    rel,
    root: labels.arc.root_position,
    t: labels.calibration.temperature as number,
    relT: labels.calibration.rel_temperature as number,
    arcT: labels.calibration.arc_temperature as number,
  };
}

function decodeWord(out: WindowOutput, token: number, d: Decoding): TaggedWord {
  const row = (start: number, end: number): number[] =>
    Array.from({ length: end - start }, (_, c) => Number(out.logits[token * out.width + start + c]));
  const pa = softmax(row(d.chunk.start, d.chunk.end), d.t);
  let best = 0;
  pa.forEach((p, i) => {
    if (p > (pa[best] as number)) best = i;
  });
  const top = d.chunkLabels[best] as { upos: string; chunkTag: string };
  let uposProb = 0;
  let chunkProb = 0;
  pa.forEach((p, i) => {
    const l = d.chunkLabels[i] as { upos: string; chunkTag: string };
    if (l.upos === top.upos) uposProb += p;
    if (l.chunkTag === top.chunkTag) chunkProb += p;
  });
  const candidates: LabelCandidate[] = topK(
    pa.map((prob, i) => ({ ...(d.chunkLabels[i] as { upos: string; chunkTag: string }), prob })),
    (c) => c.prob,
    TOP_K,
  );
  const pr = softmax(row(d.rel.start, d.rel.end), d.relT);
  const relations: RelationCandidate[] = topK(
    pr.map((prob, i) => ({ relation: d.relations[i] as string, prob })),
    (c) => c.prob,
    TOP_K,
  );
  return { upos: top.upos, uposProb, chunkTag: top.chunkTag, chunkProb, candidates, relations };
}

/**
 * Decode every sentence from its windows' outputs. Each word takes its scores from the window
 * where its first subword is farthest from the window edge; arc scores to words outside that
 * window are -Infinity. Arc rows: column 0 = root, column j = word j (scaled by 1/arc_temperature).
 */
export function decodeWindows(
  sentences: readonly SentenceSpan[],
  windows: readonly WordRef[][],
  inputs: readonly WindowInput[],
  outputs: readonly WindowOutput[],
  labels: LabelConfig,
): TaggedSentence[] {
  const d = decodingOf(labels);
  // Best window per word: (window, position in window).
  const best = sentences.map((s) => s.words.map(() => ({ w: -1, k: -1, dist: -1 })));
  windows.forEach((refs, w) => {
    const inp = inputs[w] as WindowInput;
    const firstWordToken = inp.first[0] as number;
    let lastWordToken = firstWordToken;
    inp.tokenWord.forEach((k, t) => {
      if (k >= 0) lastWordToken = t;
    });
    refs.forEach((r, k) => {
      const t = inp.first[k] as number;
      const dist = Math.min(t - firstWordToken, lastWordToken - t);
      const b = best[r.sentence]?.[r.word];
      if (b && dist > b.dist) Object.assign(b, { w, k, dist });
    });
  });
  return sentences.map((s, si) => {
    const n = s.words.length;
    const words: TaggedWord[] = [];
    const arc: number[][] = [];
    for (let i = 0; i < n; i++) {
      const b = best[si]?.[i] as { w: number; k: number };
      if (b.w < 0) throw new ParserRuntimeError(`word ${i} of sentence ${si} is in no window`);
      const inp = inputs[b.w] as WindowInput;
      const out = outputs[b.w] as WindowOutput;
      const token = inp.first[b.k] as number;
      words.push(decodeWord(out, token, d));
      // Positions of this sentence's words in the same window.
      const pos = new Map<number, number>();
      (windows[b.w] as WordRef[]).forEach((r, k) => {
        if (r.sentence === si) pos.set(r.word, inp.first[k] as number);
      });
      const at = (col: number): number => Number(out.arc[token * out.tokens + col]) / d.arcT;
      const row = [at(d.root)];
      for (let j = 0; j < n; j++) {
        const col = pos.get(j);
        row.push(j === i || col === undefined ? -Infinity : at(col));
      }
      arc.push(row);
    }
    return { words, arc: arc as ArcScores };
  });
}

// -- labels.json validation ---------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Problems that make a labels.json unusable at runtime (empty = valid). */
export function validateLabels(obj: unknown): string[] {
  const p: string[] = [];
  if (typeof obj !== "object" || obj === null) return ["labels.json is not an object"];
  const l = obj as Partial<LabelConfig>;
  if (l.schema_version !== LABEL_SCHEMA_VERSION) p.push(`schema_version must be ${LABEL_SCHEMA_VERSION}`);
  if (!Array.isArray(l.labels) || l.labels.length === 0) p.push("labels missing");
  const g = l.groups;
  const n = Array.isArray(l.labels) ? l.labels.length : 0;
  if (!g || !isNum(g.chunk?.start) || !isNum(g.chunk?.end) || !isNum(g.rel?.start) || !isNum(g.rel?.end))
    p.push("groups missing");
  else if (g.chunk.start !== 0 || g.chunk.end !== g.rel.start || g.rel.end !== n) p.push("groups do not tile labels");
  if (l.dep_encoding !== "biaffine_v1") p.push("dep_encoding must be biaffine_v1");
  if (l.arc?.output !== "arc_scores" || !isNum(l.arc?.root_position)) p.push("arc output missing");
  if (l.tokenizer_word_encoding !== "plain" && l.tokenizer_word_encoding !== "space")
    p.push("tokenizer_word_encoding not set");
  const w = l.window;
  if (!w || !isNum(w.max_subword_tokens) || !isNum(w.max_subwords_per_word) || !isNum(w.long_sentence_overlap))
    p.push("window missing");
  const c = l.calibration;
  if (!c || !isNum(c.temperature) || !isNum(c.rel_temperature) || !isNum(c.arc_temperature))
    p.push("calibration temperatures not set");
  if (!l.ambiguity || !isNum(l.ambiguity.margin) || !isNum(l.ambiguity.attachment_margin))
    p.push("ambiguity margins not set");
  if (!l.nested || !isNum(l.nested.bracket_threshold) || !isNum(l.nested.role_threshold))
    p.push("nested thresholds not set");
  if (typeof l.model_version !== "string" || !l.model_version) p.push("model_version not set");
  return p;
}

/** Map a load failure to the status reason (architecture.md → Model readiness). */
export function loadFailureReason(err: unknown): LoadFailureReason {
  if (err instanceof ParserLoadError) return err.reason;
  const msg = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase();
  if (/out of memory|outofmemory|allocation failed|oom\b|bad_alloc/.test(msg)) return "out-of-memory";
  if (/webgpu|not supported|unsupported|no available backend|navigator\.gpu/.test(msg)) return "unsupported";
  if (/failed to fetch|networkerror|network error|load failed|could not locate file|404/.test(msg)) return "network";
  return "invalid-model";
}

// -- runtime --------------------------------------------------------------------------------

/** A loaded ONNX model: runs one window and returns both outputs. */
export interface ModelSession {
  run(ids: readonly number[]): Promise<WindowOutput>;
  dispose(): Promise<void>;
}

/** Access to Transformers.js (or a fake in tests). */
export interface TransformersRuntime {
  loadLabels(folder: string): Promise<unknown>;
  loadTokenizer(folder: string): Promise<TokenizerLike>;
  loadModel(
    folder: string,
    variant: ModelRef["variant"],
    device: ComputeBackend,
    lowMemory?: boolean,
  ): Promise<ModelSession>;
}

/**
 * ONNX Runtime session options for memory-limited devices (ModelRef.lowMemory; T98). Graph
 * optimization at load copies the weights while it rewrites the graph: without it the worker held
 * 349 MB instead of 460 MB after loading Compact int8 on WASM (Chrome, emulated phone), at the
 * same parse speed. Disabling the CPU memory arena and memory patterns changed nothing.
 */
export const LOW_MEMORY_SESSION_OPTIONS = { graphOptimizationLevel: "disabled" } as const;

/**
 * Options of the default runtime. Tests in Node pass a file-path base URL, the CPU device,
 * and readText (fetch cannot read files).
 */
export type RuntimeOptions = {
  baseUrl?: string;
  device?: "cpu";
  readText?: (url: string) => Promise<string>;
  /** Base URL of the ONNX Runtime Web files (default `${baseUrl}_ort/`). */
  ortBaseUrl?: string;
};

/** The real Transformers.js runtime (remote models disabled; the app's own /models/ folder). */
export function transformersRuntime(options: RuntimeOptions = {}): TransformersRuntime {
  const base = options.baseUrl ?? MODEL_BASE_URL;
  const lib = async () => {
    const t = await import("@huggingface/transformers");
    t.env.allowRemoteModels = false;
    t.env.allowLocalModels = true;
    t.env.localModelPath = base;
    // Transformers.js would fetch ONNX Runtime's WASM from cdn.jsdelivr.net; serve it from our
    // own origin instead (agents.md: no external requests). Not used by onnxruntime-node.
    const wasm = t.env.backends.onnx.wasm;
    if (options.device !== "cpu" && wasm) {
      const ort = options.ortBaseUrl ?? `${base}${ORT_FOLDER}/`;
      wasm.wasmPaths = { mjs: `${ort}${ORT_WASM_FILE}.mjs`, wasm: `${ort}${ORT_WASM_FILE}.wasm` };
    }
    return t;
  };
  return {
    async loadLabels(folder) {
      const url = `${base}${folder}/labels.json`;
      if (options.readText) return JSON.parse(await options.readText(url));
      const res = await fetch(url);
      if (!res.ok) throw new ParserLoadError("network", `labels.json: HTTP ${res.status}`);
      return res.json();
    },
    async loadTokenizer(folder) {
      const t = await lib();
      const tok = await t.AutoTokenizer.from_pretrained(folder);
      return { encode: (text, opts) => tok.encode(text, opts) };
    },
    async loadModel(folder, variant, device, lowMemory = false) {
      const t = await lib();
      // One WASM thread on memory-limited devices: no thread pool and no shared memory growth (T98).
      // Takes effect when ONNX Runtime's WASM starts, i.e. for the first model loaded in this worker.
      const wasm = t.env.backends.onnx.wasm;
      if (lowMemory && wasm) wasm.numThreads = 1;
      const model = await t.AutoModelForTokenClassification.from_pretrained(folder, {
        dtype: variant === "fp16" ? "fp16" : "q8",
        device: options.device ?? device,
        ...(lowMemory ? { session_options: { ...LOW_MEMORY_SESSION_OPTIONS } } : {}),
      });
      return {
        async run(ids) {
          const n = ids.length;
          const inputIds = new t.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, n]);
          const mask = new t.Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]);
          // forward() returns every ONNX output; model() would drop arc_scores (T05).
          const out = (await model.forward({ input_ids: inputIds, attention_mask: mask })) as Record<
            string,
            { data: ArrayLike<number>; dims: number[] } | undefined
          >;
          const logits = out.logits;
          const arc = out.arc_scores;
          if (!logits || !arc) throw new ParserRuntimeError("model did not return logits and arc_scores");
          return {
            logits: logits.data,
            width: logits.dims[2] as number,
            tokens: logits.dims[1] as number,
            arc: arc.data,
          };
        },
        async dispose() {
          await model.dispose();
        },
      };
    },
  };
}

// -- backend --------------------------------------------------------------------------------

/** The ONNX model backend (see the header). */
export function createTransformerBackend(runtime: TransformersRuntime = transformersRuntime()): ParserBackend {
  let state: {
    labels: LabelConfig;
    tok: TokenizerLike;
    session: ModelSession;
    special: { prefix: number[]; suffix: number[] };
    backend: ComputeBackend;
  } | null = null;

  const tagWith = async (
    s: NonNullable<typeof state>,
    sentences: readonly SentenceSpan[],
  ): Promise<TaggedSentence[]> => {
    const { labels, tok, session, special } = s;
    const encoding = labels.tokenizer_word_encoding as "plain" | "space";
    const pieces = sentences.map((sp) =>
      wordPieces(
        tok,
        sp.words.map((w) => w.text),
        labels.window.max_subwords_per_word,
        encoding,
      ),
    );
    const budget = labels.window.max_subword_tokens - special.prefix.length - special.suffix.length;
    const windows = packWindows(
      pieces.map((ps) => ps.map((p) => p.length)),
      budget,
      labels.window.long_sentence_overlap,
    );
    const inputs = windows.map((refs) => windowInput(refs, pieces, special));
    const outputs: WindowOutput[] = [];
    for (const inp of inputs) {
      const out = await session.run(inp.ids);
      if (
        out.width !== labels.labels.length ||
        out.tokens !== inp.ids.length ||
        out.arc.length !== out.tokens * out.tokens
      ) {
        throw new ParserRuntimeError("model outputs do not match labels.json");
      }
      outputs.push(out);
    }
    return decodeWindows(sentences, windows, inputs, outputs, labels);
  };

  return {
    name: "transformer",
    async load(model: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void> {
      if (state) await state.session.dispose();
      state = null;
      const backend: ComputeBackend = model.variant === "fp16" ? "webgpu" : "wasm";
      let session: ModelSession | null = null;
      try {
        onProgress({ phase: "initialize", progress: 0 });
        const raw = await runtime.loadLabels(model.folder);
        const problems = validateLabels(raw);
        if (problems.length) throw new ParserLoadError("invalid-model", `labels.json: ${problems.join("; ")}`);
        const labels = raw as LabelConfig;
        const tok = await runtime.loadTokenizer(model.folder);
        onProgress({ phase: "initialize", progress: 0.3 });
        session = await runtime.loadModel(model.folder, model.variant, backend, model.lowMemory === true);
        onProgress({ phase: "initialize", progress: 0.9 });
        const candidate = { labels, tok, session, special: specialIds(tok), backend };
        await selfTest(candidate);
        state = candidate;
        onProgress({ phase: "initialize", progress: 1 });
      } catch (err) {
        await session?.dispose().catch(() => undefined);
        if (err instanceof ParserLoadError) throw err;
        throw new ParserLoadError(loadFailureReason(err), err instanceof Error ? err.message : String(err));
      }
    },
    async unload(): Promise<void> {
      const s = state;
      state = null;
      if (s) await s.session.dispose();
    },
    isReady: (): boolean => state !== null,
    info(): BackendInfo {
      if (!state) throw new ParserNotReadyError();
      return { labels: state.labels, backend: state.backend };
    },
    async tag(sentences: readonly SentenceSpan[]): Promise<TaggedSentence[]> {
      if (!state) throw new ParserNotReadyError();
      return tagWith(state, sentences);
    },
  };

  /** Parse SELF_TEST_WORDS: shapes match labels.json, scores are finite, the tree decodes. */
  async function selfTest(s: NonNullable<typeof state>): Promise<void> {
    let pos = 0;
    const words = SELF_TEST_WORDS.map((text) => {
      const w = { text, start: pos, end: pos + text.length };
      pos += text.length + 1;
      return w;
    });
    let tagged: TaggedSentence[];
    try {
      tagged = await tagWith(s, [{ start: 0, end: pos - 1, words }]);
    } catch (err) {
      throw new ParserLoadError(
        "invalid-model",
        `self-test failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const [t] = tagged;
    const finite = t?.words.every(
      (w) => Number.isFinite(w.uposProb) && w.relations.every((r) => Number.isFinite(r.prob)),
    );
    if (!t || t.words.length !== SELF_TEST_WORDS.length || !finite) {
      throw new ParserLoadError("invalid-model", "self-test failed: unexpected output");
    }
    decodeArcTree(
      t.arc,
      t.words.map((w) => w.relations),
    ); // throws on malformed arc rows
  }
}
