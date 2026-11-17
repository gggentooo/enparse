/**
 * src/modules/parser/chunkPatterns.ts — fallback POS patterns for chunking
 *
 * Description:
 *   Rule-based chunker for fallback mode: turns UPOS sequences into BIO
 *   chunk tags for NP, VP, PP, and ADJP (ADVP if feasible).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Declarative pattern table (UPOS sequences per chunk type), exported
 *      as a constant for review and tests.
 *   2. chunk(upos: string[]): string[] — greedy longest-match, left to right.
 *   3. Align patterns with training/scripts/derive_chunks.py rules where
 *      possible, so fallback and model chunks look alike.
 *   4. Unit tests in chunkPatterns.test.ts.
 *   5. Must be pure TypeScript with no browser APIs: also run in Node via tsx
 *      by training/js/evaluate_baselines.mjs.
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none.
 *   Used by: ./winkBackend.ts; training/js/evaluate_baselines.mjs (via tsx).
 *
 * Open items (plan.md → Undecided): fallback chunk patterns.
 *
 * Status: header only; not implemented.
 */
