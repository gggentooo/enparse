/**
 * src/modules/parser/types.ts — types for the parser module (proposed file)
 *
 * Description:
 *   Shared data shapes for parse results and the worker message protocol.
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Token: text, offsets, lemma, UPOS, chunk tag, label probabilities;
 *      head (token index in the sentence, -1 for root), relation, and head
 *      probability.
 *   2. Chunk: type (NP, VP, PP, ADJP, ADVP), token range (flat view).
 *   3. PhraseNode (proposed): type (including "S" for clause), token range,
 *      head token, children (built by treeDecoder.ts; plan-training.md → Nested
 *      phrase structure), plus planned role (PhraseRole: Subject, Predicate,
 *      Object, Indirect Object, Complement, Modifier, etc.) and isHead
 *      (head-of-parent marker) populated by phraseLabeler.ts.
 *   4. SentenceParse: tokens, primary chunks, phrases (root PhraseNode, or
 *      null when the nested view is not shipped), treeRepaired flag,
 *      alternatives (ranked, with probability and reason: probability or
 *      attachment).
 *   5. ParseResult: sentences, model id and model version (labels.json),
 *      backend (webgpu | wasm); every Token keeps wink character offsets
 *      (traceability).
 *      No mode field: results always come from the model.
 *   6. LabelConfig: mirrors labels.json schema v2 (biaffine head; plan-training.md →
 *      Phase 4 schema; T33). (done) Schema v1 files (rel_pos_v1 head labels) are
 *      training-only and not loaded by the app.
 *   7. ModelRef: { id, folder, variant ("int8" | "fp16") } — the model the
 *      worker loads (structural; parserService builds it from the catalog).
 *      Worker message types (request/response unions) and ParserStatus
 *      (idle | loading + phase/progress | ready + backend/modelVersion |
 *      failed + reason; architecture.md → Model readiness). The `checking`
 *      status is added by parserService (pre-flight runs outside the worker).
 *   8. Errors: ParserLoadError (with reason), ParserNotReadyError,
 *      ParserRuntimeError, TokenizerError (done).
 *
 * Dependencies:
 *   None. Used by: all files in modules/parser/.
 *
 * Open items (todo.md): module interfaces (parse result types);
 *   nested phrase labeling (PhraseRole inventory, clause/predicate convention).
 *
 * Status: implemented (spans Phase 3; LabelConfig T33; phrase labels T34; parse
 *   results, backend contract, worker protocol, and errors T35). ModelRef adds
 *   nestedView (from the catalog) so the worker knows whether to build phrases.
 */

/** One runtime word: its text and character offsets into the preprocessed text. */
export type WordSpan = {
  text: string;
  /** Start offset (UTF-16 index, inclusive). */
  start: number;
  /** End offset (UTF-16 index, exclusive). */
  end: number;
  /** wink-nlp lemma (lower case), or the word itself for merged words (URLs, hyphenated words); T71. */
  lemma?: string;
};

/** One runtime sentence (wink split) with its words. */
export type SentenceSpan = {
  start: number;
  end: number;
  words: WordSpan[];
};

/** Thrown when the tokenizer output cannot be mapped back to the input text. */
export class TokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenizerError";
  }
}

/** labels.json schema version this app understands (2: biaffine head; T33). */
export const LABEL_SCHEMA_VERSION = 2;

/** Slice of `labels` (and of the model logits) for one label group. */
export type LabelGroup = {
  /** First class id of the group (inclusive). */
  start: number;
  /** End class id (exclusive). */
  end: number;
};

/**
 * Contents of public/models/<model-id>/labels.json, schema v2
 * (plan-training.md → Phase 4 schema). Field names match the JSON exactly.
 * Fields written by later training phases are null until then.
 */
