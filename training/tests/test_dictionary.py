"""
training/tests/test_dictionary.py — unit tests for the dictionary build (T70)

Description:
    Inline fixtures only (no files from data/): the shard hash (FNV-1a 32,
    shared with the app), word checks, headword selection (core, fill by
    translation count, phrasal verbs), inflected forms, entry layout (WordNet
    senses, Wiktionary definitions only where WordNet lacks the part of
    speech, Korean translations per part of speech), Tatoeba examples, and the
    output files (shards, index, manifest sizes and SHA-256).

Dependencies: Python: pytest. Tests: dictionary/ (common, sources, build).
Status: implemented (T70).
"""

from __future__ import annotations

import collections
import hashlib
import json
from pathlib import Path

import pytest
from dictionary import build, common
from dictionary.sources import Pair, Sense, WiktEntry, WordNetLemma


def wikt(word: str, upos: str, **kw: object) -> WiktEntry:
    return WiktEntry(
        word,
        upos,
        kw.get("forms", []),  # type: ignore[arg-type]
        kw.get("ko", []),  # type: ignore[arg-type]
        kw.get("glosses", []),  # type: ignore[arg-type]
        kw.get("translations", 0),  # type: ignore[arg-type]
        kw.get("only_form_of", False),  # type: ignore[arg-type]
    )


def data(**kw: object) -> build.Data:
    return build.Data(
        wordnet=kw.get("wordnet", {}),  # type: ignore[arg-type]
        wikt=kw.get("wikt", {}),  # type: ignore[arg-type]
        ngsl=kw.get("ngsl", []),  # type: ignore[arg-type]
        ngsl_forms=kw.get("ngsl_forms", {}),  # type: ignore[arg-type]
        cased=kw.get("cased", set()),  # type: ignore[arg-type]
        ewt_lemmas=collections.Counter(kw.get("ewt", {})),  # type: ignore[arg-type]
        ewt_surface=set(),
        ewt_test=[],
        pairs=kw.get("pairs", []),  # type: ignore[arg-type]
    )


RUN = WordNetLemma(
    senses={
        "VERB": [Sense("move fast on foot", ["she runs", "he ran", "they run"])],
        "NOUN": [Sense("a score in baseball", [])],
    },
    forms={"ran"},
)


def test_fnv1a32_matches_reference_values() -> None:
    assert common.fnv1a32("") == 0x811C9DC5
    assert common.fnv1a32("a") == 0xE40C292C
    assert common.fnv1a32("foobar") == 0xBF9CF968
    assert common.shard_of("run") == common.fnv1a32("run") % common.SHARDS


def test_word_and_phrasal_checks() -> None:
    assert common.is_word("don't") and common.is_word("well-known")
    assert not common.is_word("Paris") and not common.is_word("a b")
    assert common.is_phrasal("look up") and not common.is_phrasal("look dog")
    assert not common.is_phrasal("look up now")


def test_select_core_fill_and_phrasal_verbs() -> None:
    d = data(
        ngsl=["run", "zzz"],
        ewt={"walk": 5},
        wordnet={
            "run": RUN,
            "walk": WordNetLemma(senses={"VERB": [Sense("go on foot", [])]}),
            "eat": WordNetLemma(senses={"VERB": [Sense("take food", [])]}),
            "drink": WordNetLemma(senses={"VERB": [Sense("take liquid", [])]}),
            "nap": WordNetLemma(senses={"NOUN": [Sense("short sleep", [])]}),
            "run out": WordNetLemma(senses={"VERB": [Sense("be used up", [])]}),
            "eat up": WordNetLemma(senses={"VERB": [Sense("eat all", [])]}),
        },
        wikt={
            "eat": [wikt("eat", "VERB", ko=[("consume", "먹다")], translations=300)],
            "drink": [wikt("drink", "VERB", ko=[("consume liquid", "마시다")], translations=500)],
            "nap": [wikt("nap", "NOUN", translations=900)],  # no Korean: never a fill word
        },
    )
    words, phrasal = build.select(d, target=4)
    # "zzz" has no entry; the fill takes the most translated words with Korean first.
    assert words == ["run", "walk", "drink", "eat"]
    assert phrasal == ["eat up", "run out"]
    assert build.select(d, target=3)[0] == ["run", "walk", "drink"]


def test_forms_from_wiktionary_and_wordnet_without_variants() -> None:
    d = data(
        wordnet={"run": RUN},
        wikt={
            "run": [
                wikt(
                    "run",
                    "VERB",
                    glosses=[("to move quickly", [])],
                    forms=[
                        ("runs", ["present", "singular", "third-person"]),
                        ("running", ["participle", "present"]),
                        ("runned", ["past", "nonstandard"]),
                        ("Run", ["capitalized"]),
                    ],
                )
            ]
        },
    )
    assert build.forms_of(d, "run") == {"runs", "running", "ran"}
    assert build.forms_of(d, "run out") == {"runs out", "running out", "ran out"}


