"""
training/tests/test_train.py — unit and integration tests for train.py and metrics.py

Description:
    Builds a tiny dataset with the real Phase 4 functions (prepare_data.py)
    and a tiny offline WordPiece tokenizer, then checks the two-group loss,
    padding, word-level metrics, and one end-to-end training run of a tiny
    randomly initialized BERT on CPU (no downloads, no real candidate).

Phase: 7 — Full training and tuning (pre-work).

Dependencies:
    Python: pytest, torch, transformers, datasets; scripts/train.py,
            scripts/metrics.py, scripts/prepare_data.py.

Status: implemented (Phase 7 pre-work).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
import torch

from metrics import LabelSpace, WindowPrediction, score
from train import Collator, RunSettings, run_settings_list, train_run, two_group_loss

if TYPE_CHECKING:
    from datasets import Dataset
    from transformers import PreTrainedModel, PreTrainedTokenizerBase


def test_two_group_loss_matches_slices_and_handles_no_labels() -> None:
    torch.manual_seed(0)
    logits = torch.randn(2, 5, 7)
    la = torch.tensor([[0, 1, -100, 2, -100], [-100, -100, 1, 0, 2]])
    lb = torch.tensor([[3, -100, -100, 0, -100], [-100, -100, -100, 1, -100]])
    got = two_group_loss(logits, la, lb, n_chunk=3, dep_weight=0.5)
    ce = torch.nn.functional.cross_entropy
    want = ce(logits[..., :3].reshape(-1, 3), la.reshape(-1), ignore_index=-100) + 0.5 * ce(
        logits[..., 3:].reshape(-1, 4), lb.reshape(-1), ignore_index=-100
    )
    assert torch.allclose(got, want)
    none = torch.full((2, 5), -100)
    assert two_group_loss(logits, none, none, 3, 1.0).item() == 0.0


def test_collator_pads_ids_masks_and_labels() -> None:
    long = {"input_ids": [2, 5, 3], "attention_mask": [1, 1, 1], "words": ["x"]}
    long |= {"labels_chunk": [-100, 1, -100], "labels_dep": [-100, 0, -100]}
    short = {"input_ids": [2, 3], "attention_mask": [1, 1]}
    short |= {"labels_chunk": [-100, -100], "labels_dep": [-100, -100]}
    batch = Collator(pad_token_id=0)([long, short])
    assert batch["input_ids"].tolist() == [[2, 5, 3], [2, 3, 0]]
    assert batch["attention_mask"].tolist() == [[1, 1, 1], [1, 1, 0]]
    assert batch["labels_chunk"][1].tolist() == [-100, -100, -100]
    assert set(batch) == {"input_ids", "attention_mask", "labels_chunk", "labels_dep"}


def _gold_predictions(ds: Dataset, space: LabelSpace) -> list[WindowPrediction]:
    chunk_index = {space.chunk_label(i): i for i in range(space.n_chunk)}
    preds = []
    for row in ds:
        firsts: dict[int, int] = {}
        for t, w in enumerate(row["token_word"]):
            if w >= 0 and w not in firsts:
                firsts[w] = t
        n = len(row["words"])
        a = [chunk_index[(row["gold_upos"][w], row["gold_chunk"][w])] for w in range(n)]
        b = [row["labels_dep"][firsts[w]] for w in range(n)]
        preds.append(WindowPrediction(a, b))
    return preds


def test_score_perfect_and_with_errors(tiny: dict[str, Any]) -> None:
    space = LabelSpace.from_labels_json(tiny["labels_json"])
    ds = tiny["dev"]
    perfect = _gold_predictions(ds, space)
    m = score(ds, perfect, space)
    assert m["upos_acc"] == 1.0 and m["chunk_f1"] == 1.0 and m["uas"] == 1.0 and m["las"] == 1.0
    assert m["words"] == 10 and m["chunk_sentences"] == 2
    # One wrong head (root label on "the") → UAS 9/10; one wrong chunk tag breaks one chunk.
    bad = _gold_predictions(ds, space)
    root_id = next(i for i in range(space.n_dep) if space.dep_label(i) == "0@ROOT|root")
    bad[0].dep_ids[0] = root_id
    worse = score(ds, bad, space)
    assert worse["uas"] == pytest.approx(0.9)
    assert worse["las"] == pytest.approx(0.9)


def test_run_settings_list_names() -> None:
    mcfg = {"lr_sweep": [2e-5, 5e-5], "dep_loss_weight_sweep": [0.5, 2.0], "seeds": [1, 2, 3]}
    base = RunSettings(5e-5, 1.0, 1, 1, 2, 1, 0.1, 0.0, 2)
    assert [n for n, _ in run_settings_list("lr", base, mcfg)] == ["lr2e-05", "lr5e-05"]
    assert [s.dep_loss_weight for _, s in run_settings_list("dep_weight", base, mcfg)] == [0.5, 2.0]
    assert [s.seed for _, s in run_settings_list("seeds", base, mcfg)] == [1, 2, 3]
    assert len(run_settings_list(None, base, mcfg)) == 1
    with pytest.raises(ValueError):
        run_settings_list("nope", base, mcfg)


def test_train_run_end_to_end_on_cpu(
    tiny: dict[str, Any],
    tokenizer: PreTrainedTokenizerBase,
    tiny_model_factory: Callable[[int], PreTrainedModel],
    tmp_path: Path,
) -> None:
    labels_json = tiny["labels_json"]
    model = tiny_model_factory(len(labels_json["labels"]))
    model.config.id2label = dict(enumerate(labels_json["labels"]))
    model.config.label2id = {lab: i for i, lab in enumerate(labels_json["labels"])}
    settings = RunSettings(
        learning_rate=5e-3, dep_loss_weight=1.0, seed=0, epochs=3, batch_size=4,
        grad_accum_steps=1, warmup_ratio=0.0, weight_decay=0.0, early_stopping_patience=5,
    )  # fmt: skip
    summary = train_run(
        model=model,
        tokenizer=tokenizer,
        labels_json=labels_json,
        train_ds=tiny["train"],
        dev_ds=tiny["dev"],
        settings=settings,
        run_dir=tmp_path / "run",
        device=torch.device("cpu"),
        meta={"model_key": "tiny"},
    )
    best = tmp_path / "run" / "best"
    assert (best / "config.json").exists() and (best / "labels.json").exists()
    assert (best / "tokenizer.json").exists() or (best / "vocab.txt").exists()
    assert not (tmp_path / "run" / "checkpoints").exists()
    assert summary["epochs_run"] == 3
    for k in ("chunk_f1", "upos_acc", "uas", "las"):
        assert 0.0 <= summary["best_dev"][k] <= 1.0
    saved = json.loads((tmp_path / "run" / "summary.json").read_text())
    assert saved["settings"]["learning_rate"] == 5e-3
    cfg = json.loads((best / "config.json").read_text())
    assert len(cfg["id2label"]) == len(labels_json["labels"])
