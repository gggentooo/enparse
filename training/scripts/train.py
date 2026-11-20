"""
training/scripts/train.py — fine-tune a candidate as the two-group token classifier

Description:
    Trains one candidate base model (configs/train_<model>.yaml) as an
    AutoModelForTokenClassification whose classifier has |A| + |B| outputs:
    group A `UPOS|CHUNK` and group B head/relation (plan-training.md → Key
    design decisions). A Trainer subclass applies a separate softmax and
    cross-entropy loss to each slice. Every candidate is trained; models
    that meet the acceptance thresholds are offered in the app's model
    library (no single base model is chosen).

Phase: 7 — Full training and tuning (incl. the smoke test at its start).

Tasks:
    1. Load configs/train_<model>.yaml and configs/data.yaml; load
       data/processed/dataset/<model>/ and its labels.json (groups, id2label).
    2. Model on MPS with the Hugging Face Trainer; `compute_loss` = group A
       loss + λ × group B loss (labels_chunk, labels_dep; -100 ignored).
    3. compute_metrics on dev: UPOS accuracy, chunk F1 (seqeval), UAS/LAS
       (group B decoded with the rel_pos_v1 decoder); early stopping and the
       best checkpoint use `select` = mean of dev chunk F1 and LAS (LAS improves
       more slowly than chunk F1; stopping on chunk F1 alone under-trains the
       nested view).
    4. --smoke: 1 epoch on a small train subset, then export and Node
       Transformers.js load check (plan-training.md → Phase 7 task 0).
    5. LR sweep, λ sweep, and multi-seed runs (one run per setting); keep only
       the best checkpoint per run (save_only_model) to bound disk use.
    6. Save a run summary (config, seed, data version, dev metrics, training
       time) for reports/training.md.
    7. --head biaffine (T51; plan-training.md → Biaffine design): group B is
       the relation, and a biaffine arc scorer (scripts/biaffine.py) adds
       `arc_scores`; loss = group A + λ × (relation + arc), the arc part a
       cross-entropy over heads in the word's sentence plus root. Dev UAS/LAS
       use the per-word argmax head (metrics.biaffine_words). Data:
       data/processed/dataset_arc/ (--augment: dataset_arc_aug/, the Phase 4
       augmentation experiment). Arc scorer size: configs/eval.yaml → biaffine.

Usage (from training/):
    python scripts/train.py --model distilbert_base_cased --smoke
    python scripts/train.py --model distilbert_base_cased [--lr 3e-5] [--dep-weight 1.0] [--seed 13]
    python scripts/train.py --model distilbert_base_cased --sweep lr|dep_weight|seeds
    python scripts/train.py --model distilbert_base_cased --head biaffine [--augment] [--smoke]

Dependencies:
    Python: torch (MPS), transformers, accelerate, datasets, seqeval,
            tensorboard, pyyaml; scripts/metrics.py, scripts/prepare_data.py.
    Reads:  configs/train_<model>.yaml; configs/data.yaml;
            data/processed/dataset/<model>/.
    Writes: data/checkpoints/<model>/<run>/, data/runs/<model>/ (TensorBoard;
            git-ignored); run summaries for reports/training.md.

Status: implemented (Phase 7: base and extended stages run; biaffine head for T51).
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import torch
import torch.nn.functional as F
import yaml

from metrics import LabelSpace, WindowPrediction, biaffine_words, score, word_argmax
from prepare_data import IGNORE

if TYPE_CHECKING:
    from datasets import Dataset
    from transformers import PreTrainedModel, PreTrainedTokenizerBase

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
HEADS = ("rel_pos", "biaffine")
BEST_METRIC = "select"  # mean of SELECTION_KEYS on dev: early stopping and best checkpoint
SELECTION_KEYS = ("chunk_f1", "las")


@dataclass(frozen=True)
class RunSettings:
    """Hyperparameters of one run."""

    learning_rate: float
    dep_loss_weight: float
    seed: int
    epochs: int
    batch_size: int
    grad_accum_steps: int
    warmup_ratio: float
    weight_decay: float
    early_stopping_patience: int
    lr_schedule: str = "linear"
    head: str = "rel_pos"
    augment: bool = False

    @classmethod
    def from_config(cls, cfg: dict[str, Any]) -> RunSettings:
        """Defaults from configs/train_<model>.yaml."""
        return cls(
            learning_rate=float(cfg["learning_rate"]),
            dep_loss_weight=float(cfg["dep_loss_weight"]),
            seed=int(cfg["seeds"][0]),
            epochs=int(cfg["epochs"]),
            batch_size=int(cfg["batch_size"]),
            grad_accum_steps=int(cfg["grad_accum_steps"]),
            warmup_ratio=float(cfg["warmup_ratio"]),
            weight_decay=float(cfg["weight_decay"]),
            early_stopping_patience=int(cfg["early_stopping_patience"]),
            lr_schedule=str(cfg["lr_schedule"]),
        )


# -- batching and loss ---------------------------------------------------------


class Collator:
    """Pads input_ids / attention_mask with the pad id / 0, label columns with -100, and
    token_sent with -1. Only columns present in the features are batched."""

    def __init__(self, pad_token_id: int) -> None:
        self.pad = pad_token_id

    def __call__(self, features: list[dict[str, Any]]) -> dict[str, torch.Tensor]:
        """Batch the tensor columns; other columns are ignored."""
        length = max(len(f["input_ids"]) for f in features)
        fill = {
            "input_ids": self.pad,
            "attention_mask": 0,
            "labels_chunk": IGNORE,
            "labels_dep": IGNORE,
            "labels_rel": IGNORE,
            "labels_head": IGNORE,
            "token_sent": -1,
        }
        out: dict[str, torch.Tensor] = {}
        for key, value in fill.items():
            if key not in features[0]:
                continue
            rows = [list(f[key]) + [value] * (length - len(f[key])) for f in features]
            out[key] = torch.tensor(rows, dtype=torch.long)
        return out


LABEL_COLUMNS = ("labels_chunk", "labels_dep", "labels_rel", "labels_head", "token_sent")


def two_group_loss(
    logits: torch.Tensor,
    labels_chunk: torch.Tensor,
    labels_dep: torch.Tensor,
    n_chunk: int,
    dep_weight: float,
) -> torch.Tensor:
    """Group A loss + dep_weight × group B loss; each a mean over labeled tokens (0 if none)."""

    def part(slice_logits: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        flat = labels.reshape(-1)
        count = (flat != IGNORE).sum()
        total = F.cross_entropy(
            slice_logits.reshape(-1, slice_logits.shape[-1]),
            flat,
            ignore_index=IGNORE,
            reduction="sum",
        )
        return total / count.clamp(min=1)

    return part(logits[..., :n_chunk], labels_chunk) + dep_weight * part(
        logits[..., n_chunk:], labels_dep
    )


def biaffine_group_loss(
    logits: torch.Tensor,
    arc_scores: torch.Tensor,
    labels_chunk: torch.Tensor,
    labels_rel: torch.Tensor,
    labels_head: torch.Tensor,
    token_sent: torch.Tensor,
    n_chunk: int,
    dep_weight: float,
) -> torch.Tensor:
    """Group A loss + dep_weight × (relation loss + arc loss); each a mean over labeled tokens."""
    from biaffine import arc_loss

    flat = two_group_loss(logits, labels_chunk, labels_rel, n_chunk, dep_weight)
    return flat + dep_weight * arc_loss(arc_scores, labels_head, token_sent)


def predict(
    model: PreTrainedModel,
    dataset: Dataset,
    space: LabelSpace,
    collator: Collator,
    batch_size: int,
    device: torch.device,
) -> list[WindowPrediction]:
    """Argmax predictions per word for every window (first subword)."""
    model.eval()
    preds: list[WindowPrediction] = []
    with torch.no_grad():
        for start in range(0, len(dataset), batch_size):
            rows = [dataset[i] for i in range(start, min(start + batch_size, len(dataset)))]
            batch = collator(rows)
            out = model(
                input_ids=batch["input_ids"].to(device),
                attention_mask=batch["attention_mask"].to(device),
            )
            logits_np = out.logits.float().cpu().numpy()
            arc_np = (
                out.arc_scores.float().cpu().numpy()
                if getattr(out, "arc_scores", None) is not None
                else None
            )
            for k, row in enumerate(rows):
                length = len(row["input_ids"])
                if arc_np is not None:
                    preds.append(
                        biaffine_words(
                            logits_np[k, :length],
                            arc_np[k, :length, :length],
                            row["token_word"],
                            row["word_sent"],
                            space,
                        )
                    )
                    continue
                pa, pb = word_argmax(logits_np[k, :length], row["token_word"], space)
                preds.append(WindowPrediction(pa, pb))
    return preds


def evaluate_model(
    model: PreTrainedModel,
    dataset: Dataset,
    space: LabelSpace,
    collator: Collator,
    batch_size: int,
    device: torch.device,
) -> dict[str, Any]:
    """Word-level dev metrics (scripts/metrics.py)."""
    preds = predict(model, dataset, space, collator, batch_size, device)
    return score((dataset[i] for i in range(len(dataset))), preds, space)


# -- training ------------------------------------------------------------------


def pick_device(name: str) -> torch.device:
    """`auto` → MPS if available, else CPU."""
    if name == "auto":
        return torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    return torch.device(name)


def flat_metrics(metrics: dict[str, Any], prefix: str = "eval_") -> dict[str, float]:
    """Numeric metrics with a prefix (per-type F1 flattened), for Trainer logs."""
    out = {f"{prefix}{k}": float(v) for k, v in metrics.items() if isinstance(v, (int, float))}
    if all(k in metrics for k in SELECTION_KEYS):
        out[f"{prefix}{BEST_METRIC}"] = sum(float(metrics[k]) for k in SELECTION_KEYS) / len(
            SELECTION_KEYS
        )
    for t, v in metrics.get("per_type", {}).items():
        out[f"{prefix}f1_{t}"] = float(v["f1"])
    return out


def train_run(
    *,
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerBase,
    labels_json: dict[str, Any],
    train_ds: Dataset,
    dev_ds: Dataset,
    settings: RunSettings,
    run_dir: Path,
    device: torch.device,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Train one run; keep only the best checkpoint (run_dir/best); return the run summary."""
    from transformers import EarlyStoppingCallback, Trainer, TrainingArguments

    space = LabelSpace.from_labels_json(labels_json)
    n_chunk = space.n_chunk
    collator = Collator(tokenizer.pad_token_id if tokenizer.pad_token_id is not None else 0)

    class TwoGroupTrainer(Trainer):
        def compute_loss(
            self,
            model: PreTrainedModel,
            inputs: dict[str, torch.Tensor],
            return_outputs: bool = False,
            num_items_in_batch: int | None = None,
        ) -> torch.Tensor | tuple[torch.Tensor, Any]:
            extra = {k: inputs.pop(k) for k in LABEL_COLUMNS if k in inputs}
            outputs = model(**inputs)
            if "labels_head" in extra:
                loss = biaffine_group_loss(
                    outputs.logits,
                    outputs.arc_scores,
                    extra["labels_chunk"],
                    extra["labels_rel"],
                    extra["labels_head"],
                    extra["token_sent"],
                    n_chunk,
                    settings.dep_loss_weight,
                )
            else:
                loss = two_group_loss(
                    outputs.logits,
                    extra["labels_chunk"],
                    extra["labels_dep"],
                    n_chunk,
                    settings.dep_loss_weight,
                )
            return (loss, outputs) if return_outputs else loss

        def evaluate(
            self,
            eval_dataset: Dataset | None = None,
            ignore_keys: list[str] | None = None,
            metric_key_prefix: str = "eval",
        ) -> dict[str, float]:
            metrics = evaluate_model(
                self.model, dev_ds, space, collator, settings.batch_size, self.args.device
            )
            flat = flat_metrics(metrics, f"{metric_key_prefix}_")
            self.log(flat)
            self.control = self.callback_handler.on_evaluate(
                self.args, self.state, self.control, flat
            )
            self.model.train()
            return flat

    ckpt_dir = run_dir / "checkpoints"
    args = TrainingArguments(
        output_dir=str(ckpt_dir),
        per_device_train_batch_size=settings.batch_size,
        per_device_eval_batch_size=settings.batch_size,
        gradient_accumulation_steps=settings.grad_accum_steps,
        learning_rate=settings.learning_rate,
        weight_decay=settings.weight_decay,
        warmup_ratio=settings.warmup_ratio,
        lr_scheduler_type=settings.lr_schedule,
        num_train_epochs=settings.epochs,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        save_only_model=True,
        load_best_model_at_end=True,
        metric_for_best_model=BEST_METRIC,
        greater_is_better=True,
        logging_strategy="steps",
        logging_steps=10,
        logging_dir=str(run_dir / "tensorboard"),
        report_to=["tensorboard"],
        seed=settings.seed,
        data_seed=settings.seed,
        remove_unused_columns=False,
        label_names=[c for c in LABEL_COLUMNS if c in train_ds.column_names],
        dataloader_num_workers=0,
        use_cpu=device.type == "cpu",
        disable_tqdm=True,
    )
    trainer = TwoGroupTrainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=dev_ds,  # required by Trainer; evaluate() above scores it at word level
        data_collator=collator,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=settings.early_stopping_patience)],
    )
    started = time.perf_counter()
    trainer.train()
    seconds = time.perf_counter() - started

    best_dir = run_dir / "best"
    trainer.save_model(str(best_dir))
    tokenizer.save_pretrained(str(best_dir))
    (best_dir / "labels.json").write_text(
        json.dumps(labels_json, indent=2, ensure_ascii=False) + "\n"
    )
    shutil.rmtree(ckpt_dir, ignore_errors=True)

    evals = [e for e in trainer.state.log_history if f"eval_{BEST_METRIC}" in e]
    best = max(evals, key=lambda e: e[f"eval_{BEST_METRIC}"]) if evals else {}
    summary = {
        **meta,
        "run": run_dir.name,
        "settings": asdict(settings),
        "device": device.type,
        "epochs_run": len(evals),
        "best_epoch": best.get("epoch"),
        "best_dev": {k.removeprefix("eval_"): v for k, v in best.items() if k.startswith("eval_")},
        "train_seconds": round(seconds, 1),
        "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "best_dir": str(best_dir),
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def dataset_dir(key: str, data_cfg: dict[str, Any], head: str, augment: bool) -> Path:
    """Dataset folder for a head type (augment: biaffine train split with augmentation)."""
    if head == "biaffine":
        name = "dataset_arc_aug" if augment else "dataset_arc"
    elif augment:
        raise ValueError("--augment is only built for the biaffine head (dataset_arc_aug)")
    else:
        name = "dataset"
    return TRAINING_DIR / data_cfg["paths"][name] / key


def load_model_and_data(
    key: str,
    mcfg: dict[str, Any],
    data_cfg: dict[str, Any],
    head: str = "rel_pos",
    augment: bool = False,
    arc_cfg: dict[str, Any] | None = None,
) -> tuple[Any, Any, dict[str, Any], Dataset, Dataset]:
    """Fresh model (two-group classifier, optionally with the arc scorer), tokenizer,
    labels.json, train and dev splits."""
    from datasets import load_from_disk
    from transformers import AutoModelForTokenClassification, AutoTokenizer

    ds_dir = dataset_dir(key, data_cfg, head, augment)
    labels_json = json.loads((ds_dir / "labels.json").read_text())
    dd = load_from_disk(str(ds_dir))
    labels = labels_json["labels"]
    if head == "biaffine":
        from biaffine import new_biaffine

        arc_cfg = arc_cfg or {}
        model = new_biaffine(
            mcfg["model_name"],
            labels,
            int(arc_cfg.get("arc_mlp_dim", 512)),
            float(arc_cfg.get("arc_dropout", 0.1)),
        )
    else:
        model = AutoModelForTokenClassification.from_pretrained(
            mcfg["model_name"],
            num_labels=len(labels),
            id2label=dict(enumerate(labels)),
            label2id={lab: i for i, lab in enumerate(labels)},
        )
    tokenizer = AutoTokenizer.from_pretrained(
        mcfg["model_name"], **mcfg.get("tokenizer_kwargs", {})
    )
    return model, tokenizer, labels_json, dd["train"], dd["dev"]


def run_settings_list(
    mode: str | None, base: RunSettings, mcfg: dict[str, Any]
) -> list[tuple[str, RunSettings]]:
    """(run name, settings) for a single run or a sweep."""
    if mode is None:
        return [(f"lr{base.learning_rate:g}_w{base.dep_loss_weight:g}_s{base.seed}", base)]
    if mode == "lr":
        return [(f"lr{lr:g}", replace(base, learning_rate=float(lr))) for lr in mcfg["lr_sweep"]]
    if mode == "dep_weight":
        return [
            (f"lr{base.learning_rate:g}_w{w:g}", replace(base, dep_loss_weight=float(w)))
            for w in mcfg["dep_loss_weight_sweep"]
        ]
    if mode == "seeds":
        return [
            (
                f"final_lr{base.learning_rate:g}_w{base.dep_loss_weight:g}_s{s}",
                replace(base, seed=int(s)),
            )
            for s in mcfg["seeds"]
        ]
    raise ValueError(f"unknown sweep {mode!r}")


def main() -> None:
    """Train one candidate (single run, sweep, or smoke test)."""
    parser = argparse.ArgumentParser(description="Phase 7 training.")
    parser.add_argument("--model", required=True, help="key of configs/train_<key>.yaml")
    parser.add_argument("--smoke", action="store_true", help="Phase 7 task 0: 1 epoch on a subset")
    parser.add_argument("--sweep", choices=["lr", "dep_weight", "seeds"])
    parser.add_argument("--lr", type=float)
    parser.add_argument("--dep-weight", type=float)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--patience", type=int, help="early-stopping patience (epochs)")
    parser.add_argument("--run-name", help="override the run folder name")
    parser.add_argument("--device", default="auto", help="auto | mps | cpu")
    parser.add_argument("--head", choices=HEADS, default="rel_pos", help="group B head")
    parser.add_argument("--augment", action="store_true", help="biaffine: augmented train split")
    args = parser.parse_args()

    from transformers import set_seed

    mcfg = yaml.safe_load((CONFIG_DIR / f"train_{args.model}.yaml").read_text())
    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    eval_cfg = yaml.safe_load((CONFIG_DIR / "eval.yaml").read_text())
    device = pick_device(args.device)

    base = RunSettings.from_config(mcfg)
    overrides = {
        "learning_rate": args.lr,
        "dep_loss_weight": args.dep_weight,
        "seed": args.seed,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "early_stopping_patience": args.patience,
        "head": args.head,
        "augment": args.augment or None,
    }
    base = replace(base, **{k: v for k, v in overrides.items() if v is not None})
    if args.smoke:
        smoke = eval_cfg["smoke"]
        base = replace(base, epochs=int(smoke["epochs"]))
        runs = [("smoke_bf" if base.head == "biaffine" else "smoke", base)]
    else:
        runs = run_settings_list(args.sweep, base, mcfg)
    if args.run_name:
        if len(runs) != 1:
            raise SystemExit("--run-name works with single runs only")
        runs = [(args.run_name, runs[0][1])]

    root = TRAINING_DIR / data_cfg["paths"]["checkpoints"] / args.model
    for name, settings in runs:
        set_seed(settings.seed)
        model, tokenizer, labels_json, train_ds, dev_ds = load_model_and_data(
            args.model, mcfg, data_cfg, settings.head, settings.augment, eval_cfg.get("biaffine")
        )
        if args.smoke:
            train_ds = train_ds.select(
                range(min(len(train_ds), int(eval_cfg["smoke"]["train_windows"])))
            )
            dev_ds = dev_ds.select(range(min(len(dev_ds), int(eval_cfg["smoke"]["dev_windows"]))))
        meta = {
            "model_key": args.model,
            "base_model": mcfg["model_name"],
            "smoke": args.smoke,
            "head": settings.head,
            "data": labels_json["versions"]["data"],
            "train_windows": len(train_ds),
            "dev_windows": len(dev_ds),
        }
        model.to(device)
        summary = train_run(
            model=model,
            tokenizer=tokenizer,
            labels_json=labels_json,
            train_ds=train_ds,
            dev_ds=dev_ds,
            settings=settings,
            run_dir=root / name,
            device=device,
            meta=meta,
        )
        dev = summary["best_dev"]
        scores = ", ".join(
            f"{k} {dev.get(k, 0):.4f}" for k in ("chunk_f1", "upos_acc", "uas", "las")
        )
        print(
            f"{args.model}/{name}: {scores} ({summary['epochs_run']} epochs, "
            f"{summary['train_seconds']} s) -> {summary['best_dir']}"
        )
        del model
        if device.type == "mps":
            torch.mps.empty_cache()


if __name__ == "__main__":
    main()
