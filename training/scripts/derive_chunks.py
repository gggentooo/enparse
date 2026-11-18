"""
training/scripts/derive_chunks.py — convert UD dependency trees to flat BIO chunks

Description:
    UD has dependency trees, not chunks. This script derives flat,
    non-recursive CoNLL-2000-style chunks (NP, VP, PP, ADJP, ADVP, O) from
    each UD sentence and writes per-word BIO chunk tags.

Phase: 2 — Chunk derivation from UD trees.

Rules (plan-training.md → Phase 2; refinements listed there under *Rule details*):
    NP   head NOUN/PROPN/PRON/NUM (nominal), DET used as a pronoun, or SYM with
         a nummod (`$ 5`, `50 %`); joins left det, det:predet, amod, nummod,
         compound, nmod:poss (with its own left modifiers and possessive 's),
         flat/fixed/goeswith (either side), right nummod when adjacent.
    VP   head VERB/AUX (predicate); joins aux, aux:pass, cop, infinitive `to`,
         negation, compound:prt, and adverbs strictly inside the verb group.
         Copular predicates: aux/cop/to/not form a VP; the predicate keeps its
         own chunk (NP/ADJP/...).
    PP   word with `case` relation (not possessive 's, not SYM), plus `fixed`.
    ADJP ADJ not inside an NP; joins left advmod.
    ADVP ADV not absorbed by VP or ADJP; joins left advmod. Also isolated
         negation/particles that are cut off from their verb group.
    O    punctuation, conjunctions, other.
    Chunks are contiguous; a non-contiguous span is split at the gap.

Usage (from training/):
    python scripts/derive_chunks.py            # chunk all splits + reports/chunks.md
    python scripts/derive_chunks.py --review   # also write the dev review sample

Dependencies:
    Python: conllu, pyyaml.
    Reads:  configs/data.yaml (ud_ewt.*, paths.raw, paths.chunked, chunks.*);
            data/raw/ud_ewt/*.conllu.
    Writes: data/processed/chunked/*.conllu (raw CoNLL-U with `Chunk=<tag>`
            added to MISC of each word line; comments and multiword-token
            lines unchanged); reports/chunks.md; data/processed/review/
            chunk_review_sample.md (git-ignored; contains corpus text).
    Tested by: tests/test_derive_chunks.py.
    Consumed by: js/align_tokens.mjs, scripts/prepare_data.py.

Status: implemented (Phase 2).
"""

from __future__ import annotations

import argparse
import random
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import conllu
import yaml

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = TRAINING_DIR / "configs" / "data.yaml"
CHUNK_TYPES = ("NP", "VP", "PP", "ADJP", "ADVP")
OUTSIDE = "O"
MISC_KEY = "Chunk"

# Relations that attach a left modifier to the NP of its head.
NP_LEFT_RELS = frozenset({"det", "det:predet", "amod", "nummod", "compound", "nmod:poss"})
# Modifiers whose own left advmod / coordinated siblings also join the NP.
NP_MODIFIER_RELS = frozenset({"det", "det:predet", "amod", "nummod", "compound"})
# Relations that always join the chunk of their head, on either side.
JOIN_HEAD_RELS = frozenset({"flat", "fixed", "goeswith"})
# Verb-group core members attached to the predicate.
VG_CORE_RELS = frozenset({"aux", "aux:pass", "cop"})
NOMINAL_UPOS = frozenset({"NOUN", "PROPN", "PRON", "NUM"})
# Dependents that make a symbol a noun phrase head.
SYM_NOMINAL_KIDS = frozenset({"nummod", "det", "compound", "amod", "nmod:poss"})
# Heads of "at least" / "at most".
AT_SUPERLATIVES = frozenset({"least", "most"})
# Coordinated pre-modifiers that stay in the NP ("red and blue cars").
CONJ_MODIFIER_UPOS = frozenset({"ADJ", "NUM", "VERB", "DET", "NOUN", "PROPN"})
# Punctuation that may sit inside a chunk (between two of its words);
# brackets and sentence punctuation never do.
INTERIOR_PUNCT = frozenset({"-", "–", "/", ",", "+", '"', "“", "”", "'", "‘", "’", "``", "''"})
# Argument relations that make a bare adjective nominal ("Most of them", "has more").
NOMINAL_ARG_RELS = frozenset({"nsubj", "nsubj:pass", "obj", "iobj"})
# Clause markers that CoNLL-2000 treats as prepositions ("by giving", "of building").
PREPOSITION_MARKS = frozenset(
    {"of", "by", "in", "on", "with", "without", "about", "from", "into", "at", "upon", "through"}
)


