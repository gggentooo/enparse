<!--
public/models/README.md — shipped parser models (model library)

Description:
  Static model files served with the app. The app offers every model listed
  in catalog.json; the user chooses one in the model library
  (src/modules/modelLibrary, #/models). Populated by
  training/scripts/package_models.py (plan-training.md Phase 11).

Layout (Phase 11):
  catalog.json                 model catalog (schema v1): ids, descriptions,
                               sizes, metrics, speed, requirements
  <model-id>/                  one folder per offered model, e.g.
                               distilbert_base_cased/
    config.json, tokenizer.json, tokenizer_config.json
    labels.json                label map, calibration, versions, file checksums
    onnx/model_quantized.onnx  int8 (WASM)
    onnx/model_fp16.onnx       fp16 (WebGPU)

Tasks:
  1. Phase 11: package every model that meets the acceptance thresholds.
  2. Record checksums and release tag in training/MODEL_CARD.md.

Dependencies:
  Produced by: training/. Consumed by: modules/modelLibrary (catalog,
  downloads), modules/parser/transformerBackend.ts (loading).

Storage: *.onnx files here are tracked with Git LFS (root .gitattributes).

Open items (todo.md): model library (hosting and storage limits
  for several models).

Status: placeholder; no model files yet.
-->

# Shipped models

Placeholder for the model library. See [`training/MODEL_CARD.md`](../../training/MODEL_CARD.md).
