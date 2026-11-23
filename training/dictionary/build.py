"""
training/dictionary/build.py — build the app's dictionary data (T70)

Description:
    Builds data/dict/v<VERSION>/ from the pinned sources (configs/dictionary.yaml):
      1. Headwords (owner, 2026-11-23): NGSL ∪ UD EWT lemmas that have a
         WordNet or Wiktionary entry, then WordNet lemmas with a Korean
         translation in Wiktionary (most translated first) up to
         TARGET_HEADWORDS single words; plus phrasal verbs ("look up") whose
         verb is a headword (T25: the only multi-word headwords).
      2. Entries, per part of speech (UPOS; owner, 2026-11-23): WordNet senses
         (definition, up to SENSE_EXAMPLES examples) — or, for parts of speech
         WordNet lacks (pronouns, determiners, prepositions, …), Wiktionary
         definitions — and, separately, Korean translations grouped under
         Wiktionary's sense labels (not matched to WordNet senses). Up to
         EXAMPLES_PER_ENTRY Tatoeba English–Korean pairs per headword.
      3. Inflection index: Wiktionary forms + WordNet irregular forms (and
         "verb particle" forms of phrasal verbs), checked against the app's
         wink lemmatizer; corpus words whose wink lemma is a headword are
         added (T42).
      4. Keys: every key comes from the app's lookupKey (js/dict_lemmas.mjs).
      5. Output: index.json (headwords, form → headwords), SHARDS entry shards
         (FNV-1a 32 of the key, shards/NNN.json), manifest.json (version,
         license, hash, counts, sources with attributions, every file's size
         and SHA-256), and reports/dictionary.md (counts, sizes, coverage).

Usage (from training/): .venv/bin/python -m dictionary.build
Dependencies: Python standard library, pyyaml; Node (npx tsx) for js/dict_lemmas.mjs.
Reads: configs/dictionary.yaml; data/raw/ (WordNet, Wiktionary subset, NGSL, UD EWT, Tatoeba).
Writes: data/dict/build/ (work files), data/dict/v<VERSION>/, reports/dictionary.md.
Status: implemented (T70).
"""

from __future__ import annotations

import collections
import hashlib
import json
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import sources
from .common import (
    EXAMPLE_WORDS,
    EXAMPLES_PER_ENTRY,
    FORM_TAGS,
    KO_GROUPS,
    KO_WORDS,
    OUT_ROOT,
    SCHEMA,
    SENSE_EXAMPLES,
    SHARDS,
    SKIP_TAGS,
    TARGET_HEADWORDS,
    TRAINING,
    VERSION,
    WIKT_GLOSSES,
    WORK,
    is_phrasal,
    is_word,
    load_config,
    shard_of,
    source_path,
)

#: Parts of speech WordNet covers (others come from Wiktionary only).
WN_COVERED = frozenset({"NOUN", "VERB", "ADJ", "ADV"})
UPOS_ORDER = [
    "NOUN",
    "VERB",
    "ADJ",
    "ADV",
    "PRON",
    "DET",
    "ADP",
    "CCONJ",
    "SCONJ",
    "NUM",
    "PART",
    "INTJ",
]
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'-]*")
LICENSE = {"name": "CC BY-SA 4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0/"}


@dataclass
class Data:
    wordnet: dict[str, sources.WordNetLemma]
    wikt: dict[str, list[sources.WiktEntry]]
    ngsl: list[str]
    #: NGSL forms by lower-case headword ("i" → me, my, mine; "a" → an).
    ngsl_forms: dict[str, list[str]]
    #: Lower-case words the word list writes with a capital ("i" → "I").
    cased: set[str]
    ewt_lemmas: collections.Counter[str]
    ewt_surface: set[str]
    ewt_test: list[tuple[str, str]]
    pairs: list[sources.Pair]


