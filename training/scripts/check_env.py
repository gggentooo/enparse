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
          on MPS with a small dummy label set (skipped if Unsloth is not
          installed).
       b. Run N training steps on dummy inputs and labels (eval.yaml →
          env_check).
       c. On failure (unsupported architecture, task, or device), repeat
          with the plain Hugging Face Trainer.
    4. Print a per-model summary table (unsloth / hf_trainer / failed) to
       copy into plan-training.md → Phase 0 and the configs' `framework` key.
    5. Exit non-zero if any model fails with both frameworks.

Dependencies:
    Python: torch (MPS), transformers, accelerate, pyyaml; unsloth optional.
    Reads:  configs/train_*.yaml (model_name, max_seq_length),
            configs/eval.yaml (env_check).
    Writes: nothing persistent (stdout summary only; temp dir for Trainer).
    Network: downloads base model weights from the Hugging Face Hub on
             first run (development only; never at app runtime).

Usage (from training/):
    python scripts/check_env.py [--only <substring>] [--skip-unsloth]

Status: implemented (Phase 0).
"""

from __future__ import annotations

import argparse
import importlib.metadata
import math
import platform
import random
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
import yaml
from torch.utils.data import Dataset
from transformers import (
    AutoModelForTokenClassification,
    AutoTokenizer,
    DataCollatorForTokenClassification,
    PreTrainedModel,
    PreTrainedTokenizerBase,
    Trainer,
    TrainingArguments,
)

CONFIG_DIR = Path(__file__).resolve().parent.parent / "configs"
IGNORE_INDEX = -100

# Fixed word list for dummy inputs; content is irrelevant, only shape matters.
DUMMY_WORDS = (
    "The quick brown fox jumps over the lazy dog while Seoul students don't "
    "stop reading unbelievably long sentences , and they keep learning ."
).split()


@dataclass
class RunResult:
    """Outcome of one dummy training run."""

    ok: bool
    detail: str


class DummyTokenDataset(Dataset):
    """Pre-tokenized dummy examples with first-subword labels."""

    def __init__(self, features: list[dict[str, list[int]]]) -> None:
        self.features = features

    def __len__(self) -> int:
        return len(self.features)

    def __getitem__(self, idx: int) -> dict[str, list[int]]:
        return self.features[idx]


def load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file into a dict (empty dict for an empty file)."""
    data = yaml.safe_load(path.read_text())
    return data if isinstance(data, dict) else {}


def package_version(name: str) -> str:
    """Return an installed package version or 'not installed'."""
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not installed"


def build_features(
    tokenizer: PreTrainedTokenizerBase,
    num_examples: int,
    num_labels: int,
    max_seq_length: int,
    rng: random.Random,
) -> list[dict[str, list[int]]]:
    """Tokenize dummy word sequences; label only the first subword of each word."""
    features: list[dict[str, list[int]]] = []
    for _ in range(num_examples):
        words = [rng.choice(DUMMY_WORDS) for _ in range(max_seq_length)]
        enc = tokenizer(
            words,
            is_split_into_words=True,
            truncation=True,
            max_length=max_seq_length,
        )
        word_labels = [rng.randrange(num_labels) for _ in words]
        labels: list[int] = []
        prev: int | None = None
        for word_id in enc.word_ids():
            if word_id is None or word_id == prev:
                labels.append(IGNORE_INDEX)
            else:
                labels.append(word_labels[word_id])
            prev = word_id
        features.append(
            {
                "input_ids": enc["input_ids"],
                "attention_mask": enc["attention_mask"],
                "labels": labels,
            }
        )
    return features


def load_with_hf(model_name: str, num_labels: int) -> PreTrainedModel:
    """Load the model with plain transformers."""
    return AutoModelForTokenClassification.from_pretrained(model_name, num_labels=num_labels)


def load_with_unsloth(model_name: str, num_labels: int, max_seq_length: int) -> PreTrainedModel:
    """Load the model through Unsloth's FastModel (full fine-tuning, fp32)."""
    from unsloth import FastModel  # noqa: PLC0415 — optional dependency

    model, _ = FastModel.from_pretrained(
        model_name=model_name,
        auto_model=AutoModelForTokenClassification,
        num_labels=num_labels,
        max_seq_length=max_seq_length,
        dtype=torch.float32,
        load_in_4bit=False,
        full_finetuning=True,
    )
    return model


