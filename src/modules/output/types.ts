/**
 * src/modules/output/types.ts — types for the output module (proposed file)
 *
 * Description:
 *   Annotation model consumed by OutputPage, plus the annotator's input
 *   shape (structurally compatible with the parser's ParseResult).
 *
 * Layer: modules/ (output)
 *
 * Tasks:
 *   1. AnnotatorInput: minimal parse-result shape the annotator needs.
 *   2. Annotation, AnnotatedSentence, AnnotatedChunk, AnnotatedToken
 *      (ids, text, lemma, UPOS, chunk type, highlight state).
 *   3. AlternativeView: rank, probability, reason, chunk sequence.
 *
 * Dependencies:
 *   None. Used by: ./annotator.ts, ./index.ts.
 *
 * Open items (plan.md → Undecided): module interfaces.
 *
 * Status: header only; not implemented.
 */
