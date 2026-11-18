"""
training/tests/test_prepare_data.py — unit tests for dataset building

Description:
    Checks label construction, head encoding, windowing, subword alignment,
    partial labels, augmentation, and labels.json validation in
    scripts/prepare_data.py on small synthetic inputs.

Phase: 4 — Dataset building.

Coverage:
    1. Combined labels: UPOS and chunk join to `UPOS|CHUNK`; rare combos map to
       the most frequent kept label with the same chunk tag.
    2. Head encoding (rel_pos_v1): root, offsets with intervening words of the
       same UPOS, round trip on every word; rare labels keep their head or are
       reported as unencodable.
    3. Windows: packed only within one document; boundaries kept; no window
       exceeds the budget; long sentences split with unlabeled overlap context.
    4. Subword alignment: only the first subword of a word is labeled; special
       tokens, continuation subwords, and context words are -100; per-word
       subword cap.
    5. Partial labels: unreviewed words are -100 in both groups and excluded
       from label counts; windows with no labeled word are dropped.
    6. Augmentation: within max_fraction; kinds that do not apply are skipped.
    7. labels.json: generated file validates; invalid files are rejected.

Dependencies:
    Python: pytest, transformers (distilbert-base-cased tokenizer from the
            local Hugging Face cache; tokenizer tests are skipped without it).
    Tests:  scripts/prepare_data.py.
    Data:   inline fixtures only; no files from data/.

Status: implemented (Phase 4).
"""

from __future__ import annotations

import random
from collections import Counter
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import pytest

from prepare_data import (
    IGNORE,
    ROOT_DEP_LABEL,
    SplitStats,
    Window,
    augment,
    augment_sentence,
    build_label_maps,
    build_windows,
    decode_head,
    encode_head,
    encode_windows,
    make_labels_json,
    validate_labels_json,
    word_token_counts,
)

if TYPE_CHECKING:
    from transformers import PreTrainedTokenizerBase


def sent(
    rows: list[str], doc: str = "d1", sid: str = "s1", reviewed: list[bool] | None = None
) -> dict[str, Any]:
    """Aligned sentence from rows 'form UPOS CHUNK HEAD DEPREL'."""
    words = []
    for i, row in enumerate(rows):
        form, upos, chunk, head, deprel = row.split()
        words.append(
            {
                "form": form,
                "upos": upos,
                "chunk": chunk,
                "head": int(head),
                "deprel": deprel,
                "reviewed": True if reviewed is None else reviewed[i],
            }
        )
    return {
        "doc_id": doc,
        "sent_id": sid,
        "text": " ".join(r.split()[0] for r in rows),
        "words": words,
    }


DOG = [
    "The DET B-NP 2 det",
    "dog NOUN I-NP 3 nsubj",
    "barked VERB B-VP 0 root",
    ". PUNCT O 3 punct",
]


def lists(s: dict[str, Any]) -> tuple[list[str], list[int], list[str]]:
    ws = s["words"]
    return [w["upos"] for w in ws], [w["head"] for w in ws], [w["deprel"] for w in ws]


# -- head encoding ---------------------------------------------------------------


def test_encode_head_basic() -> None:
    up, hd, dr = lists(sent(DOG))
    assert [encode_head(up, hd, dr, i) for i in range(4)] == [
        "+1@NOUN|det",
        "+1@VERB|nsubj",
        ROOT_DEP_LABEL,
        "-1@VERB|punct",
    ]


def test_encode_head_counts_words_of_head_upos_and_drops_subtypes() -> None:
    # "big red dog of John's" — word 1 (big) -> dog (3): +1 NOUN; John (5) -> dog: -1 NOUN
    up = ["ADJ", "ADJ", "NOUN", "ADP", "PROPN", "NOUN"]
    hd = [3, 3, 0, 5, 6, 3]
    dr = ["amod", "amod", "root", "case", "nmod:poss", "nmod"]
    assert encode_head(up, hd, dr, 0) == "+1@NOUN|amod"
    assert encode_head(up, hd, dr, 4) == "+1@NOUN|nmod"  # subtype dropped
    assert encode_head(up, hd, dr, 5) == "-1@NOUN|nmod"
    # skipping an intervening NOUN: word 0 -> word 5 (second NOUN to the right)
    assert encode_head(up, [6, 3, 0, 5, 6, 3], dr, 0) == "+2@NOUN|amod"