def train_dummy(
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerBase,
    features: list[dict[str, list[int]]],
    check: dict[str, Any],
) -> RunResult:
    """Run the dummy training loop on MPS and check the result."""
    with tempfile.TemporaryDirectory(prefix="enparse-check-") as tmp:
        args = TrainingArguments(
            output_dir=tmp,
            max_steps=int(check["steps"]),
            per_device_train_batch_size=int(check["batch_size"]),
            learning_rate=float(check["learning_rate"]),
            seed=int(check["seed"]),
            logging_steps=max(1, int(check["steps"]) // 5),
            save_strategy="no",
            report_to="none",
            dataloader_pin_memory=False,
            use_cpu=False,
        )
        trainer = Trainer(
            model=model,
            args=args,
            train_dataset=DummyTokenDataset(features),
            data_collator=DataCollatorForTokenClassification(tokenizer),
        )
        start = time.perf_counter()
        output = trainer.train()
        elapsed = time.perf_counter() - start

    device = next(model.parameters()).device.type
    loss = float(output.training_loss)
    if device != "mps":
        return RunResult(False, f"ran on {device}, not mps")
    if not math.isfinite(loss):
        return RunResult(False, f"non-finite loss {loss}")
    steps = int(output.global_step)
    return RunResult(True, f"{steps} steps, loss {loss:.3f}, {elapsed:.1f}s on mps")


def run_one(
    framework: str,
    model_name: str,
    max_seq_length: int,
    check: dict[str, Any],
) -> RunResult:
    """Load and train one model with one framework; never raises."""
    try:
        num_labels = int(check["num_dummy_labels"])
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        features = build_features(
            tokenizer,
            num_examples=int(check["batch_size"]) * 4,
            num_labels=num_labels,
            max_seq_length=max_seq_length,
            rng=random.Random(int(check["seed"])),
        )
        if framework == "unsloth":
            model = load_with_unsloth(model_name, num_labels, max_seq_length)
        else:
            model = load_with_hf(model_name, num_labels)
        return train_dummy(model, tokenizer, features, check)
    except Exception as exc:  # noqa: BLE001 — report every failure in the summary
        traceback.print_exc()
        return RunResult(False, f"{type(exc).__name__}: {str(exc).splitlines()[0][:160]}")
    finally:
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()


def main() -> int:
    """Run the environment check and print the summary table."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--only", help="run only configs whose filename contains this text")
    parser.add_argument("--skip-unsloth", action="store_true", help="do not try Unsloth")
    cli = parser.parse_args()

    check = load_yaml(CONFIG_DIR / "eval.yaml")["env_check"]
    unsloth_version = package_version("unsloth")
    print(f"python        {platform.python_version()} ({platform.machine()})")
    print(f"torch         {torch.__version__}")
    print(f"transformers  {package_version('transformers')}")
    print(f"unsloth       {unsloth_version}")
    mps = torch.backends.mps
    print(f"mps available {mps.is_available()}, built {mps.is_built()}")
    if not torch.backends.mps.is_available():
        print("FAIL: torch.backends.mps.is_available() is False")
        return 1

    try_unsloth = unsloth_version != "not installed" and not cli.skip_unsloth
    rows: list[tuple[str, str, str, str]] = []
    for path in sorted(CONFIG_DIR.glob("train_*.yaml")):
        if cli.only and cli.only not in path.name:
            continue
        cfg = load_yaml(path)
        model_name = str(cfg["model_name"])
        max_seq_length = int(cfg["max_seq_length"])
        print(f"\n=== {model_name} ({path.name}) ===")

        if try_unsloth:
            unsloth = run_one("unsloth", model_name, max_seq_length, check)
        elif unsloth_version == "not installed":
            unsloth = RunResult(False, "skipped (not installed)")
        else:
            unsloth = RunResult(False, "skipped")
        if unsloth.ok:
            hf = RunResult(False, "not run")
        else:
            hf = run_one("hf_trainer", model_name, max_seq_length, check)

        framework = "unsloth" if unsloth.ok else "hf_trainer" if hf.ok else "FAILED"
        rows.append((model_name, framework, unsloth.detail, hf.detail))

    print("\n| Model | Framework | Unsloth | HF Trainer |")
    print("|-------|-----------|---------|------------|")
    for row in rows:
        print("| " + " | ".join(row) + " |")
    return 1 if any(r[1] == "FAILED" for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