def test_capitalized_words_and_word_list_forms() -> None:
    d = data(
        ngsl=["i"],
        ngsl_forms={"i": ["me", "my"], "a": ["an"]},
        cased={"i"},
        ewt={"american": 3},
        wordnet={"i": WordNetLemma(senses={"NOUN": [Sense("the 9th letter", [])]})},
        wikt={
            "I": [wikt("I", "PRON", glosses=[("the speaker", [])])],
            "American": [wikt("American", "ADJ", glosses=[("of the United States", [])])],
        },
    )
    words, _ = build.select(d, target=0)
    assert words == ["I", "American"]
    e = build.entry(d, "I")
    assert e is not None and [g["upos"] for g in e["pos"]] == ["NOUN", "PRON"]
    assert build.forms_of(d, "I") == {"me", "my"}
    assert build.forms_of(d, "a") == {"an"}


def test_entry_per_part_of_speech_with_korean_groups() -> None:
    d = data(
        wordnet={"run": RUN},
        wikt={
            "run": [
                wikt(
                    "run", "VERB", ko=[("to move swiftly", "달리다"), ("to move swiftly", "뛰다")]
                ),
                wikt("run", "NOUN", ko=[("act of running", "달리기")]),
                wikt("run", "VERB", only_form_of=True, ko=[("x", "무시")]),
            ],
            "the": [
                wikt("the", "DET", glosses=[("definite article", []), ("old use", ["obsolete"])]),
            ],
        },
    )
    e = build.entry(d, "run")
    assert e is not None
    verb = next(g for g in e["pos"] if g["upos"] == "VERB")
    assert verb["from"] == "wordnet"
    assert verb["senses"] == [{"def": "move fast on foot", "examples": ["she runs", "he ran"]}]
    assert verb["ko"] == [{"sense": "to move swiftly", "words": ["달리다", "뛰다"]}]
    det = build.entry(d, "the")
    assert det == {
        "headword": "the",
        "pos": [
            {
                "upos": "DET",
                "senses": [{"def": "definite article", "examples": []}],
                "from": "wiktionary",
                "ko": [],
            }
        ],
        "examples": [],
    }
    assert build.entry(d, "nothing") is None


def test_examples_prefer_short_sentences_and_match_phrasal_verbs() -> None:
    entries = {"run": {"examples": []}, "run out": {"examples": []}, "dog": {"examples": []}}
    pairs = [
        Pair(3, 103, "The dog ran out of the house very quickly today.", "개가 집에서 뛰쳐나갔다."),
        Pair(2, 102, "We ran out of milk.", "우유가 떨어졌다."),
        Pair(1, 101, "Run!", "뛰어!"),  # too short
    ]
    forms = {"ran": {"run"}}

    def resolve(tok: str) -> set[str]:
        return ({tok} if tok in entries else set()) | forms.get(tok, set())

    build.attach_examples(entries, pairs, resolve, {"run": {"out"}})
    assert [x["tatoeba"] for x in entries["run out"]["examples"]] == [[2, 102], [3, 103]]
    assert [x["en"] for x in entries["run"]["examples"]] == [
        "We ran out of milk.",
        "The dog ran out of the house very quickly today.",
    ]
    assert entries["dog"]["examples"][0]["ko"] == "개가 집에서 뛰쳐나갔다."


def test_write_shards_index_and_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build, "OUT_ROOT", tmp_path)
    b = build.Built(
        entries={
            "run": {"headword": "run", "pos": [], "examples": []},
            "look up": {"headword": "look up"},
        },
        forms={"ran": ["run"]},
        stats={"headwords": 2},
    )
    src = {
        "name": "x",
        "url": "u",
        "sha256": "s",
        "license": "l",
        "license_url": "lu",
        "attribution": "a",
    }
    cfg = {
        "sources": {
            k: dict(src) for k in ("wordnet", "tatoeba_kor", "tatoeba_eng", "tatoeba_links", "ngsl")
        }
        | {"wiktionary": {**src, "downloaded": "2026-11-23", "subset": {"sha256": "t"}}}
    }
    out = build.write(b, cfg)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf8"))
    assert manifest["license"]["name"] == "CC BY-SA 4.0"
    assert manifest["hash"]["example"] == {"key": "run", "shard": common.shard_of("run")}
    assert len([f for f in manifest["files"] if f.startswith("shards/")]) == common.SHARDS
    for rel, meta in manifest["files"].items():
        data_ = (out / rel).read_bytes()
        assert meta == {"bytes": len(data_), "sha256": hashlib.sha256(data_).hexdigest()}
    shard = json.loads(
        (out / f"shards/{common.shard_of('look up'):03d}.json").read_text(encoding="utf8")
    )
    assert "look up" in shard
    index = json.loads((out / "index.json").read_text(encoding="utf8"))
    assert index["headwords"] == ["look up", "run"] and index["forms"] == {"ran": ["run"]}