def test_head_round_trip_on_random_trees() -> None:
    rng = random.Random(0)
    tags = ["NOUN", "VERB", "ADJ", "DET", "PUNCT"]
    for _ in range(200):
        n = rng.randint(1, 12)
        up = [rng.choice(tags) for _ in range(n)]
        root = rng.randrange(n)
        hd = [0 if i == root else rng.choice([j + 1 for j in range(n) if j != i]) for i in range(n)]
        dr = ["dep"] * n
        for i in range(n):
            assert decode_head(encode_head(up, hd, dr, i), up, i) == hd[i]


def test_decode_head_unresolvable() -> None:
    assert decode_head("+2@NOUN|amod", ["ADJ", "NOUN"], 0) is None


# -- label maps --------------------------------------------------------------------


def test_label_maps_keep_frequent_and_merge_rare_group_a() -> None:
    common = [sent(DOG, sid=f"s{i}") for i in range(5)]
    rare = sent(["Wow INTJ B-NP 0 root"], sid="r")  # INTJ|B-NP seen once
    maps = build_label_maps([*common, rare], min_count=5)
    assert "INTJ|B-NP" not in maps.chunk_labels
    # merged to the most frequent kept label with chunk tag B-NP
    assert maps.chunk_merges["INTJ|B-NP"] == "DET|B-NP"
    assert maps.chunk_labels[maps.chunk_id("INTJ|B-NP")] == "DET|B-NP"


def test_label_maps_group_b_rare_keeps_head_or_is_unencodable() -> None:
    common = [sent(DOG, sid=f"s{i}") for i in range(5)]
    # "+1@NOUN|amod"-like head with a rare relation: same head position as det
    rare_rel = sent(["Big ADJ B-NP 2 xcomp", "dog NOUN I-NP 0 root"], sid="r1")
    # head position never seen often: +1@ADJ
    rare_head = sent(["very ADV B-ADJP 2 advmod", "big ADJ I-ADJP 0 root"], sid="r2")
    maps = build_label_maps([*common, rare_rel, rare_head], min_count=5)
    assert maps.dep_merges["+1@NOUN|xcomp"] == "+1@NOUN|det"  # relation changed, head kept
    assert maps.dep_merges["+1@ADJ|advmod"] is None  # head cannot be encoded
    assert maps.dep_id("+1@ADJ|advmod") is None
    assert ROOT_DEP_LABEL in maps.dep_labels


def test_label_counts_use_reviewed_words_only() -> None:
    s = sent(DOG, reviewed=[True, False, True, True])
    maps = build_label_maps([s], min_count=1)
    assert sum(maps.chunk_counts.values()) == 3
    assert "NOUN|I-NP" not in maps.chunk_counts


# -- windows -----------------------------------------------------------------------


def test_windows_pack_within_documents_and_budget() -> None:
    sents = [
        sent(DOG, doc="a", sid="a1"),
        sent(DOG, doc="a", sid="a2"),
        sent(DOG, doc="b", sid="b1"),
    ]
    counts = [[1, 1, 1, 1]] * 3
    wins = build_windows(sents, counts, budget=10, overlap=2)
    assert [[r.sent for r in w.words] for w in wins] == [[0] * 4 + [1] * 4, [2] * 4]
    assert all(not r.context for w in wins for r in w.words)
    # budget smaller than two sentences: one sentence per window
    wins = build_windows(sents, counts, budget=6, overlap=2)
    assert len(wins) == 3


