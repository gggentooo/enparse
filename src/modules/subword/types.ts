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
 * Open items (plan.md → Undecided): module interfaces (subword segments).
 *
 * Status: header only; not implemented.
 */