def load() -> Data:
    cfg = load_config()
    wikt: dict[str, list[sources.WiktEntry]] = collections.defaultdict(list)
    subset = TRAINING / cfg["sources"]["wiktionary"]["subset"]["file"]
    for e in sources.wiktionary(subset):
        wikt[e.word].append(e)
    lemmas, surface, test = sources.ewt(TRAINING / "data" / "raw" / "ud_ewt")
    rows = sources.ngsl_rows(source_path(cfg, "ngsl"))
    return Data(
        sources.wordnet(source_path(cfg, "wordnet")),
        dict(wikt),
        sources.ngsl(source_path(cfg, "ngsl")),
        {h.lower(): forms for h, forms in rows},
        {h.lower() for h, _ in rows if h != h.lower()},
        lemmas,
        surface,
        test,
        sources.tatoeba(
            source_path(cfg, "tatoeba_kor"),
            source_path(cfg, "tatoeba_eng"),
            source_path(cfg, "tatoeba_links"),
        ),
    )


# -- selection -------------------------------------------------------------------------------


def wikt_useful(e: sources.WiktEntry) -> bool:
    return not e.only_form_of and (bool(current_glosses(e)) or bool(e.ko))


def current_glosses(e: sources.WiktEntry) -> list[str]:
    return [g for g, tags in e.glosses if g and not SKIP_TAGS.intersection(tags)]


def wikt_entries(d: Data, word: str) -> list[sources.WiktEntry]:
    """Usable Wiktionary entries of a word; only "form of" entries if it has nothing else.

    A common word such as "me" or "an" is only a form of another word in Wiktionary ("objective
    case of I"); for headwords those definitions are shown rather than nothing.
    """
    es = d.wikt.get(word, [])
    useful = [e for e in es if wikt_useful(e)]
    return useful or [e for e in es if e.only_form_of and e.glosses]


def variants(word: str) -> list[str]:
    """Spellings whose source entries make up a headword: lower case and capitalized."""
    base = word.lower()
    return list(dict.fromkeys([base, base.capitalize()]))


def spelling(d: Data, word: str) -> str | None:
    """How a core word is shown: as the word list writes it ("I"), else lower case if the sources
    have it, else capitalized ("American"); None if no source has it."""
    found = [w for w in variants(word) if w in d.wordnet or wikt_entries(d, w)]
    if not found:
        return None
    return word.capitalize() if word in d.cased else found[0]


def wn_senses(d: Data, word: str) -> dict[str, list[sources.Sense]]:
    out: dict[str, list[sources.Sense]] = {}
    for w in variants(word) if " " not in word else [word]:
        for upos, senses in getattr(d.wordnet.get(w), "senses", {}).items():
            out.setdefault(upos, []).extend(senses)
    return out


def has_content(d: Data, word: str) -> bool:
    return word in d.wordnet or any(wikt_useful(e) for e in d.wikt.get(word, []))


def has_korean(d: Data, word: str) -> bool:
    return any(e.ko and not e.only_form_of for e in d.wikt.get(word, []))


def select(d: Data, target: int = TARGET_HEADWORDS) -> tuple[list[str], list[str]]:
    """Single-word headwords (core first, then fill) and phrasal verbs."""
    core: list[str] = []
    seen: set[str] = set()
    for w in [*d.ngsl, *(w for w, _ in d.ewt_lemmas.most_common())]:
        written = spelling(d, w) if is_word(w) else None
        if w not in seen and written is not None:
            core.append(written)
            seen.add(w)
    popularity = {w: max((e.translations for e in es), default=0) for w, es in d.wikt.items()}
    fill = sorted(
        (w for w in d.wordnet if is_word(w) and w not in seen and has_korean(d, w)),
        key=lambda w: (-popularity.get(w, 0), w),
    )
    words = core + fill[: max(0, target - len(core))]
    chosen = set(words)
    phrasal = sorted(
        p
        for p in {*d.wordnet, *d.wikt}
        if is_phrasal(p)
        and p.split(" ")[0] in chosen
        and (
            "VERB" in getattr(d.wordnet.get(p), "senses", {})
            or any(e.upos == "VERB" and wikt_useful(e) for e in d.wikt.get(p, []))
        )
    )
    return words, phrasal


