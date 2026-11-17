/**
 * training/js/benchmark.mjs — Transformers.js parity and speed tests (Node)
 *
 * Description:
 *   Loads exported ONNX models with Transformers.js outside the browser to
 *   check that predictions match Python and to time inference. Browser
 *   measurements (Phase 10) use a separate minimal Vite page.
 *
 * Phases: 6 (quick timing per candidate), 9 (parity), 10 (speed reference).
 *
 * Tasks:
 *   1. Load an export folder (fp32, int8, fp16 variants) with
 *      @huggingface/transformers as a token-classification model.
 *   2. Parity: run dev windows, decode first-subword logits with labels.json,
 *      and write predictions for scripts/evaluate.py to compare with
 *      PyTorch/onnxruntime.
 *   3. Speed: parse the fixed 5,000-character sample; report load time and
 *      median of N runs against the 5 s budget.
 *   4. Write results to ../reports/benchmark.md (Node section).
 *
 * Dependencies:
 *   Node:   @huggingface/transformers, wink-nlp (word split, same as runtime),
 *           js-yaml.
 *   Reads:  ../configs/eval.yaml (benchmark); data/onnx/<run>/;
 *           data/processed/labels.json; data/processed/dataset/ (dev).
 *   Writes: data/onnx/<run>/predictions (for evaluate.py);
 *           ../reports/benchmark.md.
 *
 * Status: header only; not implemented.
 */