def test_windows_split_long_sentence_with_unlabeled_overlap() -> None:
    long = sent([f"w{i} NOUN O 1 dep" if i else "w0 NOUN O 0 root" for i in range(10)])
    counts = [[1] * 10]
    wins = build_windows([long], counts, budget=4, overlap=2)
    assert all(sum(counts[0][r.word] for r in w.words) <= 4 for w in wins)
    labeled = [r.word for w in wins for r in w.words if not r.context]
    assert labeled == list(range(10))  # every word labeled exactly once
    assert all(w.split_sentence for w in wins)
    # every later window starts with >= overlap tokens of context
    for w in wins[1:]:
        assert sum(1 for r in w.words if r.context) >= 2


def test_window_rejects_a_word_longer_than_the_budget() -> None:
    with pytest.raises(ValueError, match="subword tokens"):
        build_windows([sent(DOG)], [[1, 9, 1, 1]], budget=5, overlap=1)


# -- subword alignment (needs a cached tokenizer) ------------------------------------


@pytest.fixture(scope="module")
def tokenizer() -> PreTrainedTokenizerBase:
    transformers = pytest.importorskip("transformers")
    try:
        return transformers.AutoTokenizer.from_pretrained(
            "distilbert-base-cased", local_files_only=True
        )
    except OSError:
        pytest.skip("distilbert-base-cased tokenizer not in the local cache")


def _encode(
    tokenizer: PreTrainedTokenizerBase, sentences: list[dict[str, Any]], max_per_word: int = 16
) -> tuple[list[dict[str, Any]], SplitStats]:
    maps = build_label_maps([sent(DOG, sid=f"c{i}") for i in range(5)] + sentences, min_count=1)
    counts = [
        word_token_counts(tokenizer, [w["form"] for w in s["words"]], max_per_word)
        for s in sentences
    ]
    budget = 256 - tokenizer.num_special_tokens_to_add(pair=False)
    windows = build_windows(sentences, counts, budget, 32)
    stats = SplitStats()
    return encode_windows(sentences, windows, tokenizer, maps, stats, max_per_word), stats


def test_only_first_subword_is_labeled(tokenizer: PreTrainedTokenizerBase) -> None:
    s = sent(["Unbelievably ADV B-ADVP 2 advmod", "barked VERB B-VP 0 root"])
    rows, _ = _encode(tokenizer, [s])
    row = rows[0]
    firsts = [
        t
        for t, w in enumerate(row["token_word"])
        if w >= 0 and (t == 0 or row["token_word"][t - 1] != w)
    ]
    for t, w in enumerate(row["token_word"]):
        labeled = row["labels_chunk"][t] != IGNORE
        assert labeled == (t in firsts), (t, w)
        assert (row["labels_dep"][t] != IGNORE) == (t in firsts)
    assert row["token_word"][0] == -1 and row["labels_chunk"][0] == IGNORE  # [CLS]
    assert row["token_word"][-1] == -1 and row["labels_chunk"][-1] == IGNORE  # [SEP]
    assert row["token_word"].count(0) > 1  # "Unbelievably" has several subwords


def test_subword_cap_per_word(tokenizer: PreTrainedTokenizerBase) -> None:
    url = "http://www.example.com/" + "abc/" * 20
    s = sent([f"{url} PROPN B-NP 0 root"])
    rows, _ = _encode(tokenizer, [s], max_per_word=4)
    assert rows[0]["token_word"].count(0) == 4


def test_partial_labels(tokenizer: PreTrainedTokenizerBase) -> None:
    partly = sent(DOG, sid="p", reviewed=[True, False, True, True])
    none = sent(DOG, doc="d2", sid="n", reviewed=[False] * 4)
    rows, stats = _encode(tokenizer, [partly, none])
    assert len(rows) == 1 and stats.dropped_windows == 1  # unreviewed-only window dropped
    row = rows[0]
    w1 = [t for t, w in enumerate(row["token_word"]) if w == 1]
    assert all(row["labels_chunk"][t] == IGNORE and row["labels_dep"][t] == IGNORE for t in w1)
    assert row["word_reviewed"] == [True, False, True, True]
    assert stats.labeled_words == 3


