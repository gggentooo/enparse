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
 *   1. load(model: ModelRef): load the chosen model from its folder under
 *      public/models/<model-id>/ (own static host only). Files are already in
 *      Cache Storage (downloaded and verified by modules/modelLibrary);
 *      Transformers.js reads them from the cache (no remote models). WebGPU
 *      (fp16) first, WASM (int8) if WebGPU is unavailable. Throw
 *      ParserLoadError on failure.
 *   1b. unload(): dispose the ONNX session and tokenizer to free memory
 *      (before switching models or deleting the active one).
 *   2. Pack whole wink sentences into windows of up to WINDOW_TOKENS = 256
 *      subword tokens, no overlap, exactly like training (plan-training.md
 *      Phase 4 and Nested phrase structure → Biaffine design). Only a sentence
 *      longer than 256 subwords is split, with a 32-token overlap.
 *   3. Take first-subword logits per word. For a split sentence, each word
 *      takes its scores from the window where it is farthest from the edge
 *      (arc scores to heads outside that window: −∞).
 *   4. Apply calibration temperature from labels.json; softmax.
 *   5. Decode: top combined label per word; UPOS and chunk probabilities by
 *      summing combined-label probabilities; keep top-k for ambiguity.ts.
 *   6. Report load progress per phase (download, initialize) for the UI.
 *   7. Self-test after loading: parse a fixed sentence and compare with the
 *      expected labels; failure → ParserLoadError (`invalid-model`). The
 *      backend is ready only after it passes.
 *   8. Map load failures to typed reasons (network, unsupported,
 *      out-of-memory, invalid-model) for the `failed` status.
 *   Device capability and file-integrity checks are not done here: they run
 *   in modules/preflight before and after loading (architecture.md → Model
 *   readiness → Pre-flight checks). This backend still validates the full
 *   labels.json against LabelConfig.
 *   9. Tests: decoding with fixed logits; integration test on 20 fixed
 *      sentences vs Phase 9 outputs (plan-training.md Phase 11).
 *
 * Dependencies:
 *   External: @huggingface/transformers (Transformers.js).
 *   Internal: ./parser.ts (ParserBackend), ./types.ts.
 *   Assets: public/models/<model-id>/ (built by training/; one folder per
 *           offered model, listed in public/models/catalog.json).
 *   Used by: ./parser.worker.ts.
 *
 * Open items (todo.md): model library (hosting limits).
 *
 * Status: placeholder (T35): createTransformerBackend() returns a backend
 *   whose load() fails with ParserLoadError("unsupported"), so the worker shell
 *   runs end to end. Implementation: T63.
 */

import {
  type BackendInfo,
  type ParserBackend,
  ParserLoadError,
  ParserNotReadyError,
  type TaggedSentence,
} from "./types";

/** The ONNX backend. TODO(T63): Transformers.js loading, windows, decoding, self-test. */
export function createTransformerBackend(): ParserBackend {
  return {
    name: "transformer",
    async load(): Promise<void> {
      throw new ParserLoadError("unsupported", "The model backend is not implemented yet (T63).");
    },
    async unload(): Promise<void> {},
    isReady: (): boolean => false,
    info(): BackendInfo {
      throw new ParserNotReadyError();
    },
    async tag(): Promise<TaggedSentence[]> {
      throw new ParserNotReadyError();
    },
  };
}
