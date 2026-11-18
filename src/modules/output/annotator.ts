/**
 * src/modules/output/annotator.ts — parse result → annotation model
 *
 * Description:
 *   Converts parse results into a render-ready annotation model (chunks,
 *   tokens, highlights, alternatives). Pure logic; rendering is in
 *   components/Pages/OutputPage.tsx.
 *
 * Layer: modules/ (output)
 *
 * Tasks:
 *   1. Map sentences → paragraphs/sentences/chunks/tokens with stable ids for
 *      React keys and word selection.
 *   2. Attach chunk labels and display metadata (type, "most likely" flag).
 *   3. Attach alternatives per sentence with rank and reason (probability or
 *      PP attachment), capped by the parser's limit.
 *   4. Carry the model id, model version, and backend for display and
 *      traceability.
 *   5. Expose token lookup data (surface form + lemma) for dictionary and
 *      subword lookups.
 *   6. Unit tests in annotator.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none.
 *   Must not import modules/parser (no cross-module imports). The input
 *   shape is defined in ./types.ts and structurally matches the parser's
 *   ParseResult; parserService passes it through.
 *   Used by: services/parserService.ts (via ./index.ts).
 *
 * Open items (plan.md → Undecided): module interfaces; grammar label language
 *   (e.g., 명사구); parse-display style.
 *
 * Status: header only; not implemented.
 */
