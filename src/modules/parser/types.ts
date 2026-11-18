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
 *   3. PhraseNode (proposed): type, token range, head token, children
 *      (nested view; built by treeDecoder.ts; plan-training.md → Nested
 *      phrase structure).
 *   4. SentenceParse: tokens, primary chunks, phrases (root PhraseNode, or
 *      null when the nested view is not shipped), treeRepaired flag,
 *      alternatives (ranked, with probability and reason: probability or
 *      attachment).
 *   5. ParseResult: sentences, model id and model version (labels.json),
 *      backend (webgpu | wasm); every Token keeps wink character offsets
 *      (traceability).
 *      No mode field: results always come from the model.
 *   6. LabelConfig: mirrors labels.json schema v1 (plan-training.md → Phase 4). (done)
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
 * Open items (plan.md → Undecided): module interfaces (parse result types).
 *
 * Status: word and sentence spans (Phase 3 pre-work) and LabelConfig (Phase 4)
 *   implemented; other tasks pending.
 */

/** One runtime word: its text and character offsets into the preprocessed text. */
export type WordSpan = {
  text: string;
  /** Start offset (UTF-16 index, inclusive). */
  start: number;
  /** End offset (UTF-16 index, exclusive). */
  end: number;
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

/** labels.json schema version this app understands. */
export const LABEL_SCHEMA_VERSION = 1;

/** Slice of `labels` (and of the model logits) for one label group. */
export type LabelGroup = {
  /** First class id of the group (inclusive). */
  start: number;
  /** End class id (exclusive). */
  end: number;
};

/**
 * Contents of public/models/<model-id>/labels.json, schema v1
 * (plan-training.md → Phase 4). Field names match the JSON exactly.
 * Fields written by later training phases are null until then.
 */
export type LabelConfig = {
  schema_version: number;
  /** Group A labels (`UPOS|CHUNK`) then group B labels (`<offset>@<UPOS>|<relation>`); index = class id. */
  labels: string[];
  /** Softmax is applied per group slice. */
  groups: { chunk: LabelGroup; dep: LabelGroup };
  /** Head encoding of group B, e.g. "rel_pos_v1". */
  dep_encoding: string;
  /** How words are fed to the tokenizer: "pre_split_words" (each word tokenized as if preceded by a space). */
  tokenizer_input: string;
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
  };
  versions: {
    /** Hugging Face id of the base model (tokenizer source). */
    base_model: string;
    data: { ud_release: string; ud_commit: string; feedback_batches: string[] };
    /** wink versions used in training; the app warns if its versions differ. */
    wink: { "wink-nlp": string; "wink-eng-lite-web-model": string };
  };
  calibration: { temperature: number | null; dep_temperature: number | null };
  ambiguity: { margin: number | null; attachment_margin: number | null };
  model_version: string | null;
  /** Model files (path relative to the model folder) with size and SHA-256; written by export_onnx.py (Phase 11). Used by pre-flight integrity checks. */
  files: Record<string, { bytes: number; sha256: string }> | null;
};

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
  /** 0-based indexes of words whose head came from repair (not their best label). */
  repairedWords: number[];
};

/** Phrase label in the nested view; null when the head's UPOS has no phrase type. */
export type PhraseType = "NP" | "VP" | "PP" | "ADJP" | "ADVP" | null;

/** A word shown without its own bracket (0-based index into the sentence). */
export type WordLeaf = { word: number };

/** One bracketed level of the nested view. */
export type PhraseNode = {
  type: PhraseType;
  /** 0-based index of the head word. */
  head: number;
  /** First and last covered word (0-based, inclusive). */
  start: number;
  end: number;
  /** False if the covered words have gaps (non-projective tree). */
  contiguous: boolean;
  children: Array<PhraseNode | WordLeaf>;
};

/** Nested view of one sentence: the root phrase plus root-level punctuation, in word order. */
export type SentencePhrases = Array<PhraseNode | WordLeaf>;

/** A labeled bracket span for scoring (0-based, inclusive). */
export type PhraseSpan = { type: PhraseType; start: number; end: number };