# -- forms -----------------------------------------------------------------------------------


def forms_of(d: Data, word: str) -> set[str]:
    """Inflected forms of a headword (single words; "verb particle" for phrasal verbs)."""
    if " " in word:
        verb, particle = word.split(" ")
        return {f"{f} {particle}" for f in forms_of(d, verb)}
    out: set[str] = set()
    senses = wn_senses(d, word)
    for v in variants(word):
        for e in d.wikt.get(v, []):
            # Forms of parts of speech the word really has: a rare Wiktionary use ("dead" as a
            # verb: "deaded") is left out when WordNet knows the word but not that part of speech.
            if not wikt_useful(e) or (senses and e.upos in WN_COVERED and e.upos not in senses):
                continue
            for form, tags in e.forms:
                ok = FORM_TAGS.intersection(tags) and not SKIP_TAGS.intersection(tags)
                if ok and is_word(form.lower()):
                    out.add(form)
        lemma = d.wordnet.get(v)
        if lemma:
            out.update(f for f in lemma.forms if is_word(f.lower()))
    out.update(d.ngsl_forms.get(word.lower(), []))
    return {f for f in out if f.lower() != word.lower()}


# -- entries ---------------------------------------------------------------------------------


def entry(d: Data, word: str) -> dict[str, Any] | None:
    senses_wn = wn_senses(d, word)
    wikt = [e for v in (variants(word) if " " not in word else [word]) for e in wikt_entries(d, v)]
    groups: list[dict[str, Any]] = []
    for upos in UPOS_ORDER:
        senses: list[dict[str, Any]] = []
        origin = None
        if senses_wn.get(upos):
            origin = "wordnet"
            for s in senses_wn[upos]:
                senses.append({"def": s.definition, "examples": s.examples[:SENSE_EXAMPLES]})
        else:
            glosses: list[str] = []
            for e in wikt:
                if e.upos == upos:
                    own = current_glosses(e) or [g for g, _ in e.glosses]
                    glosses.extend(g for g in own if g not in glosses)
            if glosses:
                origin = "wiktionary"
                senses = [{"def": g, "examples": []} for g in glosses[:WIKT_GLOSSES]]
        ko: dict[str, list[str]] = {}
        for e in wikt:
            if e.upos != upos:
                continue
            for label, kw in e.ko:
                words = ko.setdefault(label, [])
                if kw not in words and len(words) < KO_WORDS:
                    words.append(kw)
        if not senses and not ko:
            continue
        group: dict[str, Any] = {"upos": upos, "senses": senses}
        if origin:
            group["from"] = origin
        group["ko"] = [{"sense": k, "words": v} for k, v in list(ko.items())[:KO_GROUPS]]
        groups.append(group)
    if not groups:
        return None
    groups.sort(key=lambda g: -len(g["senses"]))  # stable: UPOS_ORDER among equals
    return {"headword": word, "pos": groups, "examples": []}


