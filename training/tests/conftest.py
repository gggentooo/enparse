"""
training/tests/conftest.py — shared pytest fixtures for training tests

Description:
    Common fixtures used by test_derive_chunks.py and test_prepare_data.py.

Phases: 2, 4.

Fixtures:
    rows_to_conllu      — build CoNLL-U text from compact "form UPOS head deprel [lemma]"
                          rows (no files from data/).
    parse_conllu        — parse CoNLL-U text into `conllu` sentences.
    tokenizer           — tiny offline WordPiece tokenizer (Phase 7 tests).
    tiny                — tiny two-group dataset (train/dev) + labels.json built with
                          the real prepare_data.py functions.
    tiny_model_factory  — tiny randomly initialized BERT token classifier (CPU).

Dependencies:
    Python: pytest, conllu. Config: training/pyproject.toml (pythonpath = scripts).
    Used by: tests/test_derive_chunks.py (Phase 2), tests/test_prepare_data.py (Phase 4),
             tests/test_train.py, tests/test_export_onnx.py (Phase 7).

Status: implemented (Phases 2, 7). Phase 4 tests build their fixtures inline.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import conllu
import pytest

from prepare_data import (
    SplitStats,
    build_label_maps,
    build_windows,
    encode_windows,
    make_labels_json,
    word_token_counts,
)

if TYPE_CHECKING:
    from transformers import PreTrainedModel, PreTrainedTokenizerBase


def _rows_to_conllu(rows: list[str], sent_id: str = "test-1") -> str:
    lines = [f"# sent_id = {sent_id}"]
    forms: list[str] = []
    for i, row in enumerate(rows, 1):
        parts = row.split()
        form, upos, head, deprel = parts[:4]
        lemma = parts[4] if len(parts) > 4 else form.lower()
        forms.append(form)
        lines.append("\t".join([str(i), form, lemma, upos, "_", "_", head, deprel, "_", "_"]))
    lines.insert(1, f"# text = {' '.join(forms)}")
    return "\n".join(lines) + "\n\n"


@pytest.fixture
def rows_to_conllu() -> Callable[..., str]:
    """Return a builder: compact rows -> one CoNLL-U sentence block."""
    return _rows_to_conllu


@pytest.fixture
def parse_conllu() -> Callable[[str], list[conllu.TokenList]]:
    """Return a parser: CoNLL-U text -> list of sentences."""
    return conllu.parse


# -- Phase 7: tiny model and dataset ------------------------------------------

WORDS = [
    "[PAD]",
    "[UNK]",
    "[CLS]",
    "[SEP]",
    "[MASK]",
    "the",
    "red",
    "dog",
    "barks",
    "loudly",
    ".",
    "a",
    "cat",
    "sleeps",
]


def sent(rows: list[str], sid: str, doc: str = "d1") -> dict[str, Any]:
    """Aligned sentence from 'form UPOS CHUNK HEAD DEPREL' rows."""
    words = []
    for r in rows:
        form, upos, chunk, head, deprel = r.split()
        words.append(
            {
                "form": form,
                "upos": upos,
                "chunk": chunk,
                "head": int(head),
                "deprel": deprel,
                "reviewed": True,
            }
        )
    return {"doc_id": doc, "sent_id": sid, "words": words}


DOG = [
    "the DET B-NP 3 det", "red ADJ I-NP 3 amod", "dog NOUN I-NP 4 nsubj",
    "barks VERB B-VP 0 root", "loudly ADV B-ADVP 4 advmod", ". PUNCT O 4 punct",
]  # fmt: skip
CAT = ["a DET B-NP 2 det", "cat NOUN I-NP 3 nsubj", "sleeps VERB B-VP 0 root", ". PUNCT O 3 punct"]


@pytest.fixture(scope="session")
def tokenizer(tmp_path_factory: pytest.TempPathFactory) -> PreTrainedTokenizerBase:
    from transformers import BertTokenizerFast

    d = tmp_path_factory.mktemp("tok")
    (d / "vocab.txt").write_text("\n".join(WORDS) + "\n")
    return BertTokenizerFast(vocab_file=str(d / "vocab.txt"), do_lower_case=False)


@pytest.fixture(scope="session")
def tiny(tokenizer: PreTrainedTokenizerBase) -> dict[str, Any]:
    from datasets import Dataset

    train_s = [sent(DOG, f"t{i}", doc=f"d{i}") for i in range(6)] + [
        sent(CAT, f"c{i}", doc=f"e{i}") for i in range(6)
    ]
    dev_s = [sent(DOG, "v1", "dv1"), sent(CAT, "v2", "dv2")]
    maps = build_label_maps(train_s, min_count=1)
    labels_json = make_labels_json(
        maps,
        "tiny-bert",
        {
            "windows": {"max_subword_tokens": 32, "max_subwords_per_word": 4},
            "ud_ewt": {"release_tag": "t", "commit": "c"},
        },
        {"wink-nlp": "0", "wink-eng-lite-web-model": "0"},
    )

    def rows(sents: list[dict[str, Any]]) -> list[dict[str, Any]]:
        counts = [word_token_counts(tokenizer, [w["form"] for w in s["words"]], 4) for s in sents]
        wins = build_windows(sents, counts, budget=30, overlap=4)
        return encode_windows(sents, wins, tokenizer, maps, SplitStats(), 4)

    return {
        "labels_json": labels_json,
        "train": Dataset.from_list(rows(train_s)),
        "dev": Dataset.from_list(rows(dev_s)),
    }


def _tiny_model(n_labels: int) -> PreTrainedModel:
    import torch
    from transformers import BertConfig, BertForTokenClassification

    torch.manual_seed(0)
    cfg = BertConfig(
        vocab_size=len(WORDS), hidden_size=16, num_hidden_layers=1, num_attention_heads=2,
        intermediate_size=32, max_position_embeddings=64, num_labels=n_labels,
    )  # fmt: skip
    return BertForTokenClassification(cfg)


@pytest.fixture
def tiny_model_factory() -> Callable[[int], PreTrainedModel]:
    """Return a builder for a tiny randomly initialized BERT token classifier."""
    return _tiny_model
