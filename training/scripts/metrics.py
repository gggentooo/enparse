"""
training/scripts/metrics.py — word-level predictions and metrics for both label groups

Description:
    Shared by train.py (dev metrics each epoch) and evaluate.py (test,
    parity): turns per-token logits into one prediction per word (first
    subword), and scores UPOS accuracy, chunk P/R/F1 (seqeval, overall and per
    type), and UAS/LAS from group B (rel_pos_v1, decoded with the predicted
    UPOS). Raw argmax decoding; tree repair and nested phrases are done by the
    app's treeDecoder.ts (Phase 7 evaluation via tsx).
    Biaffine models (labels.json schema v2): heads are the per-word argmax of
    the arc scores over the word's sentence plus root (no tree constraint;
    the final evaluation decodes trees with MST in treeDecoder.ts), and the
    relation is the group B argmax, "root" exactly when the head is the root
    (the same rule as treeDecoder.ts).

Phase: 7 — Full training and tuning (also 9, 12).

Rules:
    - Only labeled words count: reviewed, not overlap context.
    - Chunk F1 per (window, sentence) sequence, only over sentences whose
      words are all reviewed (plan-training.md → Phase 4 partial labels).
    - UAS/LAS: every labeled word whose gold head lies in the same window;
      LAS also needs the base relation to match (subtypes are not compared, so
      the score is comparable with rel_pos_v1 models).

Dependencies:
    Python: numpy, seqeval; prepare_data.decode_head, prepare_data.base_relation.
    Used by: scripts/train.py, scripts/evaluate.py; tests/test_train.py.

Status: implemented (Phase 7 pre-work).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from seqeval.metrics import classification_report, f1_score, precision_score, recall_score

from prepare_data import IGNORE, base_relation, decode_head


@dataclass(frozen=True)
class LabelSpace:
    """Class ids of both label groups, from labels.json."""

    labels: list[str]
    chunk_start: int
    chunk_end: int
    dep_start: int
    dep_end: int
    biaffine: bool = False

    @classmethod
    def from_labels_json(cls, obj: dict[str, Any]) -> LabelSpace:
        """Build from a labels.json object (schema v1: group B = dep; v2: group B = rel)."""
        g = obj["groups"]
        b = g["rel"] if obj.get("schema_version") == 2 else g["dep"]
        return cls(
            obj["labels"],
            g["chunk"]["start"],
            g["chunk"]["end"],
            b["start"],
            b["end"],
            obj.get("schema_version") == 2,
        )

    @property
    def root_rel(self) -> int:
        """Group-local id of the relation "root" (biaffine models)."""
        return self.labels[self.dep_start : self.dep_end].index("root")

    @property
    def n_chunk(self) -> int:
        """Number of group A classes."""
        return self.chunk_end - self.chunk_start

    @property
    def n_dep(self) -> int:
        """Number of group B classes."""
        return self.dep_end - self.dep_start

    def chunk_label(self, local_id: int) -> tuple[str, str]:
        """(UPOS, chunk tag) of a group-local A id."""
        upos, _, chunk = self.labels[self.chunk_start + local_id].partition("|")
        return upos, chunk

    def dep_label(self, local_id: int) -> str:
        """Group B label of a local id (rel_pos_v1 label, or the relation for biaffine models)."""
        return self.labels[self.dep_start + local_id]


def first_subword_positions(token_word: Sequence[int]) -> dict[int, int]:
    """Token position of the first subword of each word index."""
    out: dict[int, int] = {}
    for t, w in enumerate(token_word):
        if w >= 0 and w not in out:
            out[w] = t
    return out


def word_argmax(
    logits: np.ndarray, token_word: Sequence[int], space: LabelSpace
) -> tuple[list[int], list[int]]:
    """Per-word group A and group B argmax (group-local ids) from one window's logits [T, C]."""
    firsts = first_subword_positions(token_word)
    n_words = max(firsts) + 1 if firsts else 0
    a = logits[:, space.chunk_start : space.chunk_end].argmax(-1)
    b = logits[:, space.dep_start : space.dep_end].argmax(-1)
    pa = [int(a[firsts[w]]) if w in firsts else -1 for w in range(n_words)]
    pb = [int(b[firsts[w]]) if w in firsts else -1 for w in range(n_words)]
    return pa, pb


@dataclass
class WindowPrediction:
    """Predictions for one window: group-local ids per word (-1 = no subword).

    Biaffine models also set heads: per window word, the head's window word
    index, -1 for the root, -2 if the word has no subword.
    """

    chunk_ids: list[int]
    dep_ids: list[int]
    heads: list[int] | None = None


