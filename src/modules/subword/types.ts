/**
 * src/modules/subword/types.ts — types for the subword module (proposed file)
 *
 * Description:
 *   Shared data shapes for affixes and segmentations.
 *
 * Layer: modules/ (subword)
 *
 * Tasks:
 *   1. Affix: form, kind (prefix | suffix), meaning, gloss, examples.
 *   2. Segment: text, kind (prefix | base | suffix | inflection), affix ref.
 *   3. SubwordSegmentation: word, lemma, segments.
 *   4. KnownWordPredicate: (word: string) => boolean.
 *
 * Dependencies:
 *   None. Used by: ./subwordParser.ts, ./affixes.ts, ./index.ts.
 *
 * Open items (todo.md): module interfaces (subword segments).
 *
 * Status: implemented (T41).
 */

export type AffixKind = "prefix" | "suffix";

/** One affix (owner, T26: our own list with our own Korean glosses and examples). */
export type Affix = {
  /** Stable id, e.g. "prefix:un", "suffix:ness". */
  id: string;
  kind: AffixKind;
  /** Canonical form without the hyphen ("un", "ness"). */
  form: string;
  /** Other spellings of the same affix ("im", "il", "ir" for "in"; "ible" for "able"). */
  variants: readonly string[];
  /** Bauer & Nation (1993) level, 3 (most regular and frequent) to 6. */
  level: 3 | 4 | 5 | 6;
  /** Short English meaning. */
  meaning: string;
  /** Korean gloss. */
  gloss: string;
  /** One or two example words (decomposable with this list and the known-word list). */
  examples: readonly string[];
};

export type SegmentKind = "prefix" | "base" | "suffix" | "inflection";

export type Segment = {
  /** Text as written in the word (the base is given in its dictionary spelling, e.g. "happy"). */
  text: string;
  kind: SegmentKind;
  /** The affix for prefix and suffix segments. */
  affix?: Affix;
  /** Inflection whose form is not a regular ending (ran ← run). */
  irregular?: boolean;
};

export type SubwordSegmentation = {
  word: string;
  lemma: string;
  /** Segments in reading order; a word with no split is one base segment. */
  segments: Segment[];
};

/** Whether a string is a known English word (injected; the module cannot import the dictionary). */
export type KnownWordPredicate = (word: string) => boolean;