@dataclass(frozen=True)
class Word:
    """One syntactic word (integer CoNLL-U id) with the fields the rules use."""

    id: int
    form: str
    lemma: str
    upos: str
    head: int
    deprel: str


@dataclass
class _Tree:
    words: dict[int, Word]
    children: dict[int, list[int]] = field(default_factory=dict)

    def kids(self, wid: int, rels: frozenset[str] | None = None) -> list[int]:
        out = self.children.get(wid, [])
        return [c for c in out if rels is None or self.words[c].deprel in rels]


# Chunk owner: (kind, anchor word id). kind is a chunk type, "VG" (verb group),
# or "O". The same anchor can own an NP and a VG (copular predicate).
Owner = tuple[str, int]


def words_from_tokenlist(sentence: conllu.TokenList) -> list[Word]:
    """Return the syntactic words of a sentence (skips ranges and empty nodes)."""
    out: list[Word] = []
    for tok in sentence:
        if not isinstance(tok["id"], int):
            continue
        out.append(
            Word(
                id=tok["id"],
                form=tok["form"],
                lemma=tok["lemma"] or tok["form"].lower(),
                upos=tok["upos"],
                head=int(tok["head"]) if tok["head"] is not None else 0,
                deprel=tok["deprel"],
            )
        )
    return out


def _is_negation(w: Word) -> bool:
    return w.deprel == "advmod" and w.upos == "PART" and w.lemma == "not"


def _is_possessive(w: Word) -> bool:
    return w.deprel == "case" and w.upos == "PART"


def _is_infinitive_to(w: Word) -> bool:
    return w.deprel == "mark" and w.upos == "PART" and w.lemma == "to"