def biaffine_words(
    logits: np.ndarray,
    arc: np.ndarray,
    token_word: Sequence[int],
    word_sent: Sequence[int],
    space: LabelSpace,
) -> WindowPrediction:
    """Per-word group A argmax, argmax head (sentence + root), and relation (root iff head root)."""
    from biaffine import word_heads

    firsts = first_subword_positions(token_word)
    heads, _ = word_heads(arc, token_word, word_sent)
    a = logits[:, space.chunk_start : space.chunk_end].argmax(-1)
    rel = logits[:, space.dep_start : space.dep_end].copy()
    root = space.root_rel
    pa, pb = [], []
    for w in range(len(word_sent)):
        t = firsts.get(w)
        if t is None:
            pa.append(-1)
            pb.append(-1)
            continue
        pa.append(int(a[t]))
        if heads[w] == -1:
            pb.append(root)
        else:
            row = rel[t].copy()
            row[root] = -np.inf
            pb.append(int(row.argmax()))
    return WindowPrediction(pa, pb, heads)


def _sentences(row: dict[str, Any]) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    for w, s in enumerate(row["word_sent"]):
        out.setdefault(s, []).append(w)
    return out


def score(
    rows: Iterable[dict[str, Any]], preds: Iterable[WindowPrediction], space: LabelSpace
) -> dict[str, Any]:
    """UPOS accuracy, chunk P/R/F1 (overall and per type), UAS, and LAS."""
    upos_total = upos_ok = 0
    head_total = uas_ok = las_ok = 0
    gold_seqs: list[list[str]] = []
    pred_seqs: list[list[str]] = []
    for row, pred in zip(rows, preds, strict=True):
        n = len(row["words"])
        p_upos = ["X"] * n
        p_chunk = ["O"] * n
        for w in range(n):
            cid = pred.chunk_ids[w] if w < len(pred.chunk_ids) else -1
            if cid >= 0:
                p_upos[w], p_chunk[w] = space.chunk_label(cid)
        labeled = [row["word_reviewed"][w] and not row["word_context"][w] for w in range(n)]
        for s_words in _sentences(row).values():
            idx = [w for w in s_words if labeled[w]]
            for w in idx:
                upos_total += 1
                upos_ok += int(p_upos[w] == row["gold_upos"][w])
            if idx and len(idx) == len(s_words):
                gold_seqs.append([row["gold_chunk"][w] for w in idx])
                pred_seqs.append([p_chunk[w] for w in idx])
            # Heads: decode within the sentence, with predicted UPOS.
            sent_upos = [p_upos[w] for w in s_words]
            local = {row["word_index"][w]: k for k, w in enumerate(s_words)}
            for w in idx:
                gold_head = row["gold_head"][w]
                if gold_head != 0 and (gold_head - 1) not in local:
                    continue  # head in another window piece
                head_total += 1
                did = pred.dep_ids[w] if w < len(pred.dep_ids) else -1
                if did < 0:
                    continue
                label = space.dep_label(did)
                if pred.heads is not None:
                    hw = pred.heads[w]
                    ph_index = None if hw == -2 else (0 if hw == -1 else row["word_index"][hw] + 1)
                    relation = base_relation(label)
                else:
                    k = local[row["word_index"][w]]
                    ph = decode_head(label, sent_upos, k)
                    # Map the predicted sentence-local head back to the word index space.
                    ph_index = (
                        None
                        if ph is None
                        else (0 if ph == 0 else row["word_index"][s_words[ph - 1]] + 1)
                    )
                    relation = label.partition("|")[2]
                if ph_index == gold_head:
                    uas_ok += 1
                    if relation == base_relation(row["gold_deprel"][w]):
                        las_ok += 1
    report = (
        classification_report(gold_seqs, pred_seqs, output_dict=True, zero_division=0)
        if gold_seqs
        else {}
    )
    per_type = {
        k: {
            "precision": float(v["precision"]),
            "recall": float(v["recall"]),
            "f1": float(v["f1-score"]),
            "support": int(v["support"]),
        }
        for k, v in report.items()
        if k in {"NP", "VP", "PP", "ADJP", "ADVP"}
    }
    return {
        "upos_acc": upos_ok / upos_total if upos_total else 0.0,
        "chunk_f1": float(f1_score(gold_seqs, pred_seqs, zero_division=0)) if gold_seqs else 0.0,
        "chunk_precision": float(precision_score(gold_seqs, pred_seqs, zero_division=0))
        if gold_seqs
        else 0.0,
        "chunk_recall": float(recall_score(gold_seqs, pred_seqs, zero_division=0))
        if gold_seqs
        else 0.0,
        "uas": uas_ok / head_total if head_total else 0.0,
        "las": las_ok / head_total if head_total else 0.0,
        "words": upos_total,
        "head_words": head_total,
        "chunk_sentences": len(gold_seqs),
        "per_type": per_type,
    }


def ignore_count(labels: Sequence[int]) -> int:
    """Number of ignored (-100) positions; helper for tests and logs."""
    return sum(1 for x in labels if x == IGNORE)
