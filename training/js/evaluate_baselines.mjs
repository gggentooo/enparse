/**
 * training/js/evaluate_baselines.mjs — accuracy of the JS baseline taggers
 *
 * Description:
 *   Sets the bar the trained model must beat. Runs wink-nlp (POS tags only)
 *   and compromise (POS tags and chunks) on EWT dev and test, using the
 *   Phase 3 word segmentation, and reports UPOS accuracy (both) and chunk F1
 *   (compromise). There is no rule-based chunker for wink-nlp (the app has
 *   no fallback mode).
 *
 * Phase: 5 — Baseline evaluation (re-run in Phase 12 when patterns change).
 * Run with: tsx evaluate_baselines.mjs
 *
 * Tasks:
 *   1. Load aligned dev/test sentences (align_tokens.mjs output).
 *   2. wink baseline: POS tags from wink-nlp on the aligned words (wink tags
 *      are already UPOS); UPOS accuracy only.
 *   3. compromise baseline: tag and chunk with compromise.
 *   4. Map compromise tags to UPOS and BIO chunk tags (mapping tables kept in
 *      this file, documented in the report).
 *   5. Compute UPOS accuracy (both) and chunk P/R/F1 (compromise; overall and
 *      per type) with CoNLL-style span matching equivalent to seqeval.
 *   6. Write reports/baselines.md.
 *
 * Dependencies:
 *   Node:   wink-nlp, wink-eng-lite-web-model, compromise, tsx, js-yaml.
 *   App:    none (wink-nlp is called directly; words come from the Phase 3
 *           aligned data, which already used the app's tokenizer).
 *   Reads:  ../configs/data.yaml; data/processed/aligned/.
 *   Writes: ../reports/baselines.md.
 *
 * Status: header only; not implemented.
 */