export type LabelConfig = {
  schema_version: number;
  /** Group A labels (`UPOS|CHUNK`) then group B relations (`nsubj`, `nsubj:pass`, …); index = class id. */
  labels: string[];
  /** Slices of the `logits` output; softmax is applied per slice. */
  groups: { chunk: LabelGroup; rel: LabelGroup };
  /** Structure encoding: "biaffine_v1" (heads from the arc_scores output, MST decoding). */
  dep_encoding: string;
  /** Second ONNX output [batch, T, T]: score of token j as head of token i; token 0 is the root. */
  arc: { output: string; root_position: number; scope: "sentence" };
  /** UD relation subtypes kept in group B (others are folded into their base relation). */
  relation_subtypes: string[];
  /** How words are fed to the tokenizer: "pre_split_words" (each word tokenized as if preceded by a space). */
  tokenizer_input: string;
  /** Per-model word encoding for Transformers.js ("plain" or "space"); set in Phase 9/11. */
  tokenizer_word_encoding: "plain" | "space" | null;
  /** The 17 UPOS tags, fixed order. */
  upos: string[];
  /** B-/I- x NP, VP, PP, ADJP, ADVP, then O. */
  chunk_tags: string[];
  /** Rare labels mapped during training (`null` = ignored). Informational. */
  label_merges: Record<string, string | null>;
  window: {
    /** Max subword tokens per model window, including special tokens. */
    max_subword_tokens: number;
    /** Subwords kept per word; later subwords are dropped before the model. */
    max_subwords_per_word: number;
    /** Tokens of context repeated when one sentence is longer than a window. */
    long_sentence_overlap: number;
  };
  versions: {
    /** Hugging Face id of the base model (tokenizer source). */
    base_model: string;
    data: { ud_release: string; ud_commit: string; feedback_batches: string[] };
    /** wink versions used in training; the app warns if its versions differ. */
    wink: { "wink-nlp": string; "wink-eng-lite-web-model": string };
  };
  /** Softmax temperatures (Phase 8): group A, relations, arc scores. */
  calibration: { temperature: number | null; rel_temperature: number | null; arc_temperature: number | null };
  ambiguity: { margin: number | null; attachment_margin: number | null };
  /**
   * Confidence gating of the nested view (Phase 8): brackets below bracket_threshold collapse;
   * roles whose head word's relation × head probability is below role_threshold are hidden (T59).
   */
  nested: { bracket_threshold: number | null; role_threshold: number | null };
  model_version: string | null;
  /** Model files (path relative to the model folder) with size and SHA-256; written by export_onnx.py (Phase 11). Used by pre-flight integrity checks. */
  files: Record<string, { bytes: number; sha256: string }> | null;
};

/**
 * Word-level arc scores of one sentence (biaffine models): row i = word i (0-based);
 * column 0 = root, column j = word j (1-based). Read from the `arc_scores` output at
 * first-subword positions.
 */
export type ArcScores = readonly (readonly number[])[];

/** One relation (group B of a biaffine model) with its probability; candidates best first. */
export type RelationCandidate = { relation: string; prob: number };

/** One group B label with its probability (candidates are sorted, best first). */
export type DepCandidate = {
  /** rel_pos_v1 label, e.g. "+1@NOUN|det" or "0@ROOT|root". */
  label: string;
  prob: number;
};

/** A decoded dependency tree for one sentence (1-based heads, 0 = root). */
export type DecodedTree = {
  heads: number[];
  /** Base UD relation per word ("dep" for words attached by repair). */
  relations: string[];
  /** True if any word did not use its best label. */
  repaired: boolean;
  /** 0-based indexes of words whose head came from repair (not their best label; MST: not their argmax head). */
  repairedWords: number[];
  /** Probability of the chosen head per word (gating; Phase 8 calibration applies before decoding). */
  headProbs: number[];
  /** Probability of the chosen relation per word (role gating, T59); 1 for rel_pos_v1 trees (joint label in headProbs). */
  relationProbs: number[];
  /**
   * Probability of every head per word: row i = word i; column 0 = root, column j = word j
   * (biaffine trees; absent for rel_pos_v1). Used by span confidence (gating).
   */
  headDist?: number[][];
};

/** Phrase label in the nested view; null when the head's UPOS has no phrase type. */
export type PhraseType = "NP" | "VP" | "PP" | "ADJP" | "ADVP" | null;

/** A word shown without its own bracket (0-based index into the sentence). */
export type WordLeaf = { word: number };

