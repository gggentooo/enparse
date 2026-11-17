/**
 * training/js/evaluate_baselines.mjs — accuracy of the JS baseline taggers
 *
 * Description:
 *   Sets the bar the trained model must beat. Runs the app's fallback
 *   (wink-nlp POS + chunkPatterns.ts) and compromise on EWT dev and test,
 *   using the Phase 3 word segmentation, and reports UPOS accuracy and
 *   chunk F1.
 *
 * Phase: 5 — Baseline evaluation (re-run in Phase 12 when patterns change).
 * Run with: tsx evaluate_baselines.mjs
 *
 * Tasks:
 *   1. Load aligned dev/test sentences (align_tokens.mjs output).
 *   2. wink baseline: tag with wink-nlp; chunk with the app's
 *      src/modules/parser/chunkPatterns.ts (same code as runtime fallback).
 *   3. compromise baseline: tag and chunk with compromise.
 *   4. Map each baseline's tags to UPOS and BIO chunk tags (mapping tables
 *      kept in this file, documented in the report).
 *   5. Compute UPOS accuracy and chunk P/R/F1 (overall and per type) with
 *      CoNLL-style span matching equivalent to seqeval.
 *   6. Write reports/baselines.md.
 *
 * Dependencies:
 *   Node:   wink-nlp, wink-eng-lite-web-model, compromise, tsx, js-yaml.
 *   App:    src/modules/parser/chunkPatterns.ts, imported directly and run
 *           through tsx (src/ is populated before Phase 5 starts).
 *   Reads:  ../configs/data.yaml; data/processed/aligned/.
 *   Writes: ../reports/baselines.md.
 *
 * Status: header only; not implemented.
 */
