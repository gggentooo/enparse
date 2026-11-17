/**
 * src/modules/parser/transformerBackend.ts — primary ParserBackend (ONNX tagger)
 *
 * Description:
 *   Runs the in-house UPOS|CHUNK token classifier in the browser with
 *   Transformers.js and decodes logits into labels with probabilities.
 *
 * Layer: modules/ (parser). Runs only inside parser.worker.ts.
 *
 * Tasks:
 *   1. load(): fetch labels.json and the model from public/models/enparse-tagger/
 *      (own static host only); WebGPU (fp16) first, WASM (int8) fallback.
 *      Throw ParserLoadError on failure.
 *   2. Build overlapping windows of up to WINDOW_TOKENS = 256 subword tokens
 *      from wink words (same size as training; plan-training.md Phase 4).
 *   3. Take first-subword logits per word; merge overlapping windows.
 *   4. Apply calibration temperature from labels.json; softmax.
 *   5. Decode: top combined label per word; UPOS and chunk probabilities by
 *      summing combined-label probabilities; keep top-k for ambiguity.ts.
 *   6. Report load progress (for the UI) and memory/device capability for
 *      fallback decisions.
 *   7. Tests: decoding with fixed logits; integration test on 20 fixed
 *      sentences vs Phase 9 outputs (plan-training.md Phase 11).
 *
 * Dependencies:
 *   External: @huggingface/transformers (Transformers.js).
 *   Internal: ./parser.ts (ParserBackend), ./types.ts.
 *   Assets: public/models/enparse-tagger/ (built by training/).
 *   Used by: ./parser.worker.ts.
 *
 * Open items (plan.md → Undecided): base model, model size cap.
 *
 * Status: header only; not implemented.
 */
