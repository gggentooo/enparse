"""
training/tests/test_biaffine.py — tests for the biaffine head (T05/T33/T51)

Description:
    Arc masks and loss (scripts/biaffine.py), the arc-encoded dataset and
    labels.json schema v2 (scripts/prepare_data.py), biaffine dev metrics
    (scripts/metrics.py), and one end-to-end training run of a tiny randomly
    initialized biaffine BERT on CPU (scripts/train.py). No downloads.

Dependencies:
    Python: pytest, torch, transformers, datasets; conftest.py fixtures.

Status: implemented (T51).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import pytest
import torch

from biaffine import (
    MASKED,
    arc_allowed,
    arc_loss,
    biaffine_class,
    load_biaffine,
    sentence_arc_logprobs,
    token_sentences,
    word_heads,
)
from conftest import CAT, DOG, WORDS, sent
from metrics import LabelSpace, WindowPrediction, score
from prepare_data import (
    SplitStats,
    build_label_maps,
    build_rel_maps,
    build_windows,
    encode_windows_arc,
    make_labels_json_v2,
    relation_label,
    validate_labels_json,
    word_token_counts,
)
from train import Collator, RunSettings, biaffine_group_loss, train_run

if TYPE_CHECKING:
    from transformers import PreTrainedTokenizerBase

SUBTYPES = ["nsubj:pass", "nmod:poss"]
CFG = {
    "windows": {"max_subword_tokens": 32, "max_subwords_per_word": 4, "long_sentence_overlap": 4},
    "ud_ewt": {"release_tag": "t", "commit": "c"},
}
WINK = {"wink-nlp": "0", "wink-eng-lite-web-model": "0"}


@pytest.fixture(scope="module")
def arc_data(tokenizer: PreTrainedTokenizerBase) -> dict[str, Any]:
    from datasets import Dataset

    train_s = [sent(DOG, f"t{i}", doc="d") for i in range(3)] + [
        sent(CAT, f"c{i}", doc=f"e{i}") for i in range(3)
    ]
    dev_s = [sent(DOG, "v1", "dv"), sent(CAT, "v2", "dv")]  # one window, two sentences
    maps = build_label_maps(train_s, min_count=1)
    rel = build_rel_maps(train_s, 1, SUBTYPES, maps)
    labels_json = make_labels_json_v2(rel, SUBTYPES, "tiny-bert", CFG, WINK)

    def rows(sents: list[dict[str, Any]]) -> list[dict[str, Any]]:
        counts = [word_token_counts(tokenizer, [w["form"] for w in s["words"]], 4) for s in sents]
        wins = build_windows(sents, counts, budget=30, overlap=4)
        return encode_windows_arc(sents, wins, tokenizer, rel, frozenset(SUBTYPES), SplitStats(), 4)

    return {
        "labels_json": labels_json,
        "train": Dataset.from_list(rows(train_s)),
        "dev": Dataset.from_list(rows(dev_s)),
    }


def test_arc_allowed_keeps_sentence_and_root() -> None:
    # tokens: [CLS] a b | c [SEP]; a, b in sentence 0; c in sentence 1
    ts = torch.tensor([[-1, 0, 0, 1, -1]])
    allowed = arc_allowed(ts)[0]
    assert allowed[1].tolist() == [True, False, True, False, False]  # a: root or b
    assert allowed[3].tolist() == [True, False, False, False, False]  # c: only root
    assert allowed[:, 0].all()


def test_arc_loss_is_masked_cross_entropy() -> None:
    torch.manual_seed(0)
    scores = torch.randn(1, 5, 5)
    ts = torch.tensor([[-1, 0, 0, 1, -1]])
    heads = torch.tensor([[-100, 2, 0, 0, -100]])
    got = arc_loss(scores, heads, ts)
    masked = scores.masked_fill(~arc_allowed(ts), MASKED)[0]
    want = sum(-torch.log_softmax(masked[t], -1)[h] for t, h in ((1, 2), (2, 0), (3, 0))) / 3
    assert torch.allclose(got, want)
    none = torch.full((1, 5), -100)
    assert arc_loss(scores, none, ts).item() == 0.0


def test_word_heads_and_sentence_logprobs() -> None:
    token_word = [-1, 0, 0, 1, 2, -1]  # word 0 has two subwords
    word_sent = [0, 0, 1]
    arc = np.zeros((6, 6))
    arc[1, 3] = 5.0  # word 0 → word 1
    arc[3, 0] = 5.0  # word 1 → root
    arc[4, 1] = 9.0  # word 2 → word 0 is in another sentence: masked
    heads, margins = word_heads(arc, token_word, word_sent)
    assert heads == [1, -1, -1]
    assert margins[0] == pytest.approx(5.0)
    assert token_sentences(token_word, word_sent) == [-1, 0, -1, 0, 1, -1]
    logp = sentence_arc_logprobs(arc, token_word, [0, 1])
    assert len(logp) == 2 and len(logp[0]) == 3
    assert logp[0][1] == -1e9  # no self-attachment
    assert np.exp([x for x in logp[1] if x > -1e8]).sum() == pytest.approx(1.0, abs=1e-3)


def test_arc_dataset_and_labels_v2(arc_data: dict[str, Any]) -> None:
    lj = arc_data["labels_json"]
    assert validate_labels_json(lj) == []
    assert lj["schema_version"] == 2 and "root" in lj["labels"]
    assert relation_label("nsubj:pass", set(SUBTYPES)) == "nsubj:pass"
    assert relation_label("obl:tmod", set(SUBTYPES)) == "obl"
    bad = json.loads(json.dumps(lj))
    bad["calibration"]["arc_temperature"] = "x"
    assert any("arc_temperature" in p for p in validate_labels_json(bad))
    rels = lj["labels"][lj["groups"]["rel"]["start"] :]
    for row in arc_data["dev"]:
        tw = row["token_word"]
        for t, h in enumerate(row["labels_head"]):
            if h == -100:
                continue
            w = tw[t]
            gold = row["gold_head"][w]
            if gold == 0:
                assert h == 0
            else:
                hw = tw[h]
                assert row["word_sent"][hw] == row["word_sent"][w]
                assert row["word_index"][hw] == gold - 1
            assert rels[row["labels_rel"][t]] == row["gold_deprel"][w]
            assert row["token_sent"][t] == row["word_sent"][w]


def test_biaffine_metrics_perfect_and_wrong_head(arc_data: dict[str, Any]) -> None:
    space = LabelSpace.from_labels_json(arc_data["labels_json"])
    chunk_index = {space.chunk_label(i): i for i in range(space.n_chunk)}
    rel_index = {space.dep_label(i): i for i in range(space.n_dep)}
    preds = []
    for row in arc_data["dev"]:
        n = len(row["words"])
        heads = []
        for w in range(n):
            g = row["gold_head"][w]
            same = [k for k in range(n) if row["word_sent"][k] == row["word_sent"][w]]
            heads.append(-1 if g == 0 else next(k for k in same if row["word_index"][k] == g - 1))
        a = [chunk_index[(row["gold_upos"][w], row["gold_chunk"][w])] for w in range(n)]
        b = [rel_index[row["gold_deprel"][w]] for w in range(n)]
        preds.append(WindowPrediction(a, b, heads))
    m = score(arc_data["dev"], preds, space)
    assert m["uas"] == 1.0 and m["las"] == 1.0
    preds[0].heads[0] = -1  # "the" → root
    assert score(arc_data["dev"], preds, space)["uas"] == pytest.approx(9 / 10)


def _tiny_biaffine(n_labels: int) -> torch.nn.Module:
    from transformers import BertConfig, BertForTokenClassification

    torch.manual_seed(0)
    cfg = BertConfig(
        vocab_size=len(WORDS), hidden_size=16, num_hidden_layers=1, num_attention_heads=2,
        intermediate_size=32, max_position_embeddings=64, num_labels=n_labels,
    )  # fmt: skip
    cfg.enparse_head, cfg.arc_mlp_dim, cfg.arc_dropout = "biaffine", 8, 0.0
    return biaffine_class(BertForTokenClassification)(cfg)


def test_biaffine_loss_and_train_run_end_to_end(
    arc_data: dict[str, Any], tokenizer: PreTrainedTokenizerBase, tmp_path: Path
) -> None:
    lj = arc_data["labels_json"]
    model = _tiny_biaffine(len(lj["labels"]))
    batch = Collator(0)([arc_data["train"][0], arc_data["dev"][0]])
    assert {"labels_rel", "labels_head", "token_sent"} <= set(batch)
    out = model(input_ids=batch["input_ids"], attention_mask=batch["attention_mask"])
    n_chunk = lj["groups"]["chunk"]["end"]
    loss = biaffine_group_loss(
        out.logits, out.arc_scores, batch["labels_chunk"], batch["labels_rel"],
        batch["labels_head"], batch["token_sent"], n_chunk, 1.0,
    )  # fmt: skip
    assert loss.item() > 0 and out.arc_scores.shape[-1] == out.arc_scores.shape[-2]

    settings = RunSettings(
        learning_rate=5e-3, dep_loss_weight=1.0, seed=0, epochs=3, batch_size=4,
        grad_accum_steps=1, warmup_ratio=0.0, weight_decay=0.0, early_stopping_patience=5,
        head="biaffine",
    )  # fmt: skip
    summary = train_run(
        model=model,
        tokenizer=tokenizer,
        labels_json=lj,
        train_ds=arc_data["train"],
        dev_ds=arc_data["dev"],
        settings=settings,
        run_dir=tmp_path / "run",
        device=torch.device("cpu"),
        meta={"model_key": "tiny"},
    )
    assert summary["epochs_run"] == 3
    for k in ("chunk_f1", "uas", "las", "select"):
        assert 0.0 <= summary["best_dev"][k] <= 1.0
    reloaded = load_biaffine(str(tmp_path / "run" / "best"))
    assert torch.allclose(reloaded.arc.weight, model.arc.weight.cpu())
