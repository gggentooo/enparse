"""
training/scripts/prune_vocab.py — vocabulary pruning: the Lite model (T98)

Description:
    Builds a smaller copy of a trained model for phones and other low-memory
    devices without retraining. The tokenizer's word pieces that English text
    does not use are removed, and the matching rows of the word-embedding
    table are dropped; every other weight is unchanged. For
    DeBERTa-v3-xsmall the embedding table is more than half of the int8 file,
    so the Lite model is roughly 40% smaller on disk and in memory.

    The result is a normal run of a new model key (configs/prune.yaml →
    output.model), so the usual pipeline evaluates, calibrates, exports, and
    packages it:
        python scripts/prune_vocab.py
        python scripts/evaluate.py --model <lite> --run <run> --split dev
        python scripts/evaluate.py --model <lite> --run <run> --split test
        (cd js && npx tsx nested_eval.mjs --model <lite> --run <run> --split dev)
        (cd js && npx tsx nested_eval.mjs --model <lite> --run <run> --split test)
        python scripts/calibrate.py --model <lite> --run <run>
        python scripts/export_onnx.py --model <lite> --run <run> --parity-windows all
        (cd js && npm run benchmark -- --model <lite> --run <run> --mode parity)
        python scripts/evaluate.py --parity --model <lite> --run <run>
        python scripts/package_models.py

Steps:
    1. Count word pieces over the corpora of configs/prune.yaml: every distinct
       word is encoded alone, as the app and training encode words. EWT dev
       and test are not counted (honest evaluation).
    2. Keep: special and added tokens; pieces seen >= min_count times; every
       piece of the keep_all_from corpora; pieces of at most keep_max_chars
       characters (fallback for unseen words). Order is preserved, so the new
       id of a kept piece is its rank among the kept pieces.
    3. Write the pruned checkpoint data/checkpoints/<lite>/<run>/best/:
       tokenizer.json (Unigram vocab, added tokens, special-token ids),
       tokenizer_config.json, added_tokens.json, special_tokens_map.json,
       config.json (vocab_size), model.safetensors (embedding rows sliced),
       labels.json. No spm.model (the fast tokenizer reads tokenizer.json).
    4. Re-encode the dev and test windows of data/processed/dataset_arc/<source>/
       into data/processed/dataset_arc/<lite>/ with the pruned tokenizer
       (same words, sentences, and gold labels; token-level labels and head
       positions moved to the new first subwords).
    5. Write data/eval/<lite>/phase7_biaffine.json (selected run, base model,
       seed, derived_from) for package_models.py, and reports/prune.md.

Dependencies:
    Python: pyyaml, tokenizers, safetensors, torch, datasets, transformers.
    Reads:  configs/prune.yaml, configs/data.yaml; the source checkpoint and
            dataset; the corpora.
    Writes: data/checkpoints/<lite>/<run>/best/, data/processed/dataset_arc/<lite>/,
            data/eval/<lite>/phase7_biaffine.json, reports/prune.md.

Status: implemented (T98).
"""

from __future__ import annotations

import argparse
import bz2
import csv
import gzip
import html
import json
import re
import shutil
from collections import Counter
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import yaml

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
REPORT = TRAINING_DIR / "reports" / "prune.md"
IGNORE = -100
WORD_START = "▁"
# Words roughly as the runtime tokenizer splits them: letter runs (with inner hyphens and
# apostrophes), numbers, and single punctuation marks; contraction parts are added separately.
WORD = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*|\d+(?:[.,]\d+)*|[^\w\s]")
CONTRACTION = re.compile(r"(n't|'s|'re|'ve|'ll|'d|'m)$", re.IGNORECASE)
COPIED_FILES = ("special_tokens_map.json", "labels.json", "training_args.bin")


# -- corpora --------------------------------------------------------------------------------


