"""
training/scripts/evaluate.py — metrics, parity checks, and error analysis

Description:
    Shared evaluation for PyTorch checkpoints and ONNX exports of every
    candidate model: UPOS accuracy, chunk F1 (overall and per type), UAS/LAS
    and nested-phrase F1, ONNX parity, and error sampling. Single place where
    model metrics are computed.

Phases: 7 (dev metrics, final test evaluation per candidate, error
        analysis), 9 (ONNX parity per candidate), 12 (retrain regression checks).

Tasks:
    1. Metrics: UPOS accuracy; chunk precision/recall/F1 via seqeval,
       overall and per type (NP, VP, PP, ADJP, ADVP). Combined labels are
       split into UPOS and chunk; probabilities summed per part.
    2. Backends: PyTorch checkpoint, or ONNX file via onnxruntime.
    3. Parity mode: fp32 ONNX vs PyTorch label agreement (>= 99.9% on dev);
       int8/fp16 chunk F1 drop vs fp32 (<= 0.3 points).
    4. Test mode (Phase 7, run once per candidate): evaluate on test, compare
       with reports/baselines.md and the acceptance thresholds; record which
       candidates qualify for the model library (flat view) and the nested
       view (UAS/LAS).
    5. Error analysis: sample 100 test errors, group by type (noun/verb
       homographs, PP chunks, coordination, PP attachment, ...) per
       candidate into reports/errors.md.
    6. Write results to reports/training.md or reports/parity.md.

Dependencies:
    Python: torch, transformers, datasets, onnxruntime, seqeval, evaluate,
            numpy, pandas, pyyaml.
    Reads:  configs/eval.yaml (parity, acceptance);
            configs/train_<model>.yaml; configs/data.yaml;
            data/processed/dataset/<model>/; data/checkpoints/<model>/;
            data/onnx/<model>/;
            js/benchmark.mjs output (Transformers.js predictions for parity).
    Writes: reports/training.md, reports/errors.md, reports/parity.md.
    Shares metric code with: scripts/train.py (compute_metrics). Nested-phrase
    F1 runs src/modules/parser/treeDecoder.ts via tsx (js/).

Status: header only; not implemented.
"""