/**
 * What a bracket is for its head (treeDecoder.ts → buildPhrases): the clause (subject +
 * predicate), the predicate, the complement of a copula, the first conjunct of a coordination
 * (the head with its own dependents, beside the other conjuncts), or any other phrase.
 */
export type PhraseLevel = "phrase" | "complement" | "predicate" | "clause" | "conjunct";

/** One bracket of the nested view. */
export type PhraseNode = {
  type: PhraseType;
  level: PhraseLevel;
  /** 0-based index of the head word. */
  head: number;
  /** First and last covered word (0-based, inclusive). */
  start: number;
  end: number;
  /** False if the covered words have gaps (non-projective tree). */
  contiguous: boolean;
  /**
   * Always shown: the subject and predicate brackets of a main clause, which has no bracket of
   * its own (owner, 2026-11-23; T82). Never collapsed by gating; may hold a single word.
   */
  pinned?: boolean;
  children: Array<PhraseNode | WordLeaf>;
};

/** Nested view of one sentence: the root phrase plus root-level punctuation, in word order. */
export type SentencePhrases = Array<PhraseNode | WordLeaf>;

/** A labeled bracket span for scoring (0-based, inclusive). */
export type PhraseSpan = { type: PhraseType; start: number; end: number };

// -- phrase labeling (phraseLabeler.ts; T34) ---------------------------------------------

/** Learner-facing grammatical role (owner, 2026-11-20; T10). Display text comes from T18. */
export type PhraseRole =
  | "Subject"
  | "Predicate"
  | "Object"
  | "Indirect Object"
  | "Complement"
  | "Modifier"
  | "Passive subject"
  | "Agent"
  | "Relative clause"
  | "Possessive"
  | "Particle";

/** Phrase category shown in the nested view: the bracket type, or "S" for a clause (subject + predicate). */
export type PhraseCategory = PhraseType | "S";

/** Labels shared by labeled words and phrases. */
export type RoleLabels = {
  /** Role in the parent structure; null when none applies (or the span is uncertain). */
  role: PhraseRole | null;
  /** Carries its parent bracket's head word (head constituent of the parent). */
  isHead: boolean;
  /** Conjunct of a coordination (the outer bracket carries the shared role). */
  coordinated: boolean;
  /** Piece of a predicate split by another constituent (questions, inversion). */
  splitPredicate: boolean;
  /** Role shown on this head word because its bracket was collapsed by gating (phrase boundary uncertain; T59). */
  badge: boolean;
  /**
   * 0-based index of the word this phrase or word attaches to in the displayed tree (the word
   * it modifies or complements; shown as an arrow), or null (heads inside their own phrase,
   * the root, punctuation).
   */
  attachTo: number | null;
  /**
   * First word of what it attaches to: the target is the words attachFrom..attachTo. Equal to
   * attachTo except for a modifier before its head, which modifies everything from just after
   * itself through the head word ("big" → "red dog"; T81). Null when attachTo is null.
   */
  attachFrom: number | null;
  /** The attachment's confidence is below the role threshold (shown as uncertain; role hidden). */
  uncertain: boolean;
};

/** Role confidence gating (T59): per-word confidence (relation × head probability) and the model's threshold. */
export type RoleGate = { confidence: readonly number[]; threshold: number };

/** A word without its own bracket, with its labels. */
export type LabeledWord = WordLeaf & RoleLabels;

/** A bracket of the nested view with its labels. */
export type LabeledPhrase = Omit<PhraseNode, "children"> &
  RoleLabels & {
    category: PhraseCategory;
    /** A pinned bracket whose span confidence is below the bracket threshold (shown dashed). */
    unsure: boolean;
    children: Array<LabeledPhrase | LabeledWord>;
  };

/** Labeled nested view of one sentence (same order and spans as SentencePhrases). */
export type LabeledSentencePhrases = Array<LabeledPhrase | LabeledWord>;

// -- parse results (T35; architecture.md → Model, Traceability) ----------------------------

/** Flat chunk types (group A chunk tags). */
export type ChunkType = "NP" | "VP" | "PP" | "ADJP" | "ADVP";