def corpus_texts(kind: str, path: Path) -> Iterator[str]:
    """Text units (sentences, lemmas, words) of one corpus."""
    if kind == "tatoeba":
        with bz2.open(path, "rt", encoding="utf8") as f:
            for line in f:
                yield line.rstrip("\n").split("\t")[-1]
    elif kind == "wordnet":
        with gzip.open(path, "rt", encoding="utf8") as f:
            for line in f:
                for form in re.findall(r'writtenForm="([^"]*)"', line):
                    yield html.unescape(form)
                for text in re.findall(r"<(?:Definition|Example)[^>]*>([^<]*)<", line):
                    yield html.unescape(text)
    elif kind == "aligned":
        with open(path, encoding="utf8") as f:
            for line in f:
                if line.strip():
                    yield " ".join(w["form"] for w in json.loads(line)["words"])
    elif kind == "csv":
        with open(path, encoding="utf8", newline="") as f:
            for row in csv.reader(f):
                yield " ".join(cell for cell in row if cell)
    else:
        raise ValueError(f"unknown corpus kind {kind!r}")


def split_words(text: str) -> list[str]:
    """Words of a text, plus the parts the runtime tokenizer splits contractions into."""
    out: list[str] = []
    for word in WORD.findall(text):
        out.append(word)
        m = CONTRACTION.search(word)
        if m and m.start() > 0:
            out += [word[: m.start()], m.group(1)]
    return out


def count_words(texts: Iterable[str]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for text in texts:
        counts.update(split_words(text))
    return counts


# -- kept set -------------------------------------------------------------------------------


def piece_counts(
    tokenizer: Any,  # noqa: ANN401 (tokenizers.Tokenizer)
    words: Counter[str],
) -> Counter[int]:
    """Piece id → occurrences, each distinct word encoded alone and weighted by its count."""
    counts: Counter[int] = Counter()
    uniq = list(words)
    for start in range(0, len(uniq), 50_000):
        batch = uniq[start : start + 50_000]
        for word, enc in zip(
            batch, tokenizer.encode_batch(batch, add_special_tokens=False), strict=True
        ):
            for i in enc.ids:
                counts[i] += words[word]
    return counts


def in_ranges(text: str, ranges: list[list[int]]) -> bool:
    return all(any(lo <= ord(ch) <= hi for lo, hi in ranges) for ch in text)


def choose_kept(
    vocab: list[list[Any]],
    counts: Counter[int],
    always: set[int],
    min_count: int,
    keep_max_chars: int,
    short_ranges: list[list[int]],
) -> list[int]:
    """Old ids of the kept pieces, in vocabulary order.

    Short pieces (the fallback that spells unseen words) are kept only for characters in
    short_ranges: single characters of other scripts become the unknown token.
    """
    kept = []
    for i, (piece, _score) in enumerate(vocab):
        body = piece.replace(WORD_START, "")
        short = len(body) <= keep_max_chars and in_ranges(body, short_ranges)
        if i in always or counts[i] >= min_count or short:
            kept.append(i)
    return kept


# -- pruned tokenizer and checkpoint ---------------------------------------------------------


def prune_tokenizer_json(
    tok: dict[str, Any], kept: list[int]
) -> tuple[dict[str, Any], dict[int, int]]:
    """tokenizer.json with only the kept Unigram pieces; returns it and old id → new id.

    Added tokens beyond the Unigram vocabulary (e.g. [MASK]) keep their order after the pieces.
    """
    vocab = tok["model"]["vocab"]
    new_id = {old: new for new, old in enumerate(kept)}
    out = json.loads(json.dumps(tok))
    out["model"]["vocab"] = [vocab[i] for i in kept]
    out["model"]["unk_id"] = new_id[tok["model"]["unk_id"]]
    extra = len(kept)
    for added in sorted(out["added_tokens"], key=lambda a: a["id"]):
        if added["id"] < len(vocab):
            added["id"] = new_id[added["id"]]
        else:
            new_id[added["id"]] = extra
            added["id"] = extra
            extra += 1
    specials = (out.get("post_processor") or {}).get("special_tokens") or {}
    for spec in specials.values():
        spec["ids"] = [new_id[i] for i in spec["ids"]]
    return out, new_id


def write_checkpoint(
    src: Path, dst: Path, kept: list[int], tok_json: dict[str, Any], new_id: dict[int, int]
) -> int:
    """Pruned checkpoint in dst; returns the new vocabulary size (embedding rows)."""
    import torch
    from safetensors.torch import load_file, save_file

    dst.mkdir(parents=True, exist_ok=True)
    (dst / "tokenizer.json").write_text(json.dumps(tok_json, ensure_ascii=False), "utf8")
    rows = [old for old, _new in sorted(new_id.items(), key=lambda kv: kv[1])]
    size = len(rows)

    cfg = json.loads((src / "tokenizer_config.json").read_text("utf8"))
    cfg["added_tokens_decoder"] = {
        str(new_id[int(old)]): value for old, value in cfg.get("added_tokens_decoder", {}).items()
    }
    (dst / "tokenizer_config.json").write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", "utf8"
    )
    if (src / "added_tokens.json").exists():
        added = json.loads((src / "added_tokens.json").read_text("utf8"))
        (dst / "added_tokens.json").write_text(
            json.dumps({k: new_id[v] for k, v in added.items()}, indent=2) + "\n", "utf8"
        )
    for name in COPIED_FILES:
        if (src / name).exists():
            shutil.copyfile(src / name, dst / name)

    config = json.loads((src / "config.json").read_text("utf8"))
    old_size = int(config["vocab_size"])
    config["vocab_size"] = size
    (dst / "config.json").write_text(json.dumps(config, indent=2) + "\n", "utf8")

    weights = load_file(str(src / "model.safetensors"))
    index = torch.tensor(rows, dtype=torch.long)
    sliced = 0
    for name, tensor in list(weights.items()):
        if tensor.dim() == 2 and tensor.shape[0] == old_size and "word_embeddings" in name:
            weights[name] = tensor.index_select(0, index).contiguous()
            sliced += 1
    if sliced != 1:
        raise RuntimeError(f"expected one word-embedding table of {old_size} rows, found {sliced}")
    save_file(weights, str(dst / "model.safetensors"), metadata={"format": "pt"})
    return size


