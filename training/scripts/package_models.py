"""
training/scripts/package_models.py — package offered models and the model catalog

Description:
    Copies every model that meets the acceptance thresholds into
    public/models/<model-id>/ and writes public/models/catalog.json, the
    list the app's model library shows (src/modules/modelLibrary). Each
    catalog entry combines the descriptions in configs/catalog.yaml with
    measured facts: download sizes, test metrics (Phase 7), and browser speed
    and memory (Phase 10).

Phase: 11 — Packaging and release.

Tasks:
    1. For each configs/train_<model>.yaml: read test metrics
       (reports/training.md data), calibration (labels.json), export files
       (data/onnx/<model>/), and Phase 10 results (reports/benchmark.md data).
    2. Offer a model only if test UPOS and chunk F1 meet the acceptance
       thresholds (configs/eval.yaml → acceptance); set nested_view = true
       only if it meets the nested-view targets (acceptance.nested_view:
       UAS excl. punctuation 93%, multi-word bracket F1 88%, shown-bracket
       precision 95%). Report skipped models.
    3. Copy config, tokenizer files, labels.json (with `files` and
       `model_version` filled), onnx/model_quantized.onnx (int8) and
       onnx/model_fp16.onnx to public/models/<model-id>/ (ONNX via Git LFS).
    4. Write catalog.json (schema v1; architecture.md → Model library):
       id, display_name, description, base_model, license, model_version,
       folder, labels, variants (file, bytes), shared_files, metrics,
       nested_view, performance, requirements. Validate before writing.
    5. Check every labels.json passes validate_labels_json with no needed
       field null, and print SHA-256 checksums for MODEL_CARD.md.

Dependencies:
    Python: pyyaml.
    Reads:  configs/catalog.yaml, configs/eval.yaml, configs/train_<model>.yaml;
            data/onnx/<model>/; Phase 7 and Phase 10 result data.
    Writes: public/models/<model-id>/, public/models/catalog.json.
    Consumed by: the app (modules/modelLibrary, modules/parser).

Status: header only; not implemented.
"""