def attach_examples(
    entries: dict[str, dict[str, Any]],
    pairs: list[sources.Pair],
    resolve: Callable[[str], set[str]],
    particles_of: dict[str, set[str]],
) -> None:
    """Up to EXAMPLES_PER_ENTRY shortest Tatoeba pairs per headword (by English length, then id)."""
    found: dict[str, list[tuple[int, int, sources.Pair]]] = collections.defaultdict(list)
    lo, hi = EXAMPLE_WORDS
    for p in pairs:
        tokens = [t.lower() for t in TOKEN_RE.findall(p.en)]
        if not lo <= len(tokens) <= hi:
            continue
        hits: set[str] = set()
        for i, tok in enumerate(tokens):
            for key in resolve(tok):
                hits.add(key)
                nxt = tokens[i + 1] if i + 1 < len(tokens) else None
                if nxt and nxt in particles_of.get(key, set()):
                    hits.add(f"{key} {nxt}")
        for key in hits:
            if key in entries:
                found[key].append((len(tokens), p.en_id, p))
    for key, items in found.items():
        seen: set[str] = set()
        for _, _, p in sorted(items, key=lambda x: (x[0], x[1])):
            if p.en in seen:
                continue
            seen.add(p.en)
            entries[key]["examples"].append({"en": p.en, "ko": p.ko, "tatoeba": [p.en_id, p.ko_id]})
            if len(seen) >= EXAMPLES_PER_ENTRY:
                break


# -- app keys and lemmas (js/dict_lemmas.mjs) --------------------------------------------------


def app_keys(texts: set[str]) -> tuple[dict[str, str], dict[str, str]]:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / "wink_in.json").write_text(json.dumps({"texts": sorted(texts)}), encoding="utf8")
    subprocess.run(["npx", "tsx", "dict_lemmas.mjs"], cwd=TRAINING / "js", check=True)
    out = json.loads((WORK / "wink_out.json").read_text(encoding="utf8"))
    return out["keys"], out["lemmas"]


# -- output ----------------------------------------------------------------------------------


def dump(obj: object) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf8")


@dataclass
class Built:
    entries: dict[str, dict[str, Any]]
    forms: dict[str, list[str]]
    stats: dict[str, Any] = field(default_factory=dict)


def build(d: Data) -> Built:
    words, phrasal = select(d)
    headwords = words + phrasal
    forms = {w: forms_of(d, w) for w in headwords}
    tatoeba_tokens = {t.lower() for p in d.pairs for t in TOKEN_RE.findall(p.en)}
    texts = (
        set(headwords) | {f for fs in forms.values() for f in fs} | d.ewt_surface | tatoeba_tokens
    )
    keys, lemmas = app_keys(texts)
    key = keys.__getitem__

    entries: dict[str, dict[str, Any]] = {}
    for w in headwords:
        e = entry(d, w)
        if e is not None:
            entries[key(w)] = e
    index: dict[str, set[str]] = collections.defaultdict(set)
    agree = checked = unlemmatized = 0
    for w in headwords:
        hk = key(w)
        if hk not in entries:
            continue
        for f in forms[w]:
            fk = key(f)
            if fk != hk:
                index[fk].add(hk)
            if f in lemmas:
                checked += 1
                lk = keys.get(lemmas[f], lemmas[f].lower())
                agree += lk == hk
                unlemmatized += lk == fk
    wink_added = 0
    for s in sorted(d.ewt_surface | tatoeba_tokens):
        sk = key(s)
        lemma = lemmas.get(s)
        if not lemma:
            continue
        lk = keys.get(lemma, lemma.lower())
        if lk != sk and lk in entries and sk not in entries and lk not in index.get(sk, set()):
            index[sk].add(lk)
            wink_added += 1

    def resolve(token: str) -> set[str]:
        tk = keys.get(token, token)
        out = {tk} if tk in entries else set()
        out |= index.get(tk, set())
        lemma = lemmas.get(token)
        if lemma and keys.get(lemma, lemma.lower()) in entries:
            out.add(keys.get(lemma, lemma.lower()))
        return out

    particles_of: dict[str, set[str]] = collections.defaultdict(set)
    for k in entries:
        if " " in k:
            verb, particle = k.split(" ")
            particles_of[verb].add(particle)
    attach_examples(entries, d.pairs, resolve, particles_of)

    stats = {
        "headwords": len(entries),
        "single_words": sum(1 for k in entries if " " not in k),
        "phrasal_verbs": sum(1 for k in entries if " " in k),
        "forms": len(index),
        "form_checks": checked,
        "form_checks_agree_with_wink": agree,
        "form_checks_wink_unlemmatized": unlemmatized,
        "wink_added_forms": wink_added,
        "with_korean": sum(1 for e in entries.values() if any(g["ko"] for g in e["pos"])),
        "with_examples": sum(1 for e in entries.values() if e["examples"]),
        "senses": sum(len(g["senses"]) for e in entries.values() for g in e["pos"]),
        "senses_from_wiktionary": sum(
            len(g["senses"])
            for e in entries.values()
            for g in e["pos"]
            if g.get("from") == "wiktionary"
        ),
    }
    built = Built(entries, {k: sorted(v) for k, v in sorted(index.items())}, stats)
    built.stats["coverage"] = coverage(d, built, keys, lemmas)
    return built