class _Chunker:
    def __init__(self, words: list[Word]) -> None:
        self.tree = _Tree({w.id: w for w in words})
        for w in words:
            self.tree.children.setdefault(w.head, []).append(w.id)
        self.owner: dict[int, Owner] = {}
        self.core: set[int] = set()  # words that make a VG run a real VP

    # -- verb groups ---------------------------------------------------------

    def _has_vg(self, wid: int) -> bool:
        w = self.tree.words.get(wid)
        if w is None:
            return False
        if self.resolve(wid) == ("VG", wid):
            return True
        return bool(self.tree.kids(wid, VG_CORE_RELS))

    def _vg_core_span(self, wid: int) -> tuple[int, int]:
        ids = list(self.tree.kids(wid, VG_CORE_RELS))
        ids += [c for c in self.tree.kids(wid) if _is_infinitive_to(self.tree.words[c])]
        if self.resolve(wid) == ("VG", wid):
            ids.append(wid)
        return min(ids), max(ids)

    # -- owner resolution ----------------------------------------------------

    def resolve(self, wid: int) -> Owner:
        """Return the chunk owner of word `wid` (memoized, head-first)."""
        if wid in self.owner:
            return self.owner[wid]
        self.owner[wid] = ("O", wid)  # cycle guard; overwritten below
        result = self._resolve(self.tree.words[wid])
        self.owner[wid] = result
        return result

    def _resolve(self, w: Word) -> Owner:
        words = self.tree.words
        head = words.get(w.head)
        rel = w.deprel

        if head is not None:
            head_owner = self.resolve(head.id)
            head_kind = head_owner[0]

            if rel in JOIN_HEAD_RELS:
                return head_owner

            if _is_possessive(w) and head_kind == "NP":
                return head_owner

            if head_kind == "NP" and rel in NP_LEFT_RELS and w.id < head.id:
                return head_owner
            if head_kind == "NP" and rel == "nummod" and w.id == head.id + 1 and w.upos == "NUM":
                return head_owner
            # Dates and times: "October 4th", "January 2007", "05:09 PM".
            if head_kind == "NP" and rel == "nmod:unmarked" and abs(w.id - head.id) == 1:
                return head_owner
            # Adverb between NP pre-modifiers: "a largely Sunni Arab clan".
            if (
                head_kind == "NP"
                and rel == "advmod"
                and w.upos == "ADV"
                and w.id < head.id
                and self._left_neighbor_in(w.id, head_owner)
                and self._gap_joins(w.id, head.id, head_owner)
            ):
                return head_owner
            # det of a nominalized adverb/adjective chunk: "the sooner".
            if (
                rel == "det"
                and head_kind in {"ADJP", "ADVP"}
                and w.id < head.id
                and self._gap_joins(w.id, head.id, head_owner)
            ):
                return head_owner
            # Titles: "President Vladimir Putin" (EWT r2.19 `nmod:desc`).
            if head_kind == "NP" and rel == "nmod:desc" and w.id == head.id - 1:
                return head_owner
            # Quantifier modifiers of a bare number: "more than 200", "about 5".
            if head_kind == "NP" and head.upos == "NUM" and rel == "advmod" and w.id < head.id:
                return head_owner

            # Inside an NP modifier: its left advmod, and coordinated modifiers
            # (with their cc) before the NP anchor ("very big", "red and blue").
            if (
                head_kind == "NP"
                and head.id != head_owner[1]
                and head.deprel in NP_MODIFIER_RELS | {"conj", "advmod"}
            ):
                anchor = head_owner[1]
                if rel in {"advmod", "obl:unmarked", "compound"} and w.id < head.id:
                    return head_owner
                if rel == "conj" and w.id < anchor and w.upos in CONJ_MODIFIER_UPOS:
                    return head_owner
            if (
                rel == "cc"
                and head.deprel == "conj"
                and head_kind == "NP"
                and w.id < head.id
                and words[head.head].deprel in NP_MODIFIER_RELS
                and head_owner == self.resolve(head.head)
            ):
                return head_owner
            if rel in {"cc", "cc:preconj"}:
                return ("O", w.id)  # incl. multiword "as well as" via `fixed`

            if rel in VG_CORE_RELS:
                self.core.add(w.id)
                return ("VG", head.id)
            if _is_infinitive_to(w) and self._has_vg(head.id):
                self.core.add(w.id)
                return ("VG", head.id)
            if self._has_vg(head.id) and (
                _is_negation(w) or (rel == "compound:prt" and w.upos in {"ADP", "ADV"})
            ):
                return ("VG", head.id)
            if rel == "advmod" and w.upos == "ADV" and self._has_vg(head.id):
                lo, hi = self._vg_core_span(head.id)
                if lo < w.id < hi:
                    return ("VG", head.id)

            if (
                rel in {"advmod", "amod"}
                and head_kind in {"ADJP", "ADVP"}
                and w.id < head.id
                and self._gap_joins(w.id, head.id, head_owner)
            ):
                return head_owner
            # "anyone else", "somebody else"
            if head_kind == "NP" and rel == "advmod" and w.lemma == "else" and w.id == head.id + 1:
                return head_owner

        return self._own_chunk(w)

    def _is_descendant(self, wid: int, ancestor: int) -> bool:
        seen: set[int] = set()
        while wid in self.tree.words and wid not in seen:
            seen.add(wid)
            wid = self.tree.words[wid].head
            if wid == ancestor:
                return True
        return False

    def _left_neighbor_in(self, wid: int, owner: Owner) -> bool:
        prev = wid - 1
        if prev not in self.tree.words or self._is_descendant(prev, wid):
            return False
        return self.resolve(prev) == owner

    def _gap_joins(self, start: int, end: int, owner: Owner) -> bool:
        """True if every word strictly between start and end is in start's
        subtree or belongs to `owner` (keeps left modifiers contiguous)."""
        for j in range(start + 1, end):
            if self._is_descendant(j, start):
                continue
            if self.resolve(j) != owner:
                return False
        return True

    def _own_chunk(self, w: Word) -> Owner:
        words = self.tree.words
        # "at least", "at most" are one ADVP.
        head = words.get(w.head)
        if (
            w.lemma.lower() == "at"
            and head is not None
            and head.id == w.id + 1
            and head.lemma.lower() in AT_SUPERLATIVES
        ):
            return self.resolve(head.id)
        if w.lemma.lower() in AT_SUPERLATIVES and any(
            words[c].lemma.lower() == "at" and c == w.id - 1 for c in self.tree.kids(w.id)
        ):
            return ("ADVP", w.id)
        if w.deprel == "case" and w.upos not in {"PART", "SYM"}:
            # Stacked prepositions of one head form one PP ("out of").
            prev = words.get(w.id - 1)
            if prev is not None and prev.deprel == "case" and prev.head == w.head:
                prev_owner = self.resolve(prev.id)
                if prev_owner[0] == "PP":
                    return prev_owner
            return ("PP", w.id)
        if (
            w.deprel == "mark"
            and w.lemma.lower() in PREPOSITION_MARKS
            and words.get(w.head) is not None
            and words[w.head].upos == "VERB"
        ):
            return ("PP", w.id)
        if w.upos in NOMINAL_UPOS:
            return ("NP", w.id)
        if w.upos == "DET":
            return ("NP", w.id)
        if w.upos == "SYM" and (
            self.tree.kids(w.id, SYM_NOMINAL_KIDS) or w.deprel in NOMINAL_ARG_RELS | {"obl"}
        ):
            return ("NP", w.id)  # "$ 5", "50 %", "the $", "deal #"
        if w.upos == "VERB" and self.tree.kids(w.id, frozenset({"det"})):
            return ("NP", w.id)  # nominal use: "the following", "the wounded"
        if w.upos in {"VERB", "AUX"}:
            self.core.add(w.id)
            return ("VG", w.id)
        if w.upos == "ADJ":
            nominal_kids = frozenset({"det", "nmod:poss", "case"})
            if w.deprel in NOMINAL_ARG_RELS or any(
                not _is_possessive(words[c]) for c in self.tree.kids(w.id, nominal_kids)
            ):
                return ("NP", w.id)
            return ("ADJP", w.id)
        if w.upos == "ADV" or _is_negation(w):
            return ("ADVP", w.id)
        if w.upos == "ADP":
            return ("ADVP", w.id) if w.deprel == "compound:prt" else ("PP", w.id)
        return ("O", w.id)

    # -- tagging -------------------------------------------------------------

    def tags(self) -> list[str]:
        ids = sorted(self.tree.words)
        owners = {i: self.resolve(i) for i in ids}
        self._absorb_interior_punct(ids, owners)

        out: list[str] = []
        prev: Owner | None = None
        runs: list[tuple[Owner, list[int]]] = []
        for i in ids:
            o = owners[i]
            if o[0] == "O":
                prev = None
                runs.append((o, [i]))
                continue
            if o == prev:
                runs[-1][1].append(i)
            else:
                runs.append((o, [i]))
            prev = o

        # A verb-group run with no verb, auxiliary, or `to` (e.g., a stranded
        # particle or "not") is not a VP; tag it ADVP.
        for o, members in runs:
            kind = o[0]
            if kind == "O":
                out.append(OUTSIDE)
                continue
            if kind == "VG":
                kind = "VP" if any(m in self.core for m in members) else "ADVP"
            out.append(f"B-{kind}")
            out.extend(f"I-{kind}" for _ in members[1:])
        return out

    def _absorb_interior_punct(self, ids: list[int], owners: dict[int, Owner]) -> None:
        # Hyphens, slashes, and commas inside a chunk span ("well - known",
        # "big , red dog") join it if their head is in that chunk.
        for i in ids:
            w = self.tree.words[i]
            if owners[i][0] != "O" or w.form not in INTERIOR_PUNCT:
                continue
            head_owner = owners.get(w.head)
            if head_owner is None or head_owner[0] == "O":
                continue
            left = [j for j in ids if j < i and owners[j] == head_owner]
            right = [j for j in ids if j > i and owners[j] == head_owner]
            if left and right and left[-1] == i - 1 and right[0] == i + 1:
                owners[i] = head_owner