# -- dataset --------------------------------------------------------------------------------


def reencode_row(row: dict[str, Any], ids: list[int], word_ids: list[int | None]) -> dict[str, Any]:
    """A dataset window with the pruned tokenizer's tokens; word-level fields are unchanged."""
    old_first: dict[int, int] = {}
    for t, w in enumerate(row["token_word"]):
        if w >= 0 and w not in old_first:
            old_first[w] = t
    new_first: dict[int, int] = {}
    for t, w in enumerate(word_ids):
        if w is not None and w not in new_first:
            new_first[w] = t
    if set(old_first) != set(new_first):
        raise RuntimeError("the pruned tokenizer lost or gained words in a window")

    def head(old: int) -> int:
        if old in (IGNORE, 0):
            return old
        return new_first[row["token_word"][old]]

    n = len(ids)
    labels_chunk = [IGNORE] * n
    labels_rel = [IGNORE] * n
    labels_head = [IGNORE] * n
    token_sent = [-1] * n
    token_word = [-1] * n
    for t, w in enumerate(word_ids):
        if w is None:
            continue
        token_word[t] = w
        token_sent[t] = row["token_sent"][old_first[w]]
        if new_first[w] == t:
            o = old_first[w]
            labels_chunk[t] = row["labels_chunk"][o]
            labels_rel[t] = row["labels_rel"][o]
            labels_head[t] = head(row["labels_head"][o])
    return {
        **row,
        "input_ids": ids,
        "attention_mask": [1] * n,
        "labels_chunk": labels_chunk,
        "labels_rel": labels_rel,
        "labels_head": labels_head,
        "token_sent": token_sent,
        "token_word": token_word,
    }


