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
 *   1. AnnotatorInput: minimal parse-result shape the annotator needs
 *      (including nested phrases with role, isHead, and contiguous metadata
 *      from parser/phraseLabeler.ts).
 *   2. Annotation, AnnotatedSentence, AnnotatedChunk, AnnotatedPhrase
 *      (phrase type, grammatical role, isHead marker, contiguous flag),
 *      AnnotatedToken (ids, text, lemma, UPOS, chunk type, highlight state).
 *   3. AlternativeView: rank, probability, reason, chunk sequence, and
 *      labeled nested phrases.
 *
 * Dependencies:
 *   None. Used by: ./annotator.ts, ./index.ts.
 *
 * Open items (todo.md): module interfaces; nested phrase labeling.
 *
 * Status: header only; not implemented.
 */
