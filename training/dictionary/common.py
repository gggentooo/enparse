"""
training/dictionary/common.py — shared settings and helpers of the dictionary build (T70)

Description:
    Paths, the config, the build settings (owner decisions T25, T42,
    2026-11-23), the shard hash, part-of-speech maps, and small text helpers.
    The app reads the output with the same hash (manifest → hash) and the same
    keys: every key in the output comes from the app's own `lookupKey`
    (js/dict_lemmas.mjs), never from Python string functions.

Status: implemented (T70).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

TRAINING = Path(__file__).resolve().parent.parent
REPO = TRAINING.parent
CONFIG = TRAINING / "configs" / "dictionary.yaml"
#: Working files (candidates, wink check) and the output (data/dict/v<N>/), all git-ignored.
WORK = TRAINING / "data" / "dict" / "build"
OUT_ROOT = TRAINING / "data" / "dict"

#: Dictionary data version (served at /dict/v<N>/; the app's Cache Storage is enparse-dict-v<N>).
VERSION = 1
SCHEMA = 1
#: Entry shards (T42: ~64–256), chosen by FNV-1a 32 of the UTF-8 lookup key.
SHARDS = 128
#: Single-word headwords: NGSL ∪ EWT lemmas, filled up to this count with WordNet lemmas
#: that have a Korean translation in Wiktionary (owner, 2026-11-23).
TARGET_HEADWORDS = 15_000
#: Tatoeba example pairs kept per headword, and their English length in words.
EXAMPLES_PER_ENTRY = 3
EXAMPLE_WORDS = (3, 14)
#: WordNet examples kept per sense; Wiktionary glosses per part of speech (only for parts of
#: speech WordNet does not cover); Korean sense groups and words per group.
SENSE_EXAMPLES = 2
WIKT_GLOSSES = 6
KO_GROUPS = 8
KO_WORDS = 6

#: Particles of phrasal verbs ("look up"; T25: phrasal verbs are the only multi-word headwords).
PARTICLES = frozenset(
    "about across after along apart around aside away back by down forth in into off on onto out"
    " over round through together under up upon with without".split()
)

#: Wiktionary (wiktextract) part of speech → UPOS; parts of speech not listed are not used.
WIKT_UPOS = {
    "noun": "NOUN",
    "verb": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "pron": "PRON",
    "det": "DET",
    "article": "DET",
    "prep": "ADP",
    "postp": "ADP",
    "conj": "CCONJ",
    "intj": "INTJ",
    "num": "NUM",
    "particle": "PART",
}
#: WordNet part of speech → UPOS (s = adjective satellite).
WN_UPOS = {"n": "NOUN", "v": "VERB", "a": "ADJ", "s": "ADJ", "r": "ADV"}

#: Wiktionary form tags that make an inflected form of the headword (for the inflection index).
FORM_TAGS = frozenset(
    {
        "plural",
        "past",
        "participle",
        "present",
        "third-person",
        "singular",
        "comparative",
        "superlative",
    }
)
#: Form or sense tags that are left out (not current standard English).
SKIP_TAGS = frozenset(
    {
        "alternative",
        "obsolete",
        "archaic",
        "misspelling",
        "dialectal",
        "nonstandard",
        "rare",
        "pronunciation-spelling",
        "colloquial",
        "Internet",
        "dated",
        "form-of",
        "alt-of",
        "abbreviation",
    }
)

WORD_RE = re.compile(r"[a-z][a-z'-]*")


def load_config() -> dict[str, Any]:
    return yaml.safe_load(CONFIG.read_text(encoding="utf8"))


def source_path(cfg: dict[str, Any], key: str) -> Path:
    return TRAINING / cfg["sources"][key]["file"]


def is_word(text: str) -> bool:
    """A lower-case English word (letters, apostrophes, hyphens)."""
    return WORD_RE.fullmatch(text) is not None


def is_phrasal(text: str) -> bool:
    """ "verb particle" with a lower-case verb and a known particle."""
    parts = text.split(" ")
    return len(parts) == 2 and is_word(parts[0]) and parts[1] in PARTICLES


def fnv1a32(text: str) -> int:
    """FNV-1a 32-bit hash of the UTF-8 bytes (the app computes the same to find a shard)."""
    h = 0x811C9DC5
    for b in text.encode("utf8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def shard_of(key: str, shards: int = SHARDS) -> int:
    return fnv1a32(key) % shards
