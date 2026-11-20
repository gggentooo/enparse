/**
 * src/modules/output/annotator.ts — parse result → annotation model
 *
 * Description:
 *   Converts parse results into a render-ready annotation model (flat chunks,
 *   labeled nested phrases with grammatical roles and head markers, tokens,
 *   highlights, alternatives). Pure logic; rendering is in
 *   components/Pages/OutputPage.tsx.
 *
 * Layer: modules/ (output)
 *
 * Tasks:
 *   1. Map sentences → paragraphs/sentences/chunks/nested phrases/tokens with
 *      stable ids for React keys and word selection.
 *   2. Attach chunk labels, nested phrase categories/roles (e.g., NP(Subject),
 *      VP(Predicate)), head-of-parent flags (isHead), non-contiguous span
 *      indicators, and display metadata ("most likely" flag).
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
 * Open items (todo.md): module interfaces; nested phrase labeling;
 *   grammar label language (e.g., 명사구, 주어); parse-display style.
 *
 * Status: header only; not implemented.
 */