def reencode_dataset(src: Path, dst: Path, checkpoint: Path, max_per_word: int) -> dict[str, Any]:
    """dev and test of the source dataset re-encoded with the pruned tokenizer."""
    from datasets import Dataset, DatasetDict, load_from_disk
    from transformers import AutoTokenizer

    from prepare_data import encode_words

    tokenizer = AutoTokenizer.from_pretrained(str(checkpoint), local_files_only=True)
    source = load_from_disk(str(src))
    stats: dict[str, Any] = {}
    out = {}
    for split in ("dev", "test"):
        rows, longer, longest, tokens_old, tokens_new, unk = [], 0, 0, 0, 0, 0
        for row in source[split]:
            ids, word_ids = encode_words(tokenizer, row["words"], max_per_word)
            rows.append(reencode_row(row, ids, word_ids))
            tokens_old += len(row["input_ids"])
            tokens_new += len(ids)
            longer += len(ids) > len(row["input_ids"])
            longest = max(longest, len(ids))
            unk += sum(1 for i in ids if i == tokenizer.unk_token_id)
        out[split] = Dataset.from_list(rows, features=source[split].features)
        stats[split] = {
            "windows": len(rows),
            "tokens_source": tokens_old,
            "tokens_pruned": tokens_new,
            "windows_longer": longer,
            "longest_window": longest,
            "unknown_tokens": unk,
        }
    if dst.exists():
        shutil.rmtree(dst)
    DatasetDict(out).save_to_disk(str(dst))
    if (src / "labels.json").exists():
        shutil.copyfile(src / "labels.json", dst / "labels.json")
    return stats


# -- main -----------------------------------------------------------------------------------


