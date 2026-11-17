"""
training/scripts/export_onnx.py — export the trained tagger to ONNX for Transformers.js

Description:
    Exports the best checkpoint with Optimum (task: token-classification)
    into the folder layout Transformers.js expects, and produces int8 and
    fp16 variants.

Phases: 6 (quick export per candidate), 9 (final export and quantization),
        11 (copy to public/models/enparse-tagger/).

Tasks:
    1. Export fp32: config.json, tokenizer.json, tokenizer_config.json,
       onnx/model.onnx.
    2. int8 dynamic quantization -> onnx/model_quantized.onnx (WASM).
       Support excluding sensitive layers (embeddings, classifier) if parity
       fails.
    3. fp16 conversion -> onnx/model_fp16.onnx (WebGPU).
    4. Validate each file with onnx.checker; report file sizes against the
       proposed 80 MB cap.
    5. Phase 11 mode: copy the chosen files plus labels.json (label map,
       temperature, margin, model version, training data version) to
       public/models/enparse-tagger/ and print SHA-256 checksums.

Dependencies:
    Python: optimum[onnxruntime], onnx, onnxruntime, transformers, pyyaml.
    Reads:  configs/eval.yaml (export); configs/train_<model>.yaml
            (checkpoint); data/checkpoints/; data/processed/labels.json.
    Writes: data/onnx/<run>/ (git-ignored);
            public/models/enparse-tagger/ (Phase 11 only).
    Consumed by: scripts/evaluate.py (parity), js/benchmark.mjs.

Status: header only; not implemented.
"""
