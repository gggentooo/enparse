"""
training/scripts/biaffine.py — biaffine arc scorer on top of a token classifier

Description:
    The biaffine parser head (plan-training.md → Nested phrase structure →
    Planned change and Biaffine design). The base model stays the Hugging Face
    `*ForTokenClassification` class of each candidate, so its packed `logits`
    (group A `UPOS|CHUNK` + group B relation) and its ONNX export path are
    unchanged; a biaffine scorer reads the last hidden state and adds a second
    output `arc_scores` [batch, T, T]: arc_scores[b, i, j] = score of token j
    being the head of token i. Scores are subword-level and unmasked; the loss
    and the runtime read them at first-subword positions and keep only heads in
    the word's own sentence plus the root (token 0, the first special token).

Phase: 7 (biaffine retrain, T51), 9 (export), 8 (calibration).

Contents:
    BiaffineArcScorer      MLP(dep) · W · MLP(head)ᵀ + head bias
    biaffine_class(base)   subclass of a *ForTokenClassification class whose
                           forward returns BiaffineOutput(logits, arc_scores);
                           extra config keys: enparse_head, arc_mlp_dim, arc_dropout
    load_biaffine(path)    from_pretrained for a saved biaffine checkpoint
    new_biaffine(name, …)  fresh model from a base checkpoint
    arc_allowed(token_sent) mask of allowed heads (same sentence, first
                           subwords, not itself; root always allowed)
    arc_loss(...)          cross-entropy over allowed heads
    word_heads(...)        per-word argmax head (window word index, -1 = root)

Dependencies:
    Python: torch, transformers.
    Used by: scripts/train.py, scripts/evaluate.py, scripts/export_onnx.py,
             scripts/calibrate.py; tests/test_biaffine.py.

Status: implemented (T05/T51).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import torch
from torch import nn
from transformers import PretrainedConfig
from transformers.utils import ModelOutput

HEAD_NAME = "biaffine"
ARC_OUTPUT = "arc_scores"  # second ONNX output (labels.json → arc.output)
ROOT_POSITION = 0  # first special token ([CLS] / <s>) stands for the root
MASKED = -1e4  # large negative score for disallowed heads (finite: fp16-safe)


class BiaffineArcScorer(nn.Module):
    """score[i, j] = dep_i · W · head_j + b · head_j (Dozat & Manning 2017)."""

    def __init__(self, hidden: int, dim: int, dropout: float) -> None:
        super().__init__()
        self.dep = nn.Sequential(nn.Linear(hidden, dim), nn.GELU(), nn.Dropout(dropout))
        self.head = nn.Sequential(nn.Linear(hidden, dim), nn.GELU(), nn.Dropout(dropout))
        self.weight = nn.Parameter(torch.empty(dim, dim))
        self.bias = nn.Parameter(torch.empty(dim))
        self.reset_parameters()

    def reset_parameters(self) -> None:
        """Fresh weights (also called after from_pretrained, which may leave new params empty)."""
        for mlp in (self.dep, self.head):
            lin = mlp[0]
            nn.init.xavier_uniform_(lin.weight)
            nn.init.zeros_(lin.bias)
        nn.init.xavier_uniform_(self.weight, gain=0.1)
        nn.init.zeros_(self.bias)

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        """[B, T, H] → [B, T, T] arc scores."""
        d = self.dep(hidden)
        h = self.head(hidden)
        scores = torch.matmul(torch.matmul(d, self.weight), h.transpose(1, 2))
        # Head bias as multiply-and-sum, not a 1-D MatMul (int8 per-channel quantization of a
        # 1-D weight produced a model onnxruntime could not load; T05).
        return scores + (h * self.bias).sum(-1).unsqueeze(1)


@dataclass
class BiaffineOutput(ModelOutput):
    """Packed logits (group A + relation) and arc scores."""

    logits: torch.Tensor | None = None
    arc_scores: torch.Tensor | None = None


_CLASSES: dict[type, type] = {}


def biaffine_class(base: type) -> type:
    """A *ForTokenClassification subclass with the arc scorer (cached per base class)."""
    if base in _CLASSES:
        return _CLASSES[base]

    def __init__(self: nn.Module, config: PretrainedConfig) -> None:
        base.__init__(self, config)
        self.arc = BiaffineArcScorer(
            config.hidden_size, int(config.arc_mlp_dim), float(config.arc_dropout)
        )

    def forward(
        self: nn.Module,
        input_ids: torch.Tensor | None = None,
        attention_mask: torch.Tensor | None = None,
        token_type_ids: torch.Tensor | None = None,
        **kwargs: Any,  # noqa: ANN401 — passed through to the base model
    ) -> BiaffineOutput:
        extra = {"token_type_ids": token_type_ids} if token_type_ids is not None else {}
        kwargs.pop("output_hidden_states", None)
        kwargs.pop("return_dict", None)
        out = base.forward(
            self,
            input_ids=input_ids,
            attention_mask=attention_mask,
            output_hidden_states=True,
            return_dict=True,
            **extra,
            **kwargs,
        )
        return BiaffineOutput(logits=out.logits, arc_scores=self.arc(out.hidden_states[-1]))

    # __module__ of the base class: Optimum infers the library ("transformers") from it.
    attrs = {"__init__": __init__, "forward": forward, "__module__": base.__module__}
    cls = type(f"Biaffine{base.__name__}", (base,), attrs)
    _CLASSES[base] = cls
    return cls


def _base_class(config: Any) -> type:  # noqa: ANN401 — any PretrainedConfig
    from transformers.models.auto.modeling_auto import MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING

    return MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING[type(config)]


def new_biaffine(
    model_name: str, labels: list[str], arc_mlp_dim: int, arc_dropout: float
) -> nn.Module:
    """Fresh biaffine model from a pretrained base checkpoint (classifier and scorer random)."""
    from transformers import AutoConfig

    config = AutoConfig.from_pretrained(
        model_name,
        num_labels=len(labels),
        id2label=dict(enumerate(labels)),
        label2id={lab: i for i, lab in enumerate(labels)},
    )
    config.enparse_head = HEAD_NAME
    config.arc_mlp_dim = int(arc_mlp_dim)
    config.arc_dropout = float(arc_dropout)
    model = biaffine_class(_base_class(config)).from_pretrained(model_name, config=config)
    model.arc.reset_parameters()
    return model


def load_biaffine(path: str, **kwargs: Any) -> nn.Module:  # noqa: ANN401 — from_pretrained kwargs
    """Load a saved biaffine checkpoint (config.json has enparse_head = biaffine)."""
    from transformers import AutoConfig

    config = AutoConfig.from_pretrained(path, **kwargs)
    if getattr(config, "enparse_head", None) != HEAD_NAME:
        raise ValueError(f"{path} is not a biaffine checkpoint")
    return biaffine_class(_base_class(config)).from_pretrained(path, config=config, **kwargs)


def is_biaffine(path: str) -> bool:
    """True if the checkpoint at path has the biaffine head."""
    import json
    from pathlib import Path

    cfg = json.loads((Path(path) / "config.json").read_text())
    return cfg.get("enparse_head") == HEAD_NAME


# -- masks, loss, decoding --------------------------------------------------------


def arc_allowed(token_sent: torch.Tensor) -> torch.Tensor:
    """[B, T] sentence id per token (-1 = not a first subword) → [B, T, T] allowed heads.

    Head j is allowed for token i if j is the root position, or j is a first
    subword of another word in the same sentence.
    """
    same = token_sent.unsqueeze(2) == token_sent.unsqueeze(1)
    is_word = (token_sent >= 0).unsqueeze(1)
    t = token_sent.shape[1]
    not_self = ~torch.eye(t, dtype=torch.bool, device=token_sent.device).unsqueeze(0)
    allowed = same & is_word & not_self
    allowed[:, :, ROOT_POSITION] = True
    return allowed


def arc_loss(
    arc_scores: torch.Tensor, labels_head: torch.Tensor, token_sent: torch.Tensor
) -> torch.Tensor:
    """Mean cross-entropy over allowed heads for tokens with a gold head (0 if none)."""
    import torch.nn.functional as F

    masked = arc_scores.masked_fill(~arc_allowed(token_sent), MASKED)
    flat = labels_head.reshape(-1)
    count = (flat != -100).sum()
    total = F.cross_entropy(
        masked.reshape(-1, masked.shape[-1]).float(), flat, ignore_index=-100, reduction="sum"
    )
    return total / count.clamp(min=1)


def token_sentences(token_word: Sequence[int], word_sent: Sequence[int]) -> list[int]:
    """Sentence id at each word's first subword, -1 elsewhere (special tokens, later subwords)."""
    out = []
    prev = None
    for w in token_word:
        out.append(word_sent[w] if w >= 0 and w != prev else -1)
        prev = w
    return out