/** Compute backend the model runs on (architecture.md → Model readiness). */
export type ComputeBackend = "webgpu" | "wasm";

/** One word of a parsed sentence. */
export type Token = {
  /** 0-based index in the sentence. */
  index: number;
  text: string;
  /** wink character offsets into the preprocessed text (traceability). */
  start: number;
  end: number;
  /** Lemma from wink-nlp (lower case; merged words keep their form); null if unknown. */
  lemma: string | null;
  upos: string;
  uposProb: number;
  /** BIO chunk tag after repair (architecture.md → BIO repair). */
  chunkTag: string;
  chunkProb: number;
  /** 0-based head index in the sentence; -1 = root. */
  head: number;
  /** UD relation (base or kept subtype). */
  relation: string;
  headProb: number;
  relationProb: number;
};

/** A flat chunk: type and token range (0-based, inclusive). */
export type Chunk = { type: ChunkType; start: number; end: number };

/** What an alternative changes for one token (fields absent = same as the primary parse). */
export type TokenChange = {
  index: number;
  upos?: string;
  chunkTag?: string;
  head?: number;
  relation?: string;
};

/** One ranked alternative parse of a sentence (built by ambiguity.ts; T60). */
export type Alternative = {
  /** 1 = most probable alternative. */
  rank: number;
  /**
   * Share of this reading among the primary parse and the shown alternatives (they sum to 1
   * with the primary's share): P(reading) / Σ P, where P is relative to the primary parse.
   */
  probability: number;
  reason: "probability" | "attachment";
  /** Tokens whose labels or head differ from the primary parse (the UI marks these words). */
  changes: TokenChange[];
  /**
   * Attachment alternatives: the word whose head was switched (the head of the disputed phrase),
   * its head in the primary parse (`from`) and in this reading (`to`); 0-based, -1 = root.
   */
  attachment?: { word: number; from: number; to: number };
  chunks: Chunk[];
  phrases: LabeledSentencePhrases | null;
};

/** One parsed sentence. */
export type SentenceParse = {
  /** Character offsets of the sentence in the preprocessed text. */
  start: number;
  end: number;
  tokens: Token[];
  /** Primary (most likely) flat chunks. */
  chunks: Chunk[];
  /** Labeled nested view (gated), or null when the model does not ship the nested view. */
  phrases: LabeledSentencePhrases | null;
  /** True if any word's tree head is not its most probable head (MST changed it). */
  treeRepaired: boolean;
  /** Ranked alternatives, at most MAX_ALTERNATIVES. */
  alternatives: Alternative[];
};

/** Result of parsing one text. Always from the model (no mode field; no fallback). */
export type ParseResult = {
  sentences: SentenceParse[];
  modelId: string;
  /** labels.json → model_version. */
  modelVersion: string;
  backend: ComputeBackend;
};

/** The model the worker loads (built by parserService from the catalog). */
export type ModelRef = {
  id: string;
  /** Folder under public/models/. */
  folder: string;
  variant: "int8" | "fp16";
  /** Whether the model ships the nested view (catalog.json → nested_view). */
  nestedView: boolean;
  /**
   * Load with as little memory as possible (phones and tablets; T98): one WASM thread and the
   * low-memory session options of transformerBackend.ts. Slower, same outputs.
   */
  lowMemory?: boolean;
};

// -- backend contract (T35; implemented by transformerBackend.ts, T63) ---------------------

/** Top group A candidates of a word (calibrated), best first. */
export type LabelCandidate = { upos: string; chunkTag: string; prob: number };

/** Backend output for one word (calibrated probabilities). */
export type TaggedWord = {
  upos: string;
  /** UPOS probability (sum of group A probabilities with this UPOS). */
  uposProb: number;
  chunkTag: string;
  /** Chunk tag probability (sum of group A probabilities with this tag). */
  chunkProb: number;
  /** Best group A candidates (for ambiguity.ts). */
  candidates: LabelCandidate[];
  /** Relation candidates, best first. */
  relations: RelationCandidate[];
};

