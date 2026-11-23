"""
training/dictionary/sources.py — readers for the pinned dictionary sources (T70)

Description:
    Plain readers, one per source; no selection logic.
      wordnet(path)     Open English WordNet 2025 (WN-LMF XML): lemma → part
                        of speech → senses (definition, examples) in WordNet's
                        order, plus irregular forms (<Form>).
      wiktionary(path)  the kaikki.org subset (extract.py): entries with word,
                        UPOS, forms, Korean translations by sense, glosses.
      ngsl(path)        NGSL 1.2 headwords.
      ewt(dir)          UD English EWT lemmas with frequencies, and surface forms.
      tatoeba(...)      Korean–English sentence pairs.

Status: implemented (T70).
"""

from __future__ import annotations

import bz2
import collections
import gzip
import json
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from .common import WN_UPOS, is_word


@dataclass
class Sense:
    definition: str
    examples: list[str]


@dataclass
class WordNetLemma:
    #: UPOS → senses, in WordNet's order (most frequent first).
    senses: dict[str, list[Sense]] = field(default_factory=dict)
    #: Irregular forms listed in WordNet (<Form>), e.g. "ran" for "run".
    forms: set[str] = field(default_factory=set)


def wordnet(path: Path) -> dict[str, WordNetLemma]:
    """Lemma (written form) → senses by UPOS and irregular forms."""
    synsets: dict[str, Sense] = {}
    entries: list[tuple[str, str, list[str], list[str]]] = []
    with gzip.open(path, "rb") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag == "LexicalEntry":
                lemma = el.find("Lemma")
                if lemma is not None:
                    entries.append(
                        (
                            lemma.get("writtenForm", ""),
                            lemma.get("partOfSpeech", ""),
                            [s.get("synset", "") for s in el.findall("Sense")],
                            [x.get("writtenForm", "") for x in el.findall("Form")],
                        )
                    )
                el.clear()
            elif el.tag == "Synset":
                d = el.find("Definition")
                synsets[el.get("id", "")] = Sense(
                    (d.text or "").strip() if d is not None else "",
                    [(x.text or "").strip() for x in el.findall("Example") if x.text],
                )
                el.clear()
    out: dict[str, WordNetLemma] = collections.defaultdict(WordNetLemma)
    for written, pos, sense_ids, forms in entries:
        upos = WN_UPOS.get(pos)
        if not upos or not written:
            continue
        item = out[written.replace("_", " ")]
        lst = item.senses.setdefault(upos, [])
        lst.extend(synsets[s] for s in sense_ids if s in synsets and synsets[s].definition)
        item.forms.update(x for x in forms if x)
    return dict(out)


@dataclass
class WiktEntry:
    word: str
    upos: str
    #: (form, tags) pairs.
    forms: list[tuple[str, list[str]]]
    #: Korean translations: (sense label, Korean word).
    ko: list[tuple[str, str]]
    #: Definitions (most specific gloss per sense) with their tags.
    glosses: list[tuple[str, list[str]]]
    #: Number of translations into any language (a proxy for how common the word is).
    translations: int
    #: Every sense is "form of" / "alternative form of" another word.
    only_form_of: bool


def wiktionary(path: Path) -> Iterator[WiktEntry]:
    with gzip.open(path, "rt", encoding="utf8") as f:
        for line in f:
            r = json.loads(line)
            yield WiktEntry(
                r["word"],
                r["upos"],
                [(x[0], x[1]) for x in r.get("forms", [])],
                [(x[0], x[1]) for x in r.get("ko", [])],
                [(x[0], x[1]) for x in r.get("glosses", [])],
                r.get("translations", 0),
                r.get("only_form_of", False),
            )


#: NGSL forms that are contraction pieces ("isn" of "isn't") or ambiguous ("won"), not forms.
NGSL_FRAGMENTS = frozenset(
    "m s re ve ll d t isn aren ain wasn weren bein don doesn didn hasn haven hadn won shouldn"
    " wouldn couldn mustn needn shan mightn".split()
)


def ngsl_rows(path: Path) -> list[tuple[str, list[str]]]:
    """NGSL rows: headword as written (e.g. "I") and its listed forms (lower case)."""
    out: list[tuple[str, list[str]]] = []
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cells = [c.strip() for c in line.split(",")]
        head = cells[0]
        if not is_word(head.lower()):
            continue
        forms = [
            f.lower() for f in cells[1:] if is_word(f.lower()) and f.lower() not in NGSL_FRAGMENTS
        ]
        out.append((head, forms))
    return out


def ngsl(path: Path) -> list[str]:
    """NGSL headwords (first column), lower case, in list order."""
    out: list[str] = []
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        w = line.split(",")[0].strip().lower()
        if is_word(w) and w not in out:
            out.append(w)
    return out


SKIP_UPOS = frozenset({"PUNCT", "SYM", "X", "NUM", "PROPN"})


def ewt(directory: Path) -> tuple[collections.Counter[str], set[str], list[tuple[str, str]]]:
    """UD English EWT (train, dev, test): lemma counts, surface forms, test (word, UPOS) tokens."""
    lemmas: collections.Counter[str] = collections.Counter()
    surface: set[str] = set()
    test: list[tuple[str, str]] = []
    for split in ("train", "dev", "test"):
        for line in (
            (directory / f"en_ewt-ud-{split}.conllu").read_text(encoding="utf8").splitlines()
        ):
            if not line or line.startswith("#"):
                continue
            p = line.split("\t")
            if "-" in p[0] or "." in p[0]:
                continue
            if split == "test":
                test.append((p[1], p[3]))
            if p[3] in SKIP_UPOS:
                continue
            lemma, form = p[2].lower(), p[1].lower()
            if is_word(lemma):
                lemmas[lemma] += 1
            if is_word(form):
                surface.add(form)
    return lemmas, surface, test


@dataclass
class Pair:
    en_id: int
    ko_id: int
    en: str
    ko: str


def tatoeba(kor: Path, eng: Path, links: Path) -> list[Pair]:
    """Korean–English sentence pairs (one per Korean sentence and English translation)."""

    def rows(p: Path) -> Iterator[list[str]]:
        with bz2.open(p, "rt", encoding="utf8") as f:
            for line in f:
                yield line.rstrip("\n").split("\t")

    ko = {int(r[0]): r[2] for r in rows(kor) if len(r) >= 3}
    pairs_ids = [(int(r[0]), int(r[1])) for r in rows(links) if len(r) >= 2 and int(r[0]) in ko]
    wanted = {e for _, e in pairs_ids}
    en = {int(r[0]): r[2] for r in rows(eng) if len(r) >= 3 and int(r[0]) in wanted}
    return [Pair(e, k, en[e], ko[k]) for k, e in pairs_ids if e in en]