def render(info: dict[str, Any]) -> str:
    lines = [
        "<!-- Generated by scripts/prune_vocab.py (T98). Do not edit by hand. -->",
        "",
        f"# Vocabulary pruning — `{info['output']}`",
        "",
        f"Source: `{info['source']}` run `{info['run']}`. Every weight except the word-embedding "
        "rows of removed pieces is identical to the source model.",
        "",
        f"- Word pieces: {info['pieces_source']:,} → **{info['pieces_kept']:,}** "
        f"(embedding rows {info['rows_source']:,} → {info['rows_kept']:,})",
        f"- Rule: seen ≥ {info['min_count']} times in the corpora, or in "
        f"{', '.join(info['keep_all_from'])}, or at most {info['keep_max_chars']} character(s) "
        "of the Latin and punctuation ranges; "
        "EWT dev and test are not counted.",
        "",
        "| Corpus | Distinct words | Word occurrences |",
        "|---|---|---|",
    ]
    for name, c in info["corpora"].items():
        lines.append(f"| {name} | {c['types']:,} | {c['tokens']:,} |")
    lines += [
        "",
        "## Effect on the evaluation windows",
        "",
        "| Split | Windows | Tokens (source) | Tokens (pruned) | Windows that got longer "
        "| Longest window | Unknown tokens |",
        "|---|---|---|---|---|---|---|",
    ]
    for split, s in info["dataset"].items():
        lines.append(
            f"| {split} | {s['windows']:,} | {s['tokens_source']:,} | {s['tokens_pruned']:,} "
            f"| {s['windows_longer']:,} | {s['longest_window']} | {s['unknown_tokens']} |"
        )
    lines += [
        "",
        "Metrics, calibration, and parity of the pruned model: the usual reports "
        "(see the script header).",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Vocabulary pruning: the Lite model (T98).")
    parser.add_argument("--config", default=str(CONFIG_DIR / "prune.yaml"))
    parser.add_argument("--min-count", type=int, help="override min_count (experiments)")
    parser.add_argument("--output-model", help="override output.model (experiments)")
    args = parser.parse_args()

    from tokenizers import Tokenizer

    cfg = yaml.safe_load(Path(args.config).read_text("utf8"))
    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text("utf8"))
    paths = data_cfg["paths"]
    source = cfg["source"]["model"]
    output = args.output_model or cfg["output"]["model"]
    min_count = args.min_count if args.min_count is not None else int(cfg["min_count"])
    record = json.loads(
        (TRAINING_DIR / paths["eval"] / source / "phase7_biaffine.json").read_text()
    )
    run = cfg["source"].get("run") or record["selected_run"]
    src_ckpt = TRAINING_DIR / paths["checkpoints"] / source / run / "best"
    dst_ckpt = TRAINING_DIR / paths["checkpoints"] / output / run / "best"

    tok_json = json.loads((src_ckpt / "tokenizer.json").read_text("utf8"))
    if tok_json["model"]["type"] != "Unigram":
        raise SystemExit(f"only Unigram tokenizers are supported, got {tok_json['model']['type']}")
    tokenizer = Tokenizer.from_file(str(src_ckpt / "tokenizer.json"))
    vocab = tok_json["model"]["vocab"]

    counts: Counter[int] = Counter()
    always = {a["id"] for a in tok_json["added_tokens"] if a["id"] < len(vocab)}
    corpora: dict[str, dict[str, int]] = {}
    for name, corpus in cfg["corpora"].items():
        words = count_words(corpus_texts(corpus["kind"], TRAINING_DIR / corpus["path"]))
        pieces = piece_counts(tokenizer, words)
        counts.update(pieces)
        if name in cfg["keep_all_from"]:
            always |= set(pieces)
        corpora[name] = {"types": len(words), "tokens": sum(words.values())}
        print(f"{name}: {len(words):,} distinct words, {len(pieces):,} pieces")

    kept = choose_kept(
        vocab, counts, always, min_count, int(cfg["keep_max_chars"]), cfg["keep_short_ranges"]
    )
    pruned_json, new_id = prune_tokenizer_json(tok_json, kept)
    rows = write_checkpoint(src_ckpt, dst_ckpt, kept, pruned_json, new_id)
    print(
        f"pieces {len(vocab):,} -> {len(kept):,}; "
        f"checkpoint -> {dst_ckpt.relative_to(TRAINING_DIR)}"
    )

    labels = json.loads((src_ckpt / "labels.json").read_text("utf8"))
    dataset = reencode_dataset(
        TRAINING_DIR / paths["dataset_arc"] / source,
        TRAINING_DIR / paths["dataset_arc"] / output,
        dst_ckpt,
        int(labels["window"]["max_subwords_per_word"]),
    )
    for split, s in dataset.items():
        print(f"{split}: {s}")

    eval_dir = TRAINING_DIR / paths["eval"] / output
    eval_dir.mkdir(parents=True, exist_ok=True)
    derived = {
        "model": output,
        "base_model": record["base_model"],
        "stage": "biaffine",
        "derived_from": {
            "model": source,
            "run": run,
            "method": "vocabulary pruning (prune_vocab.py)",
        },
        "selected_run": run,
        "seeds": {run: {"seed": record["seeds"].get(run, {}).get("seed")}},
        "pruning": {"pieces_source": len(vocab), "pieces_kept": len(kept), "min_count": min_count},
    }
    (eval_dir / "phase7_biaffine.json").write_text(json.dumps(derived, indent=2) + "\n", "utf8")
    info = {
        "source": source,
        "output": output,
        "run": run,
        "pieces_source": len(vocab),
        "pieces_kept": len(kept),
        "rows_source": int(json.loads((src_ckpt / "config.json").read_text())["vocab_size"]),
        "rows_kept": rows,
        "min_count": min_count,
        "keep_all_from": cfg["keep_all_from"],
        "keep_max_chars": int(cfg["keep_max_chars"]),
        "corpora": corpora,
        "dataset": dataset,
    }
    if not args.output_model:
        REPORT.write_text(render(info), "utf8")
        print(f"report -> {REPORT.relative_to(TRAINING_DIR)}")


if __name__ == "__main__":
    main()