def derive_chunk_tags(words: list[Word]) -> list[str]:
    """Return one BIO chunk tag per word, in word order."""
    if not words:
        return []
    return _Chunker(words).tags()


def chunk_tokenlist(sentence: conllu.TokenList) -> list[str]:
    """Return BIO chunk tags for the syntactic words of a parsed sentence."""
    return derive_chunk_tags(words_from_tokenlist(sentence))


def validate_bio(tags: list[str]) -> None:
    """Raise ValueError if `tags` is not valid BIO over CHUNK_TYPES."""
    prev = OUTSIDE
    for i, t in enumerate(tags):
        if t == OUTSIDE:
            prev = t
            continue
        prefix, _, kind = t.partition("-")
        if prefix not in {"B", "I"} or kind not in CHUNK_TYPES:
            raise ValueError(f"bad tag {t!r} at {i}")
        if prefix == "I" and prev[2:] != kind:
            raise ValueError(f"{t} at {i} does not continue {prev}")
        prev = t


def bracketed(words: list[Word], tags: list[str]) -> str:
    """Render a sentence as `[NP the dog] [VP barked] .` for review."""
    parts: list[str] = []
    open_kind: str | None = None
    for w, t in zip(words, tags, strict=True):
        if open_kind and not t.startswith("I-"):
            parts[-1] += "]"
            open_kind = None
        if t.startswith("B-"):
            open_kind = t[2:]
            parts.append(f"[{open_kind} {w.form}")
        elif t.startswith("I-"):
            parts.append(w.form)
        else:
            parts.append(w.form)
    if open_kind:
        parts[-1] += "]"
    return " ".join(parts)


