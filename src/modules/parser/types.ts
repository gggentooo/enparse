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
 *      probability (model mode; null in basic mode).
 *   2. Chunk: type (NP, VP, PP, ADJP, ADVP), token range (flat view).
 *   3. PhraseNode (proposed): type, token range, head token, children
 *      (nested view; built by treeDecoder.ts; plan-training.md → Nested
 *      phrase structure).
 *   4. SentenceParse: tokens, primary chunks, phrases (root PhraseNode, or
 *      null in basic mode), treeRepaired flag, alternatives (ranked, with
 *      probability and reason: probability or attachment).
 *   5. ParseResult: sentences, mode (model | basic), model version from
 *      labels.json; every Token keeps wink character offsets (traceability).
 *   6. LabelConfig: mirrors labels.json schema v1 (plan-training.md → Phase 4),
 *      including label groups and dep_encoding.
 *   7. Worker message types (request/response unions).
 *   8. Errors: ParserLoadError, ParserRuntimeError, TokenizerError (done).
 *
 * Dependencies:
 *   None. Used by: all files in modules/parser/.
 *
 * Open items (plan.md → Undecided): module interfaces (parse result types).
 *
 * Status: word and sentence spans implemented (Phase 3 pre-work); tasks 1–8 pending.
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
