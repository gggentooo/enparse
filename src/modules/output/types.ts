/**
 * src/modules/output/types.ts — types for the output module
 *
 * Description:
 *   Annotation model consumed by OutputPage, plus the annotator's input
 *   shape (structurally compatible with the parser's ParseResult).
 *
 * Layer: modules/ (output)
 *
 * Tasks:
 *   1. AnnotatorInput: minimal parse-result shape the annotator needs
 *      (including nested phrases with role, isHead, and contiguous metadata
 *      from parser/phraseLabeler.ts).
 *   2. Annotation, AnnotatedSentence, AnnotatedToken, Reading (primary or
 *      alternative: flat segments and nested nodes), AnnotatedNode (phrase
 *      category, grammatical role, isHead marker, contiguous flag).
 *
 * Dependencies:
 *   None. Used by: ./annotator.ts, ./index.ts.
 *
 * Status: implemented (T57).
 */

/** Flat chunk types (parser ChunkType). */
export type ChunkKind = "NP" | "VP" | "PP" | "ADJP" | "ADVP";
/** Nested phrase category (parser PhraseCategory). */
export type CategoryKind = ChunkKind | "S" | null;
/** Grammatical roles (parser PhraseRole). */
export type RoleKind =
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

// -- input (structural subset of parser ParseResult; no import of modules/parser) ---------

type InputLabels = {
  role: RoleKind | null;
  isHead: boolean;
  coordinated: boolean;
  splitPredicate: boolean;
  badge: boolean;
};
export type InputWord = InputLabels & { word: number };
export type InputPhrase = InputLabels & {
  category: CategoryKind;
  head: number;
  start: number;
  end: number;
  contiguous: boolean;
  wrapper: boolean;
  children: Array<InputPhrase | InputWord>;
};
export type InputToken = {
  index: number;
  text: string;
  start: number;
  end: number;
  lemma: string | null;
  upos: string;
  chunkTag: string;
};
export type InputChunk = { type: ChunkKind; start: number; end: number };
export type InputChange = { index: number; upos?: string; chunkTag?: string; head?: number; relation?: string };
export type AnnotatorInput = {
  sentences: ReadonlyArray<{
    start: number;
    end: number;
    tokens: readonly InputToken[];
    chunks: readonly InputChunk[];
    phrases: ReadonlyArray<InputPhrase | InputWord> | null;
    alternatives: ReadonlyArray<{
      rank: number;
      probability: number;
      reason: "probability" | "attachment";
      changes: readonly InputChange[];
      chunks: readonly InputChunk[];
      phrases: ReadonlyArray<InputPhrase | InputWord> | null;
    }>;
  }>;
  modelId: string;
  modelVersion: string;
  backend: "webgpu" | "wasm";
};

// -- output ----------------------------------------------------------------------------------

/** One word, with what the lookup panels need. Ids are stable per parse (React keys, selection). */
export type AnnotatedToken = {
  id: string;
  index: number;
  text: string;
  /** wink lemma (lower case) or null. */
  lemma: string | null;
  /** Primary-parse UPOS (a reading may change it; see Reading.changes). */
  upos: string;
  /** Whitespace follows this word in the input (render a space after it). */
  spaceAfter: boolean;
  /** Some alternative reading changes this word (marked in the primary view; T11). */
  ambiguous: boolean;
};

/** A run of words in the flat view: a chunk, or words outside chunks (type null). */
export type FlatSegment = { id: string; type: ChunkKind | null; start: number; end: number };

type NodeLabels = {
  role: RoleKind | null;
  isHead: boolean;
  coordinated: boolean;
  splitPredicate: boolean;
  /** Role shown on a head word whose bracket collapsed (boundary uncertain; T59). */
  badge: boolean;
};
export type AnnotatedWordNode = NodeLabels & { kind: "word"; id: string; token: number };
export type AnnotatedPhraseNode = NodeLabels & {
  kind: "phrase";
  id: string;
  category: CategoryKind;
  start: number;
  end: number;
  contiguous: boolean;
  children: AnnotatedNode[];
};
export type AnnotatedNode = AnnotatedWordNode | AnnotatedPhraseNode;

/** The primary parse (rank 0) or one alternative. */
export type Reading = {
  id: string;
  /** 0 = primary ("most likely"); alternatives from 1. */
  rank: number;
  /** Share among the shown readings (primary = 1 − Σ alternatives). */
  probability: number;
  reason: "primary" | "probability" | "attachment";
  segments: FlatSegment[];
  /** Nested view, or null when the model has none. */
  nodes: AnnotatedNode[] | null;
  /** Words whose labels or head differ from the primary parse, with their values in this reading. */
  changes: Readonly<Record<number, { upos?: string; chunkTag?: string }>>;
};

export type AnnotatedSentence = {
  id: string;
  /** 0-based paragraph of the input (blank lines separate paragraphs). */
  paragraph: number;
  text: string;
  tokens: AnnotatedToken[];
  /** readings[0] is the primary parse. */
  readings: Reading[];
};

export type Annotation = {
  modelId: string;
  modelVersion: string;
  backend: "webgpu" | "wasm";
  sentences: AnnotatedSentence[];
  /** Whether any sentence has a nested view (the model ships it). */
  hasNested: boolean;
};