# -- file I/O ----------------------------------------------------------------


def _add_misc(misc: str, tag: str) -> str:
    entry = f"{MISC_KEY}={tag}"
    return entry if misc in ("", "_") else f"{misc}|{entry}"


def annotate_conllu(text: str) -> tuple[str, list[list[str]]]:
    """Add `Chunk=<tag>` to MISC of every word line; return text and tags."""
    out_blocks: list[str] = []
    all_tags: list[list[str]] = []
    for block in text.strip("\n").split("\n\n"):
        sentence = conllu.parse(block + "\n\n")[0]
        tags = chunk_tokenlist(sentence)
        validate_bio(tags)
        all_tags.append(tags)
        it = iter(tags)
        lines: list[str] = []
        for line in block.split("\n"):
            cols = line.split("\t")
            if len(cols) == 10 and cols[0].isdigit():
                cols[9] = _add_misc(cols[9], next(it))
                line = "\t".join(cols)
            lines.append(line)
        if next(it, None) is not None:
            raise ValueError("tag count does not match word lines")
        out_blocks.append("\n".join(lines))
    return "\n\n".join(out_blocks) + "\n\n", all_tags


def chunk_counts(all_tags: list[list[str]]) -> Counter[str]:
    """Count chunks (B- tags) per type, plus words tagged O."""
    c: Counter[str] = Counter()
    for tags in all_tags:
        for t in tags:
            if t.startswith("B-"):
                c[t[2:]] += 1
            elif t == OUTSIDE:
                c[OUTSIDE] += 1
    return c


