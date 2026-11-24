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
 *      (including nested phrases with role, isHead, attachment, and
 *      contiguous metadata from parser/phraseLabeler.ts).
 *   2. Annotation, AnnotatedSentence, AnnotatedToken, Reading (primary or
 *      alternative: flat segments and nested nodes), AnnotatedNode (phrase
 *      category, grammatical role, isHead marker, attachment (attachTo,
 *      uncertain), contiguous flag).
 *
 * Dependencies:
 *   None. Used by: ./annotator.ts, ./index.ts.
 *
 * Status: implemented (T57; attachments T79; near-tie notes and forks T83; shared results T99).
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
  attachTo: number | null;
  attachFrom: number | null;
  uncertain: boolean;
};
export type InputWord = InputLabels & { word: number };
export type InputPhrase = InputLabels & {
  category: CategoryKind;
  head: number;
  start: number;
  end: number;
  contiguous: boolean;
  unsure: boolean;
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
  /** 0-based head in the sentence; -1 = root. */
  head: number;
  /** UD relation to the head (with kept subtypes, e.g. "compound:prt"). */
  relation: string;
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
      attachment?: { word: number; from: number; to: number };
    }>;
    /** A shared result (./share.ts; T99): the original parse offered other readings, which are not included. */
    otherReadings?: boolean;
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
  /**
   * Phrasal verb this word belongs to in the primary parse (the verb and its particle,
   * relation compound:prt): "looked" and "up" in "She looked it up" both give
   * { verb: 1, particle: 3, text: "look up" (verb lemma + particle), written: "looked up" }.
   * Null otherwise.
   */
  phrasal: { verb: number; particle: number; text: string; written: string } | null;
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
  /**
   * Index of the token this phrase or word attaches to (what it modifies or complements; drawn
   * as an arrow), or null (head words inside their phrase, the root, punctuation; T73).
   */
  attachTo: number | null;
  /**
   * First token of what it attaches to: the target is tokens attachFrom..attachTo ("big" →
   * "red dog"; T81). Equal to attachTo for a one-word target; null when attachTo is null.
   */
  attachFrom: number | null;
  /** The attachment is below the model's confidence threshold (role hidden; drawn as uncertain). */
  uncertain: boolean;
};
export type AnnotatedWordNode = NodeLabels & { kind: "word"; id: string; token: number };
export type AnnotatedPhraseNode = NodeLabels & {
  kind: "phrase";
  id: string;
  /** Token index of the phrase's head word. */
  head: number;
  category: CategoryKind;
  start: number;
  end: number;
  contiguous: boolean;
  /** A bracket that is always shown (a main clause's subject or predicate) but whose boundary the model is unsure of: drawn dashed (T82). */
  unsure: boolean;
  children: AnnotatedNode[];
};
export type AnnotatedNode = AnnotatedWordNode | AnnotatedPhraseNode;

/** A top reading share below this is a near-tie: the readings are shown as equals (owner, 2026-11-23; T83). */
export const NEAR_TIE_SHARE = 0.6;

/** What kind of word a disputed phrase attaches to (picks the explanation template). */
export type HeadKind = "noun" | "verb" | "adjective" | "other";

/**
 * One plain-language statement of what a reading says where the readings differ (T83): which
 * word a phrase goes with, or which part of speech a word is. The UI renders it from a fixed
 * template per kind.
 */
export type ReadingNote =
  { kind: "attach"; phrase: string; head: string; headKind: HeadKind } | { kind: "label"; word: string; upos: string };

/**
 * A phrase whose attachment the readings dispute, in a near-tie sentence: its head token, and
 * the tokens it may attach to with each reading's share (this reading's target first).
 */
export type Fork = { token: number; targets: Array<{ token: number; share: number }> };

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
  /** What this reading says where the readings differ, in plain statements. */
  notes: ReadingNote[];
  /** Disputed attachments to show as a fork (near-tie sentences only; else empty). */
  forks: Fork[];
};

export type AnnotatedSentence = {
  id: string;
  /** 0-based paragraph of the input (blank lines separate paragraphs). */
  paragraph: number;
  text: string;
  tokens: AnnotatedToken[];
  /** readings[0] is the primary parse. */
  readings: Reading[];
  /** The top reading's share is below NEAR_TIE_SHARE: no reading is presented as the likely one. */
  nearTie: boolean;
  /** Shared result (T99): the original parse offered other readings that the share does not carry. */
  otherReadingsOmitted: boolean;
};

export type Annotation = {
  modelId: string;
  modelVersion: string;
  backend: "webgpu" | "wasm";
  sentences: AnnotatedSentence[];
  /** Whether any sentence has a nested view (the model ships it). */
  hasNested: boolean;
};
