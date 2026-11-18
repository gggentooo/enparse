/**
 * src/modules/parser/treeDecoder.ts — head labels → dependency tree → nested phrases (proposed file)
 *
 * Description:
 *   Turns the model's structure output (group B labels, relative-POS head
 *   encoding `<offset>@<head UPOS>|<relation>`) into a valid dependency tree
 *   per sentence, then into nested phrases for the nested view. Fixed
 *   decoding procedure only; no grammar rules (plan-training.md → Nested
 *   phrase structure).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Resolve each token's head from its label and group-A UPOS.
 *   2. Repair: unresolved heads or cycles → next-best label, else attach to
 *      root; exactly one root per sentence. Set treeRepaired.
 *   3. Build PhraseNodes head-outward: right dependents (closest first), then
 *      left dependents (closest first); one nesting level per step.
 *   4. Punctuation is not bracketed; label phrases from the head (NP, VP,
 *      ADJP, ADVP; nominal with `case` dependent → PP).
 *   5. Expose the bracketing for ambiguity.ts (alternative trees from
 *      top-two head labels).
 *
 * Dependencies:
 *   Internal: parser/types.ts (Token, PhraseNode, LabelConfig).
 *   Used by: ./parser.ts, ./ambiguity.ts; training/js (nested-phrase F1 via tsx,
 *   plan-training.md → Phase 7).
 *
 * Open items (plan.md → Undecided): nested phrase view (design, thresholds,
 *   bracketing convention).
 *
 * Status: header only; not implemented.
 */