def word_heads(
    arc: Any,  # noqa: ANN401 — numpy [T, T] array (one window)
    token_word: Sequence[int],
    word_sent: Sequence[int],
) -> tuple[list[int], list[float]]:
    """Per window word: argmax head over allowed heads (window word index, -1 = root, -2 = none)
    and the top-two margin of the masked scores (for parity checks)."""
    import numpy as np

    sent = np.array(token_sentences(token_word, word_sent))
    first: dict[int, int] = {}
    for t, w in enumerate(token_word):
        if w >= 0 and w not in first:
            first[w] = t
    n_words = len(word_sent)
    heads, margins = [], []
    for w in range(n_words):
        t = first.get(w)
        if t is None:
            heads.append(-2)
            margins.append(0.0)
            continue
        allowed = (sent == word_sent[w]) & (np.arange(len(sent)) != t)
        allowed[ROOT_POSITION] = True
        row = np.where(allowed, arc[t, : len(sent)], -np.inf)
        j = int(row.argmax())
        top = np.sort(row[np.isfinite(row)])[::-1]
        margins.append(round(float(top[0] - top[1]), 4) if len(top) > 1 else 0.0)
        heads.append(-1 if j == ROOT_POSITION else int(token_word[j]))
    return heads, margins


def sentence_arc_logprobs(
    arc: Any,  # noqa: ANN401 — numpy [T, T]
    token_word: Sequence[int],
    words: Sequence[int],
    temperature: float = 1.0,
) -> list[list[float]]:
    """Word-level head log-probabilities for one sentence: row i = word words[i], column 0 =
    root, column k = words[k-1]; softmax over the sentence's words plus root (no self)."""
    import numpy as np

    first: dict[int, int] = {}
    for t, w in enumerate(token_word):
        if w >= 0 and w not in first:
            first[w] = t
    cols = [ROOT_POSITION] + [first[w] for w in words]
    out = []
    for i, w in enumerate(words):
        row = np.array([arc[first[w], c] for c in cols], dtype=np.float64) / temperature
        row[i + 1] = -np.inf
        row = row - row.max()
        logp = row - np.log(np.exp(row).sum())
        out.append([round(float(x), 4) if np.isfinite(x) else -1e9 for x in logp])
    return out
