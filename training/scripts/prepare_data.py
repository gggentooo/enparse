"""
training/scripts/prepare_data.py — build labels, windows, and splits for training

Description:
    Turns the Phase 3 aligned sentences (runtime words with UPOS, chunk, head,
    and relation) into Hugging Face `datasets` windows for each candidate base
    model, with two label groups on the first subword of each word:
      group A  `UPOS|CHUNK`                       (flat view)
      group B  `<offset>@<head UPOS>|<relation>`  (structure; rel_pos_v1)
    Also writes labels.json (schema v1, Phase 4 fields) per model and the
    dataset report.

Phase: 4 — Dataset building.

Rules (plan-training.md → Phase 4; details in → Phase 4 *Outcome*):
    - Label counts use reviewed words of the train split only.
    - Group A labels seen < min_label_count times map to the most frequent
      kept label with the same chunk tag (BIO structure is kept).
    - Group B: root is `0@ROOT|root`; otherwise the head is the k-th word with
      the head's UPOS counted from the word towards the head (`+k` right,
      `-k` left), relation = base UD relation. Rare labels keep their head:
      they map to the most frequent kept label with the same `<offset>@<UPOS>`
      (relation changes). If none exists the head cannot be encoded: the word
      gets -100 in group B (counted in the report).
    - Windows pack consecutive sentences of one document up to
      max_subword_tokens (incl. special tokens). A sentence longer than that
      is split at word boundaries; each later piece repeats >= overlap tokens
      of context whose words carry no labels.
    - Only the first subword of a labeled word carries labels; other subwords,
      special tokens, context words, and unreviewed words get -100. Group B is
      also -100 when the head is outside the window (split sentences).
    - Windows with no labeled word are dropped.
    - Words are tokenized as a pre-split word list (`is_split_into_words`):
      every word is tokenized as if preceded by a space, and keeps at most
      max_subwords_per_word subwords. The runtime must do the same
      (labels.json → tokenizer_input, window.max_subwords_per_word).

Usage (from training/):
    python scripts/prepare_data.py                    # all configs/train_*.yaml
    python scripts/prepare_data.py --models distilbert_base_cased

Dependencies:
    Python: datasets, transformers (tokenizers), pyyaml.
    Reads:  configs/data.yaml (paths, windows, labels, augmentation, dataset, seed);
            configs/train_<model>.yaml (model_name, tokenizer_kwargs);
            data/processed/aligned/<split>.jsonl; js/package-lock.json (wink versions).
    Writes: data/processed/dataset/<model>/ (DatasetDict + labels.json; git-ignored);
            reports/dataset.md.
    Tested by: tests/test_prepare_data.py.
    Consumed by: scripts/train.py, scripts/calibrate.py, scripts/evaluate.py.
    Network: downloads tokenizers from the Hugging Face Hub on first use
             (development only).

Status: implemented (Phase 4). Augmentation: lowercase_sentence_start and
    drop_final_punct implemented, disabled by default (Phase 7 experiment);
    TODO(augmentation): learner_typos needs a typo list.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml

if TYPE_CHECKING:
    from transformers import PreTrainedTokenizerBase

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
IGNORE = -100
SCHEMA_VERSION = 1
DEP_ENCODING = "rel_pos_v1"
ROOT_DEP_LABEL = "0@ROOT|root"
TOKENIZER_INPUT = "pre_split_words"
UPOS_TAGS = (
    "ADJ", "ADP", "ADV", "AUX", "CCONJ", "DET", "INTJ", "NOUN", "NUM",
    "PART", "PRON", "PROPN", "PUNCT", "SCONJ", "SYM", "VERB", "X",
)  # fmt: skip
CHUNK_TYPES = ("NP", "VP", "PP", "ADJP", "ADVP")
CHUNK_TAGS = tuple(f"{p}-{t}" for t in CHUNK_TYPES for p in ("B", "I")) + ("O",)


# -- labels ------------------------------------------------------------------


def chunk_label(upos: str, chunk: str) -> str:
    """Group A label for one word."""
    return f"{upos}|{chunk}"


def base_relation(deprel: str) -> str:
    """UD relation without subtype (`nmod:poss` → `nmod`)."""
    return deprel.split(":", 1)[0]


def encode_head(upos: list[str], heads: list[int], deprels: list[str], i: int) -> str:
    """Group B label (rel_pos_v1) for word i (0-based); heads are 1-based, 0 = root."""
    h = heads[i]
    if h == 0:
        return ROOT_DEP_LABEL
    j = h - 1
    target = upos[j]
    step = 1 if j > i else -1
    k = sum(1 for m in range(i + step, j + step, step) if upos[m] == target)
    return f"{'+' if step > 0 else '-'}{k}@{target}|{base_relation(deprels[i])}"


def decode_head(label: str, upos: list[str], i: int) -> int | None:
    """Inverse of encode_head: 1-based head of word i, 0 for root, None if unresolvable."""
    pos, _, _ = label.partition("|")
    offset, _, target = pos.partition("@")
    if target == "ROOT":
        return 0
    k = int(offset)
    step = 1 if k > 0 else -1
    seen = 0
    m = i + step
    while 0 <= m < len(upos):
        if upos[m] == target:
            seen += 1
            if seen == abs(k):
                return m + 1
        m += step
    return None


@dataclass
class LabelMaps:
    """Label inventories and rare-label merges for both groups."""

    chunk_labels: list[str]
    dep_labels: list[str]
    chunk_merges: dict[str, str]
    dep_merges: dict[str, str | None]
    chunk_counts: Counter[str] = field(default_factory=Counter)
    dep_counts: Counter[str] = field(default_factory=Counter)

    def chunk_id(self, label: str) -> int:
        """Group-local id for a group A label; rare or unseen labels are merged."""
        if label not in self._chunk_index:
            label = self.chunk_merges.get(label) or self._merge_chunk(label)
        return self._chunk_index[label]

    def is_kept_chunk(self, label: str) -> bool:
        """True if a group A label is in the label set without merging."""
        return label in self._chunk_index

    def is_kept_dep(self, label: str) -> bool:
        """True if a group B label is in the label set without merging."""
        return label in self._dep_index

    def dep_id(self, label: str) -> int | None:
        """Group-local id for a group B label, or None if it cannot be encoded."""
        if label in self._dep_index:
            return self._dep_index[label]
        merged = self.dep_merges.get(label, _UNSEEN)
        if merged is _UNSEEN:
            merged = self._merge_dep(label)
        return None if merged is None else self._dep_index[merged]

    def __post_init__(self) -> None:
        self._chunk_index = {lab: i for i, lab in enumerate(self.chunk_labels)}
        self._dep_index = {lab: i for i, lab in enumerate(self.dep_labels)}
        self._dep_by_head: dict[str, str] = {}
        for lab in self.dep_labels:  # dep_labels are sorted by frequency
            self._dep_by_head.setdefault(lab.partition("|")[0], lab)
        # Most frequent kept label per chunk tag (ties: label order).
        self._chunk_by_tag: dict[str, str] = {}
        for lab in sorted(self.chunk_labels, key=lambda x: (-self.chunk_counts[x], x)):
            self._chunk_by_tag.setdefault(lab.partition("|")[2], lab)

    def _merge_dep(self, label: str) -> str | None:
        return self._dep_by_head.get(label.partition("|")[0])

    def _merge_chunk(self, label: str) -> str:
        return self._chunk_by_tag.get(label.partition("|")[2], self.chunk_labels[0])


_UNSEEN: Any = object()


def _frequency_order(counts: Counter[str]) -> list[str]:
    return sorted(counts, key=lambda lab: (-counts[lab], lab))


def build_label_maps(sentences: list[dict[str, Any]], min_count: int) -> LabelMaps:
    """Count labels of reviewed train words; keep frequent ones; merge rare ones."""
    chunk_counts: Counter[str] = Counter()
    dep_counts: Counter[str] = Counter()
    for s in sentences:
        words = s["words"]
        upos = [w["upos"] for w in words]
        heads = [w["head"] for w in words]
        deprels = [w["deprel"] for w in words]
        for i, w in enumerate(words):
            if not w["reviewed"]:
                continue
            chunk_counts[chunk_label(w["upos"], w["chunk"])] += 1
            dep_counts[encode_head(upos, heads, deprels, i)] += 1

    kept_chunk = [lab for lab in _frequency_order(chunk_counts) if chunk_counts[lab] >= min_count]
    kept_dep = [lab for lab in _frequency_order(dep_counts) if dep_counts[lab] >= min_count]
    if ROOT_DEP_LABEL not in kept_dep:
        kept_dep.insert(0, ROOT_DEP_LABEL)

    # Group A in a fixed, readable order: UPOS order, then chunk-tag order.
    kept_chunk.sort(
        key=lambda lab: (UPOS_TAGS.index(lab.split("|")[0]), CHUNK_TAGS.index(lab.split("|")[1]))
    )
    maps = LabelMaps(kept_chunk, kept_dep, {}, {}, chunk_counts, dep_counts)
    for lab in chunk_counts:
        if not maps.is_kept_chunk(lab):
            maps.chunk_merges[lab] = maps._merge_chunk(lab)
    for lab in dep_counts:
        if not maps.is_kept_dep(lab):
            maps.dep_merges[lab] = maps._merge_dep(lab)
    return maps


# -- windows -----------------------------------------------------------------


@dataclass
class WordRef:
    """One word placed in a window."""

    sent: int  # index of the sentence in the split
    word: int  # 0-based word index in the sentence
    context: bool  # repeated overlap context: no labels


@dataclass
class Window:
    """Words of one model input window, plus split bookkeeping."""

    doc_id: str
    words: list[WordRef]
    split_sentence: bool = False


def word_token_counts(
    tokenizer: PreTrainedTokenizerBase, words: list[str], max_per_word: int
) -> list[int]:
    """Subword tokens per word (pre-split words, capped at max_per_word)."""
    enc = tokenizer(words, is_split_into_words=True, add_special_tokens=False)
    counts = [0] * len(words)
    for wid in enc.word_ids():
        if wid is not None:
            counts[wid] += 1
    return [min(c, max_per_word) for c in counts]


def encode_words(
    tokenizer: PreTrainedTokenizerBase, words: list[str], max_per_word: int
) -> tuple[list[int], list[int | None]]:
    """Token ids and word ids for pre-split words; <= max_per_word subwords per word."""
    enc = tokenizer(words, is_split_into_words=True, add_special_tokens=True)
    ids: list[int] = []
    wids: list[int | None] = []
    seen: Counter[int] = Counter()
    for tid, wid in zip(enc["input_ids"], enc.word_ids(), strict=True):
        if wid is not None:
            seen[wid] += 1
            if seen[wid] > max_per_word:
                continue
        ids.append(tid)
        wids.append(wid)
    return ids, wids


def build_windows(
    sentences: list[dict[str, Any]],
    token_counts: list[list[int]],
    budget: int,
    overlap: int,
) -> list[Window]:
    """Pack sentences of one document into windows of <= budget subword tokens."""
    windows: list[Window] = []
    current: Window | None = None
    used = 0

    def flush() -> None:
        nonlocal current, used
        if current is not None and current.words:
            windows.append(current)
        current, used = None, 0

    for si, s in enumerate(sentences):
        counts = token_counts[si]
        total = sum(counts)
        if current is not None and (current.doc_id != s["doc_id"] or used + total > budget):
            flush()
        if total <= budget:
            if current is None:
                current = Window(s["doc_id"], [])
            current.words.extend(WordRef(si, wi, False) for wi in range(len(counts)))
            used += total
            continue
        # Long sentence: split at word boundaries, repeating >= overlap tokens.
        flush()
        if max(counts) > budget:
            raise ValueError(
                f"{s['sent_id']}: one word has {max(counts)} subword tokens (> {budget})"
            )
        start = 0
        first_new = 0
        while start < len(counts):
            end, size = start, 0
            while end < len(counts) and size + counts[end] <= budget:
                size += counts[end]
                end += 1
            refs = [WordRef(si, wi, wi < first_new) for wi in range(start, end)]
            windows.append(Window(s["doc_id"], refs, split_sentence=True))
            if end >= len(counts):
                break
            back, ctx = end, 0
            while back > start + 1 and ctx < overlap:
                back -= 1
                ctx += counts[back]
            start, first_new = back, end
    flush()
    return windows


# -- augmentation (Phase 7 experiment; disabled by default) --------------------


def augment_sentence(s: dict[str, Any], kind: str) -> dict[str, Any] | None:
    """Return an augmented copy of a sentence, or None if the kind does not apply."""
    words = [dict(w) for w in s["words"]]
    if kind == "lowercase_sentence_start":
        first = words[0]["form"]
        if not first[:1].isupper() or first.isupper():
            return None
        words[0]["form"] = first[:1].lower() + first[1:]
    elif kind == "drop_final_punct":
        last = len(words)
        if words[-1]["upos"] != "PUNCT" or any(w["head"] == last for w in words):
            return None
        words = words[:-1]
        if len(words) == 0:
            return None
    else:
        raise ValueError(f"unknown augmentation kind {kind!r}")
    return {**s, "sent_id": f"{s['sent_id']}#aug-{kind}", "words": words}


def augment(
    sentences: list[dict[str, Any]], kinds: list[str], max_fraction: float, seed: int
) -> list[dict[str, Any]]:
    """Add augmented copies of up to max_fraction of train sentences, after their originals."""
    rng = random.Random(seed)
    budget = int(len(sentences) * max_fraction)
    picks = set(rng.sample(range(len(sentences)), min(budget, len(sentences))))
    out: list[dict[str, Any]] = []
    for i, s in enumerate(sentences):
        out.append(s)
        if i in picks:
            new = augment_sentence(s, rng.choice(kinds))
            if new is not None:
                out.append(new)
    return out


# -- encoding ----------------------------------------------------------------


@dataclass
class SplitStats:
    """Counters for the dataset report."""

    sentences: int = 0
    words: int = 0
    labeled_words: int = 0
    windows: int = 0
    dropped_windows: int = 0
    split_sentences: int = 0
    unencodable_heads: int = 0
    heads_outside_window: int = 0
    merged_chunk_labels: int = 0
    merged_dep_labels: int = 0
    lengths: list[int] = field(default_factory=list)
    sentences_per_window: list[int] = field(default_factory=list)


def encode_windows(
    sentences: list[dict[str, Any]],
    windows: list[Window],
    tokenizer: PreTrainedTokenizerBase,
    maps: LabelMaps,
    stats: SplitStats,
    max_per_word: int,
) -> list[dict[str, Any]]:
    """Tokenize windows and attach token-level labels and word-level gold fields."""
    rows: list[dict[str, Any]] = []
    split_sents: set[int] = set()
    for win in windows:
        forms = [sentences[r.sent]["words"][r.word]["form"] for r in win.words]
        input_ids, word_ids = encode_words(tokenizer, forms, max_per_word)
        in_window = {(r.sent, r.word) for r in win.words}
        sent_order = list(dict.fromkeys(r.sent for r in win.words))

        word_chunk: list[int] = []
        word_dep: list[int] = []
        for r in win.words:
            s = sentences[r.sent]
            w = s["words"][r.word]
            if r.context or not w["reviewed"]:
                word_chunk.append(IGNORE)
                word_dep.append(IGNORE)
                continue
            lab_a = chunk_label(w["upos"], w["chunk"])
            if not maps.is_kept_chunk(lab_a):
                stats.merged_chunk_labels += 1
            word_chunk.append(maps.chunk_id(lab_a))
            upos = [x["upos"] for x in s["words"]]
            heads = [x["head"] for x in s["words"]]
            deprels = [x["deprel"] for x in s["words"]]
            lab_b = encode_head(upos, heads, deprels, r.word)
            head = w["head"]
            if head != 0 and (r.sent, head - 1) not in in_window:
                stats.heads_outside_window += 1
                word_dep.append(IGNORE)
                continue
            dep = maps.dep_id(lab_b)
            if dep is None:
                stats.unencodable_heads += 1
                word_dep.append(IGNORE)
                continue
            if not maps.is_kept_dep(lab_b):
                stats.merged_dep_labels += 1
            word_dep.append(dep)

        labels_chunk: list[int] = []
        labels_dep: list[int] = []
        token_word: list[int] = []
        prev: int | None = None
        for wid in word_ids:
            if wid is None:
                labels_chunk.append(IGNORE)
                labels_dep.append(IGNORE)
                token_word.append(-1)
            else:
                first = wid != prev
                labels_chunk.append(word_chunk[wid] if first else IGNORE)
                labels_dep.append(word_dep[wid] if first else IGNORE)
                token_word.append(wid)
            prev = wid

        if all(x == IGNORE for x in word_chunk):
            stats.dropped_windows += 1
            continue
        stats.windows += 1
        stats.lengths.append(len(input_ids))
        stats.sentences_per_window.append(len(sent_order))
        stats.labeled_words += sum(1 for x in word_chunk if x != IGNORE)
        if win.split_sentence:
            split_sents.add(win.words[0].sent)

        words_meta = [sentences[r.sent]["words"][r.word] for r in win.words]
        rows.append(
            {
                "doc_id": win.doc_id,
                "sent_ids": [sentences[i]["sent_id"] for i in sent_order],
                "input_ids": input_ids,
                "attention_mask": [1] * len(input_ids),
                "labels_chunk": labels_chunk,
                "labels_dep": labels_dep,
                "token_word": token_word,
                "words": forms,
                "word_sent": [sent_order.index(r.sent) for r in win.words],
                "word_index": [r.word for r in win.words],
                "word_context": [r.context for r in win.words],
                "word_reviewed": [bool(w["reviewed"]) for w in words_meta],
                "gold_upos": [w["upos"] for w in words_meta],
                "gold_chunk": [w["chunk"] for w in words_meta],
                "gold_head": [int(w["head"]) for w in words_meta],
                "gold_deprel": [w["deprel"] for w in words_meta],
            }
        )
    stats.split_sentences = len(split_sents)
    return rows


# -- labels.json ---------------------------------------------------------------


def wink_versions(lock_path: Path) -> dict[str, str]:
    """wink-nlp and model versions pinned in training/js/package-lock.json."""
    lock = json.loads(lock_path.read_text())
    pkgs = lock["packages"]
    return {
        "wink-nlp": pkgs["node_modules/wink-nlp"]["version"],
        "wink-eng-lite-web-model": pkgs["node_modules/wink-eng-lite-web-model"]["version"],
    }


def make_labels_json(
    maps: LabelMaps, base_model: str, data_cfg: dict[str, Any], wink: dict[str, str]
) -> dict[str, Any]:
    """labels.json (schema v1) with Phase 4 fields filled and later fields null."""
    n_a, n_b = len(maps.chunk_labels), len(maps.dep_labels)
    merges: dict[str, str | None] = dict(sorted(maps.chunk_merges.items()))
    merges.update(sorted(maps.dep_merges.items()))
    return {
        "schema_version": SCHEMA_VERSION,
        "labels": maps.chunk_labels + maps.dep_labels,
        "groups": {"chunk": {"start": 0, "end": n_a}, "dep": {"start": n_a, "end": n_a + n_b}},
        "dep_encoding": DEP_ENCODING,
        "tokenizer_input": TOKENIZER_INPUT,
        "upos": list(UPOS_TAGS),
        "chunk_tags": list(CHUNK_TAGS),
        "label_merges": merges,
        "window": {
            "max_subword_tokens": data_cfg["windows"]["max_subword_tokens"],
            "max_subwords_per_word": data_cfg["windows"]["max_subwords_per_word"],
        },
        "versions": {
            "base_model": base_model,
            "data": {
                "ud_release": data_cfg["ud_ewt"]["release_tag"],
                "ud_commit": data_cfg["ud_ewt"]["commit"],
                "feedback_batches": [],
            },
            "wink": wink,
        },
        "calibration": {"temperature": None, "dep_temperature": None},
        "ambiguity": {"margin": None, "attachment_margin": None},
        "model_version": None,
    }


def validate_labels_json(obj: dict[str, Any]) -> list[str]:
    """Problems found when checking obj against schema v1 (empty list = valid)."""
    problems: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            problems.append(msg)

    expected = {
        "schema_version", "labels", "groups", "dep_encoding", "tokenizer_input", "upos",
        "chunk_tags", "label_merges", "window", "versions", "calibration", "ambiguity",
        "model_version",
    }  # fmt: skip
    need(set(obj) == expected, f"top-level keys differ: {sorted(set(obj) ^ expected)}")
    if problems:
        return problems
    need(obj["schema_version"] == SCHEMA_VERSION, "schema_version must be 1")
    labels = obj["labels"]
    need(
        isinstance(labels, list) and all(isinstance(x, str) for x in labels),
        "labels must be string[]",
    )
    need(len(set(labels)) == len(labels), "labels must be unique")
    g = obj["groups"]
    need(set(g) == {"chunk", "dep"}, "groups must have chunk and dep")
    if set(g) == {"chunk", "dep"}:
        need(g["chunk"]["start"] == 0, "groups.chunk.start must be 0")
        need(g["chunk"]["end"] == g["dep"]["start"], "groups must be contiguous")
        need(g["dep"]["end"] == len(labels), "groups.dep.end must equal len(labels)")
        upos_set, tag_set = set(obj["upos"]), set(obj["chunk_tags"])
        for lab in labels[g["chunk"]["start"] : g["chunk"]["end"]]:
            u, _, t = lab.partition("|")
            need(u in upos_set and t in tag_set, f"bad group A label {lab!r}")
        for lab in labels[g["dep"]["start"] : g["dep"]["end"]]:
            pos, _, rel = lab.partition("|")
            off, _, u = pos.partition("@")
            ok = (lab == ROOT_DEP_LABEL) or (
                off[:1] in "+-" and off[1:].isdigit() and u in upos_set and rel
            )
            need(bool(ok), f"bad group B label {lab!r}")
        need(ROOT_DEP_LABEL in labels[g["dep"]["start"] : g["dep"]["end"]], "root label missing")
    need(obj["dep_encoding"] == DEP_ENCODING, f"dep_encoding must be {DEP_ENCODING}")
    need(obj["tokenizer_input"] == TOKENIZER_INPUT, f"tokenizer_input must be {TOKENIZER_INPUT}")
    need(obj["upos"] == list(UPOS_TAGS), "upos must be the 17 UD tags in fixed order")
    need(obj["chunk_tags"] == list(CHUNK_TAGS), "chunk_tags must be the 11 BIO tags in fixed order")
    need(isinstance(obj["label_merges"], dict), "label_merges must be an object")
    for k in ("max_subword_tokens", "max_subwords_per_word"):
        need(isinstance(obj["window"].get(k), int), f"window.{k} must be int")
    v = obj["versions"]
    need(
        isinstance(v.get("base_model"), str) and bool(v.get("base_model")),
        "versions.base_model must be set",
    )
    need(
        {"ud_release", "ud_commit", "feedback_batches"} <= set(v.get("data", {})),
        "versions.data incomplete",
    )
    need(
        {"wink-nlp", "wink-eng-lite-web-model"} <= set(v.get("wink", {})),
        "versions.wink incomplete",
    )
    for key, sub in (
        ("calibration", ("temperature", "dep_temperature")),
        ("ambiguity", ("margin", "attachment_margin")),
    ):
        need(set(obj[key]) == set(sub), f"{key} keys must be {sub}")
        for k in sub:
            val = obj[key].get(k)
            need(val is None or isinstance(val, (int, float)), f"{key}.{k} must be number or null")
    need(
        obj["model_version"] is None or isinstance(obj["model_version"], str),
        "model_version must be string or null",
    )
    return problems


# -- main ----------------------------------------------------------------------


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read aligned sentences (one JSON object per line)."""
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def model_configs(only: list[str] | None) -> dict[str, dict[str, Any]]:
    """configs/train_<key>.yaml by key (optionally filtered)."""
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(CONFIG_DIR.glob("train_*.yaml")):
        key = path.stem.removeprefix("train_")
        if only and key not in only:
            continue
        out[key] = yaml.safe_load(path.read_text())
    if only and set(only) - set(out):
        raise SystemExit(f"unknown model keys: {sorted(set(only) - set(out))}")
    return out


