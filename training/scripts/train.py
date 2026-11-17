"""
training/scripts/train.py — fine-tune a base model as the UPOS|CHUNK token classifier

Description:
    Trains AutoModelForTokenClassification with a single combined-label head
    on the processed dataset, using Unsloth or the Hugging Face Trainer
    (per the config's `framework`). Logs to TensorBoard and keeps the best
    checkpoint by dev chunk F1.

Phases: 6 (base model selection), 7 (full training and tuning).

Tasks:
    1. Load configs/train_<model>.yaml and configs/data.yaml (path via CLI).
    2. Load the processed dataset and labels.json; build id2label/label2id.
    3. Load the base model on MPS via Unsloth or Trainer.
    4. Train with config hyperparameters (LR schedule, warmup, batch size,
       weight decay, epochs, precision) and early stopping on dev chunk F1.
    5. compute_metrics: UPOS accuracy and chunk F1 (seqeval), derived by
       splitting the combined label; shared with scripts/evaluate.py.
    6. Support LR sweep and multi-seed runs (one run per seed/LR).
    7. Save best checkpoint and a run summary (config, seed, data version,
       dev metrics, training time) for reports/model_selection.md and
       reports/training.md.
    8. Optional experiments (Phase 7 task 3): augmentation, GUM data,
       two-head model — kept only if dev F1 improves.

Dependencies:
    Python: torch (MPS), unsloth (optional), transformers, accelerate,
            datasets, seqeval, evaluate, tensorboard, pyyaml.
    Reads:  configs/train_<model>.yaml; configs/data.yaml;
            data/processed/dataset/, data/processed/labels.json.
    Writes: data/checkpoints/<run>/, data/runs/<run>/ (TensorBoard)
            (git-ignored); run summary for reports/.
    Consumed by: scripts/calibrate.py, scripts/export_onnx.py,
                 scripts/evaluate.py.

Status: header only; not implemented.
"""