def test_windows_keep_sentence_boundaries_and_gold_fields(
    tokenizer: PreTrainedTokenizerBase,
) -> None:
    rows, _ = _encode(tokenizer, [sent(DOG, sid="a"), sent(DOG, sid="b")])
    row = rows[0]
    assert row["sent_ids"] == ["a", "b"]
    assert row["word_sent"] == [0] * 4 + [1] * 4
    assert row["word_index"] == [0, 1, 2, 3] * 2
    assert row["gold_head"] == [2, 3, 0, 3] * 2


# -- augmentation ------------------------------------------------------------------------


def test_augment_kinds() -> None:
    s = sent(DOG)
    low = augment_sentence(s, "lowercase_sentence_start")
    assert low is not None and low["words"][0]["form"] == "the"
    dropped = augment_sentence(s, "drop_final_punct")
    assert dropped is not None and [w["form"] for w in dropped["words"]] == ["The", "dog", "barked"]
    # final punctuation with a dependent is kept (no augmentation)
    odd = sent(["Hi INTJ O 2 discourse", "! PUNCT O 0 root"])
    assert augment_sentence(odd, "drop_final_punct") is None
    assert augment_sentence(sent(["iPhone PROPN B-NP 0 root"]), "lowercase_sentence_start") is None


def test_augment_respects_max_fraction() -> None:
    sents = [sent(DOG, sid=f"s{i}") for i in range(100)]
    out = augment(sents, ["lowercase_sentence_start", "drop_final_punct"], 0.15, seed=1)
    added = [s for s in out if "#aug-" in s["sent_id"]]
    assert 0 < len(added) <= 15
    assert Counter(s["sent_id"] for s in out if "#aug-" not in s["sent_id"]) == Counter(
        f"s{i}" for i in range(100)
    )


# -- labels.json -----------------------------------------------------------------------


def _cfg() -> dict[str, Any]:
    return {
        "windows": {"max_subword_tokens": 256, "max_subwords_per_word": 16},
        "ud_ewt": {"release_tag": "r2.19", "commit": "abc"},
    }


def test_labels_json_validates() -> None:
    maps = build_label_maps([sent(DOG, sid=f"s{i}") for i in range(5)], min_count=5)
    lab = make_labels_json(
        maps,
        "distilbert-base-cased",
        _cfg(),
        {"wink-nlp": "2.4.0", "wink-eng-lite-web-model": "1.8.1"},
    )
    assert validate_labels_json(lab) == []
    n_a = lab["groups"]["chunk"]["end"]
    assert lab["labels"][:n_a] == maps.chunk_labels
    assert lab["labels"][n_a:] == maps.dep_labels
    assert lab["calibration"] == {"temperature": None, "dep_temperature": None}
    assert lab["model_version"] is None


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d.pop("dep_encoding"), "top-level keys"),
        (lambda d: d.__setitem__("schema_version", 2), "schema_version"),
        (lambda d: d["groups"]["dep"].__setitem__("end", 999), "groups.dep.end"),
        (lambda d: d["labels"].__setitem__(0, "BAD|B-NP"), "bad group A label"),
        (lambda d: d["upos"].reverse(), "upos"),
        (lambda d: d["calibration"].__setitem__("temperature", "hot"), "calibration.temperature"),
        (lambda d: d["versions"].__setitem__("base_model", ""), "base_model"),
    ],
)
def test_labels_json_rejects_invalid(
    mutate: Callable[[dict[str, Any]], object], message: str
) -> None:
    maps = build_label_maps([sent(DOG, sid=f"s{i}") for i in range(5)], min_count=5)
    lab = make_labels_json(
        maps, "m", _cfg(), {"wink-nlp": "2.4.0", "wink-eng-lite-web-model": "1.8.1"}
    )
    mutate(lab)
    problems = validate_labels_json(lab)
    assert any(message in p for p in problems), problems


def test_window_type_defaults() -> None:
    assert Window("d", []).split_sentence is False