/** Backend output for one sentence: words in order and word-level arc scores (arc temperature applied). */
export type TaggedSentence = { words: TaggedWord[]; arc: ArcScores };

/** Load progress reported while a model loads. */
export type LoadProgress = { phase: "download" | "initialize"; progress: number | null };

/** What a ready backend reports about the loaded model. */
export type BackendInfo = { labels: LabelConfig; backend: ComputeBackend };

/** A model backend (agents.md → Adding a parser backend). Runs only inside parser.worker.ts. */
export interface ParserBackend {
  readonly name: string;
  /** Load the model, self-test included; throws ParserLoadError. Ready only after it resolves. */
  load(model: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void>;
  /** Free the session and tokenizer. */
  unload(): Promise<void>;
  isReady(): boolean;
  /** Loaded model's labels.json and compute backend; throws ParserNotReadyError before ready. */
  info(): BackendInfo;
  /** Tag whole sentences (windows as in training); one TaggedSentence per input sentence. */
  tag(sentences: readonly SentenceSpan[]): Promise<TaggedSentence[]>;
}

// -- worker protocol (T35) -----------------------------------------------------------------

/** Why loading failed (architecture.md → Model readiness). */
export type LoadFailureReason = "network" | "unsupported" | "out-of-memory" | "invalid-model";

/** Worker status. `checking`, `no-model`, and `downloading` are added by parserService. */
export type WorkerStatus =
  | { state: "idle" }
  | { state: "loading"; modelId: string; phase: LoadProgress["phase"]; progress: number | null }
  | { state: "ready"; modelId: string; backend: ComputeBackend; modelVersion: string }
  | { state: "failed"; modelId: string; reason: LoadFailureReason; message: string };

/** Messages to the worker; `id` correlates the reply. */
export type WorkerRequest =
  | { type: "load"; id: number; model: ModelRef }
  | { type: "unload"; id: number }
  | { type: "retry"; id: number }
  | { type: "parse"; id: number; text: string }
  | { type: "status"; id: number };

/** An error as sent between worker and main thread. */
export type SerializedError = {
  name: "ParserLoadError" | "ParserNotReadyError" | "ParserRuntimeError" | "TokenizerError" | "Error";
  message: string;
  reason?: LoadFailureReason;
};

/** Messages from the worker. `status` is broadcast on every change (and on request). */
export type WorkerResponse =
  | { type: "status"; status: WorkerStatus }
  | { type: "result"; id: number; result: ParseResult }
  | { type: "done"; id: number }
  | { type: "error"; id: number; error: SerializedError };

// -- errors (T35) --------------------------------------------------------------------------

/** Loading the model failed; `reason` drives the `failed` status and the UI. */
export class ParserLoadError extends Error {
  readonly reason: LoadFailureReason;
  constructor(reason: LoadFailureReason, message: string) {
    super(message);
    this.name = "ParserLoadError";
    this.reason = reason;
  }
}

/** A parse was requested before the model was ready (no fallback parser). */
export class ParserNotReadyError extends Error {
  constructor(message = "The parser model is not ready.") {
    super(message);
    this.name = "ParserNotReadyError";
  }
}

/** Parsing failed after the model was ready (inference or decoding error). */
export class ParserRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParserRuntimeError";
  }
}

/** Error → message form (keeps the typed name and load reason). */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof ParserLoadError) return { name: "ParserLoadError", message: err.message, reason: err.reason };
  if (err instanceof ParserNotReadyError || err instanceof ParserRuntimeError || err instanceof TokenizerError) {
    return { name: err.name as SerializedError["name"], message: err.message };
  }
  return { name: "Error", message: err instanceof Error ? err.message : String(err) };
}

/** Message form → typed error. */
export function deserializeError(e: SerializedError): Error {
  switch (e.name) {
    case "ParserLoadError":
      return new ParserLoadError(e.reason ?? "invalid-model", e.message);
    case "ParserNotReadyError":
      return new ParserNotReadyError(e.message);
    case "ParserRuntimeError":
      return new ParserRuntimeError(e.message);
    case "TokenizerError":
      return new TokenizerError(e.message);
    default:
      return new Error(e.message);
  }
}
