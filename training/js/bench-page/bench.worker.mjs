/**
 * training/js/bench-page/bench.worker.mjs — Web Worker for the browser benchmark
 *
 * Description:
 *   Mirrors the app's parsing path (wink word split → windows of 256 subword
 *   tokens → Transformers.js token classification) inside a Web Worker and
 *   reports timings to index.html.
 *
 * Phases: 6, 10 — Browser benchmarking.
 *
 * Tasks:
 *   1. Load the model from the selected export folder with
 *      @huggingface/transformers (device and dtype from the page).
 *   2. Measure first load (download + init) and cached load.
 *   3. Parse the fixed 5,000-character sample N times; report the median.
 *   4. Report errors as messages; no silent failures.
 *   5. When the app's parser exists, reuse src/modules/parser code instead of
 *      duplicating it (TODO once transformerBackend.ts is implemented).
 *
 * Dependencies:
 *   Node/browser: @huggingface/transformers, wink-nlp, wink-eng-lite-web-model.
 *   Data: fixed sample text (shared with js/benchmark.mjs); exported model
 *         files in training/data/onnx/<run>/ served by Vite.
 *   Used by: ./index.html.
 *
 * Status: header only; not implemented.
 */
