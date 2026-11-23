"""
training/dictionary/extract.py — Wiktionary subset from the kaikki.org English extract (T70)

Description:
    kaikki.org serves only the latest extract, so the build keeps a pinned
    subset (owner, 2026-11-23): this script streams the downloaded
    kaikki.org-dictionary-English.jsonl.gz once and writes
    configs/dictionary.yaml → sources.wiktionary.subset.file with only what
    the dictionary can use:
      - entries whose word is a WordNet lemma, an NGSL headword, an EWT lemma
        (also capitalized, for proper adjectives such as "American"), or a
        "verb particle" phrase, in lower case, with a part of speech in
        common.WIKT_UPOS;
      - per entry: word, UPOS, inflected forms (with tags), Korean
        translations (sense label, word; entry-level and sense-level tables),
        definitions (most specific gloss per sense, with tags), the number of
        translations into all languages, and whether every sense is only a
        "form of" another word.
    Then it pins the subset's SHA-256 in the YAML. The full file may be
    deleted afterwards; build.py reads the subset only.

Usage (from training/): .venv/bin/python -m dictionary.extract
Status: implemented (T70).
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import re

from . import sources
from .common import CONFIG, SKIP_TAGS, WIKT_UPOS, is_phrasal, is_word, load_config, source_path


def candidates(cfg: dict) -> set[str]:
    words: set[str] = set()
    for lemma in sources.wordnet(source_path(cfg, "wordnet")):
        if is_word(lemma) or is_phrasal(lemma):
            words.add(lemma)
    core = set(sources.ngsl(source_path(cfg, "ngsl")))
    lemmas, _, _ = sources.ewt(source_path(cfg, "ngsl").parent.parent / "ud_ewt")
    core.update(lemmas)
    # Capitalized variants of core words: proper adjectives such as "American".
    return words | core | {w.capitalize() for w in core}


def trim(r: dict) -> dict | None:
    upos = WIKT_UPOS.get(r.get("pos", ""))
    if upos is None:
        return None
    ko: list[list[str]] = []
    total = 0
    for t in r.get("translations", []):
        total += 1
        if t.get("lang_code") == "ko" and t.get("word"):
            ko.append([t.get("sense", ""), t["word"]])
    glosses: list[list] = []
    form_of = 0
    senses = r.get("senses", [])
    for s in senses:
        tags = s.get("tags", [])
        if s.get("form_of") or s.get("alt_of") or "form-of" in tags or "alt-of" in tags:
            form_of += 1
        g = s.get("glosses") or []
        if g:
            glosses.append([g[-1], tags])
        for t in s.get("translations", []):
            total += 1
            if t.get("lang_code") == "ko" and t.get("word"):
                ko.append([t.get("sense") or (g[-1] if g else ""), t["word"]])
    forms = [
        [f["form"], f.get("tags", [])]
        for f in r.get("forms", [])
        if f.get("form") and not SKIP_TAGS.intersection(f.get("tags", []))
    ]
    return {
        "word": r["word"],
        "upos": upos,
        "forms": forms,
        "ko": ko,
        "glosses": glosses[:12],
        "translations": total,
        "only_form_of": bool(senses) and form_of == len(senses),
    }


def main() -> None:
    cfg = load_config()
    src = cfg["sources"]["wiktionary"]
    want = candidates(cfg)
    full = source_path(cfg, "wiktionary")
    out = full.parent / src["subset"]["file"].split("/")[-1]
    kept = 0
    seen = 0
    # mtime=0: the same input gives the same bytes (and SHA-256).
    with (
        gzip.open(full, "rt", encoding="utf8") as f,
        io.TextIOWrapper(gzip.GzipFile(out, "wb", compresslevel=9, mtime=0), encoding="utf8") as w,
    ):
        for line in f:
            seen += 1
            r = json.loads(line)
            word = r.get("word", "")
            if r.get("lang_code") != "en" or word not in want:
                continue
            t = trim(r)
            if t is None:
                continue
            w.write(json.dumps(t, ensure_ascii=False, separators=(",", ":")) + "\n")
            kept += 1
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    text = CONFIG.read_text(encoding="utf8")
    text = re.sub(
        r"(\n    subset:\n      file: [^\n]*\n      sha256: )\S+", rf"\g<1>{digest}", text, count=1
    )
    CONFIG.write_text(text, encoding="utf8")
    print(
        f"{seen} entries read, {kept} kept → {out.name} "
        f"({out.stat().st_size / 1e6:.1f} MB), SHA-256 {digest}"
    )


if __name__ == "__main__":
    main()