def coverage(d: Data, b: Built, keys: dict[str, str], lemmas: dict[str, str]) -> dict[str, Any]:
    """Share of UD EWT test tokens (words, not punctuation/numbers/names) a lookup resolves."""
    direct = via_index = via_wink = missed = 0
    missing: collections.Counter[str] = collections.Counter()
    for form, upos in d.ewt_test:
        w = form.lower()
        if upos in sources.SKIP_UPOS or not is_word(w):
            continue
        k = keys.get(w, w)
        lemma = lemmas.get(w)
        lk = keys.get(lemma, lemma.lower()) if lemma else None
        if k in b.entries:
            direct += 1
        elif k in b.forms:
            via_index += 1
        elif lk in b.entries:
            via_wink += 1
        else:
            missed += 1
            missing[w] += 1
    total = direct + via_index + via_wink + missed
    return {
        "tokens": total,
        "headword": direct,
        "form_index": via_index,
        "wink_lemma": via_wink,
        "missed": missed,
        "resolved_share": (total - missed) / total if total else 0,
        "top_missed": missing.most_common(25),
    }


def write(b: Built, cfg: dict[str, Any]) -> Path:
    out = OUT_ROOT / f"v{VERSION}"
    if out.exists():
        shutil.rmtree(out)
    (out / "shards").mkdir(parents=True)
    files: dict[str, dict[str, Any]] = {}

    def put(rel: str, data: bytes) -> None:
        (out / rel).write_bytes(data)
        files[rel] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    by_shard: dict[int, dict[str, Any]] = collections.defaultdict(dict)
    for k, e in b.entries.items():
        by_shard[shard_of(k)][k] = e
    for n in range(SHARDS):
        put(f"shards/{n:03d}.json", dump(by_shard.get(n, {})))
    put(
        "index.json",
        dump(
            {"schema": SCHEMA, "version": VERSION, "headwords": sorted(b.entries), "forms": b.forms}
        ),
    )
    srcs = []
    for key in ("wordnet", "wiktionary", "tatoeba_kor", "tatoeba_eng", "tatoeba_links", "ngsl"):
        s = cfg["sources"][key]
        item = {k: s[k] for k in ("name", "url", "sha256", "license", "license_url", "attribution")}
        if key == "wiktionary":
            item["downloaded"] = str(s["downloaded"])
            item["subset_sha256"] = s["subset"]["sha256"]
        srcs.append({"key": key, **item})
    manifest = {
        "schema": SCHEMA,
        "version": VERSION,
        "built": datetime.now(UTC).strftime("%Y-%m-%d"),
        "license": LICENSE,
        "hash": {
            "name": "fnv1a32-utf8",
            "shards": SHARDS,
            "example": {"key": "run", "shard": shard_of("run")},
        },
        "counts": {k: v for k, v in b.stats.items() if k != "coverage"},
        "sources": srcs,
        "files": dict(sorted(files.items())),
    }
    (out / "manifest.json").write_bytes(
        json.dumps(manifest, ensure_ascii=False, indent=1).encode("utf8")
    )
    return out


