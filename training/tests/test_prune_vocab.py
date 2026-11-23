"""
training/tests/test_prune_vocab.py — unit tests for scripts/prune_vocab.py (T98)

Description:
    The kept set follows the count, always-keep, and short-piece rules; the
    pruned tokenizer.json renumbers pieces, the unknown id, added tokens, and
    special-token ids; a re-encoded window keeps its word-level fields and moves
    token-level labels and head positions to the new first subwords; words are
    split like the runtime tokenizer (contraction parts).

Status: implemented (T98).
"""

from __future__ import annotations

from collections import Counter

from prune_vocab import choose_kept, prune_tokenizer_json, reencode_row, split_words

LATIN = [[0x0000, 0x024F]]
VOCAB = [["[PAD]", 0.0], ["[CLS]", 0.0], ["[SEP]", 0.0], ["[UNK]", 0.0]] + [
    [p, -1.0] for p in ["▁the", "▁dog", "▁Zyx", "s", "▁", "中", "ing"]
]


def test_choose_kept_applies_count_always_and_short_rules() -> None:
    counts = Counter({4: 100, 5: 9, 6: 1, 10: 50})
    kept = choose_kept(
        VOCAB, counts, {0, 1, 2, 3}, min_count=10, keep_max_chars=1, short_ranges=LATIN
    )
    # specials; "the" and "ing" by count; "s" and the bare word-start mark as short Latin pieces;
    # not "dog" (9 < 10), "Zyx" (rare), or the single CJK character (outside the short ranges).
    assert kept == [0, 1, 2, 3, 4, 7, 8, 10]
    assert 5 in choose_kept(VOCAB, counts, {0, 1, 2, 3, 5}, 10, 1, LATIN)


def test_prune_tokenizer_json_renumbers_everything() -> None:
    tok = {
        "added_tokens": [
            {"id": 0, "content": "[PAD]"},
            {"id": 3, "content": "[UNK]"},
            {"id": 11, "content": "[MASK]"},
        ],
        "post_processor": {"special_tokens": {"[CLS]": {"ids": [1]}, "[SEP]": {"ids": [2]}}},
        "model": {"type": "Unigram", "unk_id": 3, "vocab": VOCAB},
    }
    out, new_id = prune_tokenizer_json(tok, [0, 1, 2, 3, 4, 7, 8, 10])
    assert [p for p, _ in out["model"]["vocab"]][4:] == ["▁the", "s", "▁", "ing"]
    assert out["model"]["unk_id"] == 3
    assert new_id[10] == 7
    # [MASK] sat after the Unigram vocabulary: it follows the kept pieces.
    assert [a["id"] for a in out["added_tokens"]] == [0, 3, 8]
    assert new_id[11] == 8
    assert out["post_processor"]["special_tokens"]["[SEP]"]["ids"] == [2]
    assert len(tok["model"]["vocab"]) == len(VOCAB)  # the input is not changed


def test_reencode_row_moves_labels_and_heads_to_new_first_subwords() -> None:
    # Source: [CLS] The dog ##s barks [SEP]; "dog" is the head of "The" (token 2), "barks" the root.
    row = {
        "words": ["The", "dogs", "barks"],
        "input_ids": [1, 10, 11, 12, 13, 2],
        "attention_mask": [1] * 6,
        "token_word": [-1, 0, 1, 1, 2, -1],
        "token_sent": [-1, 0, 0, 0, 0, -1],
        "labels_chunk": [-100, 5, 6, -100, 7, -100],
        "labels_rel": [-100, 1, 2, -100, 3, -100],
        "labels_head": [-100, 2, 4, -100, 0, -100],
    }
    # Pruned: "The" is now two pieces, "dogs" one: [CLS] T ##he dogs barks [SEP].
    out = reencode_row(row, [1, 20, 21, 22, 23, 2], [None, 0, 0, 1, 2, None])
    assert out["token_word"] == [-1, 0, 0, 1, 2, -1]
    assert out["labels_chunk"] == [-100, 5, -100, 6, 7, -100]
    assert out["labels_rel"] == [-100, 1, -100, 2, 3, -100]
    assert out["labels_head"] == [-100, 3, -100, 4, 0, -100]  # "dogs" is now token 3, "barks" 4
    assert out["token_sent"] == [-1, 0, 0, 0, 0, -1]
    assert out["attention_mask"] == [1] * 6
    assert out["words"] == row["words"]


def test_split_words_adds_contraction_parts() -> None:
    words = split_words("I don't know Tom's well-known dog.")
    for w in ["don't", "do", "n't", "Tom's", "Tom", "'s", "well-known", ".", "I"]:
        assert w in words
