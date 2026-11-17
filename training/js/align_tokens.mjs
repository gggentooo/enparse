/**
 * training/js/align_tokens.mjs — align wink-nlp runtime words with UD words
 *
 * Description:
 *   At runtime, wink-nlp splits text into words before the model runs, so
 *   training words must match wink's segmentation. This script tokenizes each
 *   EWT sentence's raw text with wink-nlp, aligns the result to UD words, and
 *   transfers UPOS and chunk labels onto wink-style words.
 *
 * Phase: 3 — Tokenization alignment with runtime.
 *
 * Tasks:
 *   1. Read chunked sentences (derive_chunks.py output) with `# text =`.
 *   2. Tokenize the raw text with wink-nlp + wink-eng-lite-web-model, using
 *      the same settings as src/modules/parser/winkBackend.ts.
 *   3. Align by character offsets; handle UD multiword tokens (e.g., don't ->
 *      do + n't) by choosing the form that matches wink's split.
 *   4. Apply mapping rules (merge or split) for mismatches and define how
 *      labels transfer in each case.
 *   5. Measure word-level agreement (target >= 99.5%); write mismatch
 *      categories, counts, and examples to reports/alignment.md.
 *   6. Write aligned sentences (wink words + labels + doc/sentence ids) for
 *      prepare_data.py.
 *
 * Dependencies:
 *   Node:   wink-nlp, wink-eng-lite-web-model, js-yaml.
 *   Reads:  ../configs/data.yaml (paths.chunked, paths.aligned);
 *           data/processed/chunked/.
 *   Writes: data/processed/aligned/ (git-ignored); ../reports/alignment.md.
 *   Consumed by: scripts/prepare_data.py, js/evaluate_baselines.mjs.
 *
 * Status: header only; not implemented.
 */
