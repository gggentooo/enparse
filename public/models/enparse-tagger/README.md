<!--
public/models/enparse-tagger/README.md — shipped parser model folder

Description:
  Static model files served with the app and loaded by
  src/modules/parser/transformerBackend.ts via Transformers.js.
  Populated by training/scripts/export_onnx.py (plan-training.md Phase 11).

Tasks:
  1. Phase 11: add config.json, tokenizer.json, tokenizer_config.json,
     onnx/model_quantized.onnx (int8, WASM), onnx/model_fp16.onnx (WebGPU),
     labels.json (label map, temperature, margin, model and data versions).
  2. Record checksums and release tag in training/MODEL_CARD.md.

Dependencies:
  Produced by: training/. Consumed by: modules/parser/transformerBackend.ts.

Storage: *.onnx files here are tracked with Git LFS (root .gitattributes).

Open items (plan.md → Undecided): model size cap.

Status: placeholder; no model files yet.
-->

# enparse-tagger

Placeholder for the shipped parser model. See [`training/MODEL_CARD.md`](../../../training/MODEL_CARD.md).