def write_report(
    path: Path, cfg: dict[str, Any], stats: dict[str, tuple[int, int, Counter[str]]]
) -> None:
    """Write the chunk-type distribution per split to `path`."""
    ewt = cfg["ud_ewt"]
    lines = [
        "# Chunk distribution (Phase 2)",
        "",
        f"Generated by `scripts/derive_chunks.py` from UD English EWT {ewt['release_tag']} "
        f"(commit `{ewt['commit'][:12]}`). Counts are chunks (B- tags); `O` counts words.",
        "",
        "| Split | Sentences | Words | " + " | ".join(CHUNK_TYPES) + " | Chunks | O words |",
        "|---" * (len(CHUNK_TYPES) + 5) + "|",
    ]
    for split, (n_sent, n_words, c) in stats.items():
        total = sum(c[k] for k in CHUNK_TYPES)
        cells = [f"{c[k]:,} ({c[k] / total:.1%})" for k in CHUNK_TYPES]
        lines.append(
            f"| {split} | {n_sent:,} | {n_words:,} | "
            + " | ".join(cells)
            + f" | {total:,} | {c[OUTSIDE]:,} |"
        )
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_review_sample(path: Path, sentences: list[conllu.TokenList], n: int, seed: int) -> int:
    """Write `n` seeded dev sentences as bracketed chunks; return the chunk count."""
    rng = random.Random(seed)
    picks = sorted(rng.sample(range(len(sentences)), n))
    lines = [
        "# Chunk review sample (git-ignored: contains corpus text)",
        "",
        f"{n} dev sentences, seed {seed}. Mark errors in `reports/chunk_review.md`.",
        "",
    ]
    total = 0
    for k, idx in enumerate(picks, 1):
        s = sentences[idx]
        words = words_from_tokenlist(s)
        tags = derive_chunk_tags(words)
        total += sum(t.startswith("B-") for t in tags)
        lines.append(f"{k}. `{s.metadata['sent_id']}` {bracketed(words, tags)}")
    lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return total


def main() -> None:
    """Chunk every split listed in data.yaml and write reports."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--review", action="store_true", help="write the dev review sample")
    args = parser.parse_args()

    cfg = yaml.safe_load(CONFIG_PATH.read_text())
    ewt = cfg["ud_ewt"]
    raw_dir = TRAINING_DIR / cfg["paths"]["raw"] / ewt["dir"]
    out_dir = TRAINING_DIR / cfg["paths"]["chunked"]
    out_dir.mkdir(parents=True, exist_ok=True)

    stats: dict[str, tuple[int, int, Counter[str]]] = {}
    for split in cfg["chunks"]["splits"]:
        src = raw_dir / ewt["files"][split]
        text, all_tags = annotate_conllu(src.read_text(encoding="utf-8"))
        (out_dir / src.name).write_text(text, encoding="utf-8")
        stats[split] = (len(all_tags), sum(map(len, all_tags)), chunk_counts(all_tags))
        print(f"{split}: {len(all_tags):,} sentences -> {out_dir / src.name}")

    report = TRAINING_DIR / cfg["chunks"]["report"]
    write_report(report, cfg, stats)
    print(f"report -> {report}")

    if args.review:
        review = cfg["chunks"]["review"]
        dev = conllu.parse((raw_dir / ewt["files"]["dev"]).read_text(encoding="utf-8"))
        path = TRAINING_DIR / review["sample_path"]
        n_chunks = write_review_sample(path, dev, review["sentences"], review["seed"])
        print(f"review sample ({n_chunks} chunks) -> {path}")


if __name__ == "__main__":
    main()