def _pct(a: int, t: int) -> str:
    return f"{100 * a / t:.1f}%" if t else "—"


def report(b: Built, out: Path) -> None:
    s, c = b.stats, b.stats["coverage"]
    sizes = sorted(p.stat().st_size for p in (out / "shards").glob("*.json"))
    total = sum(p.stat().st_size for p in out.rglob("*.json"))
    index_mb = (out / "index.json").stat().st_size / 1e6
    hw = s["headwords"]
    agree, checked = s["form_checks_agree_with_wink"], s["form_checks"]
    same = s["form_checks_wink_unlemmatized"]
    lo, hi, mid = sizes[0] / 1e3, sizes[-1] / 1e3, sizes[len(sizes) // 2] / 1e3
    contents = [
        ("Headwords", f"{hw:,}"),
        ("Single words", f"{s['single_words']:,}"),
        ("Phrasal verbs", f"{s['phrasal_verbs']:,}"),
        ("With Korean translations", f"{s['with_korean']:,} ({_pct(s['with_korean'], hw)})"),
        ("With Tatoeba examples", f"{s['with_examples']:,} ({_pct(s['with_examples'], hw)})"),
        ("Senses", f"{s['senses']:,} (Wiktionary definitions: {s['senses_from_wiktionary']:,})"),
        (
            "Inflected forms in the index",
            f"{s['forms']:,} (added from wink lemmas: {s['wink_added_forms']:,})",
        ),
        ("Index forms whose wink lemma is the headword", f"{_pct(agree, checked)} of {checked:,}"),
        ("… wink leaves the form as is (no lemma out of context)", f"{_pct(same, checked)}"),
        ("… wink gives another lemma", f"{_pct(checked - agree - same, checked)}"),
    ]
    t = c["tokens"]
    resolved = [
        ("Headword", c["headword"]),
        ("Inflection index", c["form_index"]),
        ("wink lemma", c["wink_lemma"]),
        ("Not found", c["missed"]),
    ]
    lines = [
        "# Dictionary build report (T70)",
        "",
        f"Generated by `dictionary/build.py` (data version v{VERSION}, schema {SCHEMA}).",
        "Sources and licenses: `configs/dictionary.yaml`, `dictionary/DATA_CARD.md`.",
        f"Output: `data/dict/v{VERSION}/` (uploaded to R2 under `dict/v{VERSION}/`).",
        "",
        "## Contents",
        "",
        "| | Count |",
        "|---|---|",
        *(f"| {k} | {v} |" for k, v in contents),
        "",
        "## Size",
        "",
        f"Total {total / 1e6:.1f} MB (uncompressed JSON); index.json {index_mb:.2f} MB;",
        f"{SHARDS} shards, {lo:.0f}–{hi:.0f} kB (median {mid:.0f} kB).",
        "",
        "## Coverage (UD English EWT test words)",
        "",
        "Words only (no punctuation, numbers, symbols, or proper nouns), lower case,",
        "as the app looks them up.",
        "",
        "| Resolved by | Tokens |",
        "|---|---|",
        *(f"| {k} | {v:,} ({_pct(v, t)}) |" for k, v in resolved),
        f"| **Resolved** | **{_pct(t - c['missed'], t)}** of {t:,} |",
        "",
        "Most frequent words not found: "
        + ", ".join(f"{w} ({n})" for w, n in c["top_missed"])
        + ".",
        "",
    ]
    (TRAINING / "reports" / "dictionary.md").write_text("\n".join(lines), encoding="utf8")


def main() -> None:
    cfg = load_config()
    d = load()
    b = build(d)
    out = write(b, cfg)
    report(b, out)
    s = b.stats
    print(
        f"v{VERSION}: {s['headwords']} headwords ({s['phrasal_verbs']} phrasal), "
        f"{s['forms']} forms, coverage {100 * s['coverage']['resolved_share']:.1f}% → {out}"
    )


if __name__ == "__main__":
    main()
