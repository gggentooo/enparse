"""
training/scripts/check_env.py — environment and training-framework smoke test
(proposed file; not in the original plan-training.md layout)

Description:
    Verifies the Phase 0 exit criterion: PyTorch sees MPS, and a dummy
    token-classification training run completes for every candidate model.
    Decides per model whether Unsloth works or the Hugging Face Trainer
    fallback must be used.

Phase: 0 — Environment setup and tooling check.

Tasks:
    1. Print Python, torch, transformers, and unsloth versions.
    2. Assert torch.backends.mps.is_available() is True.
    3. For each configs/train_<model>.yaml:
       a. Load the base model as AutoModelForTokenClassification via Unsloth
          on MPS with a small dummy label set.
       b. Run 50 training steps on dummy inputs and labels.
       c. On failure (unsupported architecture, task, or device), repeat
          with the plain Hugging Face Trainer.
    4. Print a per-model summary table (unsloth / hf_trainer / failed) to
       copy into plan-training.md → Phase 0 and the configs' `framework` key.
    5. Exit non-zero if any model fails with both frameworks.

Dependencies:
    Python: torch (MPS), unsloth, transformers, accelerate, pyyaml.
    Reads:  configs/train_*.yaml (model_name).
    Writes: nothing persistent (stdout summary only).
    Network: downloads base model weights from the Hugging Face Hub on
             first run (development only; never at app runtime).

Status: header only; not implemented.
"""