def write_report(
    path: Path,
    cfg: dict[str, Any],
    maps: LabelMaps,
    split_words: dict[str, int],
    per_model: dict[str, dict[str, SplitStats]],
) -> None:
    """Write label and window statistics to reports/dataset.md."""
    total_b = sum(maps.dep_counts.values())
    dep_kept = sum(maps.dep_counts[lab] for lab in maps.dep_labels)
    dep_relmerged = sum(
        n for lab, n in maps.dep_counts.items() if maps.dep_merges.get(lab, 0) not in (0, None)
    )
    dep_lost = sum(
        n
        for lab, n in maps.dep_counts.items()
        if lab in maps.dep_merges and maps.dep_merges[lab] is None
    )
    a_total = sum(maps.chunk_counts.values())
    a_merged = sum(maps.chunk_counts[lab] for lab in maps.chunk_merges)
    w = cfg["windows"]
    L = [
        "# Dataset report (Phase 4)",
        "",
        "Generated by `scripts/prepare_data.py` from `data/processed/aligned/` (Phase 3). "
        f"UD English EWT {cfg['ud_ewt']['release_tag']}. Label counts: reviewed train words.",
        "",
        "## Labels",
        "",
        "| Group | Distinct in train | Kept (≥ "
        f"{cfg['labels']['min_label_count']}) | Train words on kept labels | Merged | "
        "Cannot be encoded |",
        "|---|---|---|---|---|---|",
        f"| A `UPOS\\|CHUNK` | {len(maps.chunk_counts)} | {len(maps.chunk_labels)} | "
        f"{(a_total - a_merged) / a_total:.3%} | "
        f"{a_merged} words ({len(maps.chunk_merges)} labels) | 0 |",
        f"| B `{DEP_ENCODING}` | {len(maps.dep_counts)} | {len(maps.dep_labels)} | "
        f"{dep_kept / total_b:.3%} | {dep_relmerged} words (relation changed, head kept) | "
        f"**{dep_lost} words ({dep_lost / total_b:.3%})** |",
        "",
        f"Target for heads that cannot be encoded: < 0.5% of train words. "
        f"{'Met' if dep_lost / total_b < 0.005 else '**Not met**'}.",
        "",
        "Most frequent labels (train words):",
        "",
        "- Group A: "
        + ", ".join(
            f"`{lab}` {maps.chunk_counts[lab]:,}" for lab in _frequency_order(maps.chunk_counts)[:8]
        ),
        "- Group B: "
        + ", ".join(f"`{lab}` {maps.dep_counts[lab]:,}" for lab in maps.dep_labels[:8]),
        "",
        "Head offsets in kept group B labels: "
        + ", ".join(
            f"{k} {v}"
            for k, v in sorted(
                Counter(lab.partition("@")[0] for lab in maps.dep_labels).items(),
                key=lambda kv: (kv[0] != "0", abs(int(kv[0])) if kv[0] != "0" else 0, kv[0]),
            )
        ),
        "",
        "## Windows",
        "",
        f"Up to {w['max_subword_tokens']} subword tokens per window including special tokens; "
        "sentences of one document packed in order; long sentences split with "
        f"{w['long_sentence_overlap']} tokens of unlabeled context.",
        "",
        "| Model | Split | Words | Windows | Sentences / window (mean) | "
        "Tokens (mean / p95 / max) | "
        "Split sentences | Heads outside window | Unencodable heads | Labels merged (A / B) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for model, splits in per_model.items():
        for split, st in splits.items():
            lens = sorted(st.lengths)
            p95 = lens[int(0.95 * (len(lens) - 1))] if lens else 0
            L.append(
                f"| {model} | {split} | {split_words[split]:,} | {st.windows:,} | "
                f"{statistics.mean(st.sentences_per_window):.1f} | "
                f"{statistics.mean(lens):.0f} / {p95} / {max(lens)} | "
                f"{st.split_sentences} | {st.heads_outside_window} | {st.unencodable_heads} | "
                f"{st.merged_chunk_labels} / {st.merged_dep_labels} |"
            )
    L += [
        "",
        "- *Heads outside window:* words of a split sentence whose head is in another piece; "
        "group B is -100 for them.",
        "- *Unencodable heads:* group B label rare in train with no kept label for the same head; "
        "group B is -100.",
        "- *Labels merged:* words whose label is rare in train or unseen there (dev/test), "
        "mapped by the merge rules.",
        "",
    ]
    path.write_text("\n".join(L), encoding="utf-8")


def main() -> None:
    """Build datasets and labels.json for each candidate model."""
    parser = argparse.ArgumentParser(description="Build Phase 4 datasets.")
    parser.add_argument("--models", nargs="*", help="model keys (train_<key>.yaml); default all")
    args = parser.parse_args()

    from datasets import Dataset, DatasetDict
    from transformers import AutoTokenizer

    cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    aligned = TRAINING_DIR / cfg["paths"]["aligned"]
    out_root = TRAINING_DIR / cfg["paths"]["dataset"]
    splits = cfg["dataset"]["splits"]
    data = {split: load_jsonl(aligned / f"{split}.jsonl") for split in splits}
    maps = build_label_maps(data["train"], cfg["labels"]["min_label_count"])

    aug = cfg["augmentation"]
    if aug["enabled"]:
        data["train"] = augment(data["train"], aug["kinds"], aug["max_fraction"], cfg["seed"])
    split_words = {split: sum(len(s["words"]) for s in data[split]) for split in splits}
    wink = wink_versions(TRAINING_DIR / "js" / "package-lock.json")
    max_tokens = cfg["windows"]["max_subword_tokens"]
    overlap = cfg["windows"]["long_sentence_overlap"]
    per_word = cfg["windows"]["max_subwords_per_word"]

    per_model: dict[str, dict[str, SplitStats]] = {}
    for key, mcfg in model_configs(args.models).items():
        tok = AutoTokenizer.from_pretrained(mcfg["model_name"], **mcfg.get("tokenizer_kwargs", {}))
        budget = max_tokens - tok.num_special_tokens_to_add(pair=False)
        dd: dict[str, Any] = {}
        per_model[key] = {}
        for split in splits:
            sents = data[split]
            counts = [
                word_token_counts(tok, [w["form"] for w in s["words"]], per_word) for s in sents
            ]
            windows = build_windows(sents, counts, budget, overlap)
            st = SplitStats(sentences=len(sents), words=split_words[split])
            rows = encode_windows(sents, windows, tok, maps, st, per_word)
            if any(len(r["input_ids"]) > max_tokens for r in rows):
                raise RuntimeError(f"{key}/{split}: window over {max_tokens} tokens")
            dd[split] = Dataset.from_list(rows)
            per_model[key][split] = st
            print(f"{key} {split}: {st.windows} windows, {st.split_sentences} split sentences")
        out = out_root / key
        DatasetDict(dd).save_to_disk(str(out))
        labels = make_labels_json(maps, mcfg["model_name"], cfg, wink)
        problems = validate_labels_json(labels)
        if problems:
            raise RuntimeError(f"labels.json invalid: {problems}")
        (out / "labels.json").write_text(
            json.dumps(labels, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"{key}: saved -> {out.relative_to(TRAINING_DIR)} (+ labels.json)")

    write_report(TRAINING_DIR / cfg["dataset"]["report"], cfg, maps, split_words, per_model)
    print(f"report -> {cfg['dataset']['report']}")


if __name__ == "__main__":
    main()
