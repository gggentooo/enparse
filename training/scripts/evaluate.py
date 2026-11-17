"""
training/scripts/evaluate.py — metrics, parity checks, and error analysis

Description:
    Shared evaluation for PyTorch checkpoints and ONNX exports: UPOS
    accuracy and chunk F1 (overall and per type), ONNX parity, and error
    sampling. Single place where model metrics are computed.

Phases: 6 (dev metrics), 7 (final test evaluation, error analysis),
        9 (ONNX parity), 12 (retrain regression checks).

Tasks:
    1. Metrics: UPOS accuracy; chunk precision/recall/F1 via seqeval,
       overall and per type (NP, VP, PP, ADJP, ADVP). Combined labels are
       split into UPOS and chunk; probabilities summed per part.
    2. Backends: PyTorch checkpoint, or ONNX file via onnxruntime.
    3. Parity mode: fp32 ONNX vs PyTorch label agreement (>= 99.9% on dev);
       int8/fp16 chunk F1 drop vs fp32 (<= 0.3 points).
    4. Test mode (Phase 7, run once): evaluate on test, compare with
       reports/baselines.md and acceptance thresholds.
    5. Error analysis: sample 100 test errors, group by type (noun/verb
       homographs, PP chunks, coordination, ...) into reports/errors.md.
    6. Write results to reports/training.md or reports/parity.md.

Dependencies:
    Python: torch, transformers, datasets, onnxruntime, seqeval, evaluate,
            numpy, pandas, pyyaml.
    Reads:  configs/eval.yaml (parity, acceptance);
            configs/train_<model>.yaml; configs/data.yaml;
            data/processed/; data/checkpoints/; data/onnx/;
            js/benchmark.mjs output (Transformers.js predictions for parity).
    Writes: reports/training.md, reports/errors.md, reports/parity.md.
    Shares metric code with: scripts/train.py (compute_metrics).

Status: header only; not implemented.
"""
