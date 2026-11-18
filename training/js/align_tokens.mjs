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
 *   2. Run the app's preprocess() (src/modules/input) and drop sentences with
 *      removals; tokenize() the clean text with src/modules/parser/winkBackend.ts
 *      (run via tsx; one implementation, no copied settings).
 *   3. Align by character offsets (UD forms normalized with normalizeChars());
 *      handle UD multiword tokens (e.g., don't -> do + n't) by choosing the
 *      form that matches the runtime split.
 *   4. Apply mapping rules (merge or split) for mismatches; merged words take
 *      the labels of the span's head word (plan-training.md → Phase 3
 *      *Decisions*). Remap dependency heads.
 *   5. Measure word-level agreement (target >= 99.5%); write mismatch
 *      categories, counts, and examples to reports/alignment.md.
 *   6. Write aligned sentences (wink words + labels + doc/sentence ids) for
 *      prepare_data.py.
 *
 * Dependencies:
 *   Node:   tsx, js-yaml; app code: src/modules/input/index.ts,
 *           src/modules/parser/winkBackend.ts (wink-nlp resolved from root node_modules).
 *   Reads:  ../configs/data.yaml (paths.chunked, paths.aligned);
 *           data/processed/chunked/.
 *   Writes: data/processed/aligned/ (git-ignored); ../reports/alignment.md.
 *   Consumed by: scripts/prepare_data.py, js/evaluate_baselines.mjs.
 *
 * Status: header only; not implemented.
 */
