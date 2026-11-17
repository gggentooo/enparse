/**
 * src/modules/parser/types.ts — types for the parser module (proposed file)
 *
 * Description:
 *   Shared data shapes for parse results and the worker message protocol.
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Token: text, offsets, lemma, UPOS, chunk tag, label probabilities.
 *   2. Chunk: type (NP, VP, PP, ADJP, ADVP), token range.
 *   3. SentenceParse: tokens, primary chunks, alternatives (ranked, with
 *      probability and reason: probability or attachment).
 *   4. ParseResult: sentences, mode (model | basic), model version from
 *      labels.json; every Token keeps wink character offsets (traceability).
 *   5. LabelConfig: mirrors labels.json schema v1 (plan-training.md → Phase 4).
 *   6. Worker message types (request/response unions).
 *   7. Errors: ParserLoadError, ParserRuntimeError.
 *
 * Dependencies:
 *   None. Used by: all files in modules/parser/.
 *
 * Open items (plan.md → Undecided): module interfaces (parse result types).
 *
 * Status: header only; not implemented.
 */
