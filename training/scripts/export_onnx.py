"""
training/scripts/export_onnx.py — export a trained candidate to ONNX for Transformers.js

Description:
    Exports the best checkpoint of one run with Optimum (task:
    token-classification) into the folder layout Transformers.js expects,
    produces the int8 and fp16 variants, checks them, and writes the files the
    parity checks need. Run once per candidate model (every model is trained
    and may be offered in the app's model library).

Phases: 7 (smoke-test export per candidate), 9 (final export and
        quantization per candidate). Phase 11 packaging is done by
        scripts/package_models.py.

Output (data/onnx/<model>/<run>/):
    config.json, tokenizer files       from the checkpoint
    onnx/model.onnx                    fp32 (parity only; not shipped)
    onnx/model_quantized.onnx          int8 dynamic quantization (WASM)
    onnx/model_fp16.onnx               fp16 weights, fp32 inputs/outputs (WebGPU)
    labels.json                        the checkpoint's labels.json with `files`
                                       (bytes and SHA-256 of the shipped files)
    reference.json                     fixed sentences: words, Python token ids
                                       (pre-split words, per-word subword cap),
                                       PyTorch argmax per word (both groups)
    parity_inputs.jsonl                dev windows: token ids, token→word map,
                                       PyTorch argmax per word (for js/benchmark.mjs)
    export_report.json                 sizes, onnx.checker results, onnxruntime
                                       agreement with PyTorch per variant

Steps:
    1. main_export (Optimum) to a temp folder; move model.onnx to onnx/.
    2. int8: onnxruntime quantize_dynamic, per-channel by default
       (configs/eval.yaml → export).
    3. fp16: onnxruntime.transformers.float16 (keep_io_types).
    4. Topologically re-sort each graph, counting values that If/Loop
       subgraphs read from the outer graph (quantization can leave DeBERTa's
       graph unsorted), then onnx.checker on every file.
    5. PyTorch argmax and top-two logit margin per word on the reference
       sentences and the first N dev windows; onnxruntime (CPU) argmax per
       variant; word-level agreement (all words and confident words).
    6. labels.json `files`; validate_labels_json.

Usage (from training/):
    python scripts/export_onnx.py --model distilbert_base_cased --run smoke
    python scripts/export_onnx.py --model distilbert_base_cased --run <run> --parity-windows all

Dependencies:
    Python: optimum-onnx, onnx, onnxruntime, transformers, torch, datasets, pyyaml;
            scripts/prepare_data.py (encode_words, validate_labels_json), scripts/metrics.py.
    Reads:  configs/eval.yaml (export, smoke); configs/train_<model>.yaml;
            configs/data.yaml (paths); data/checkpoints/<model>/<run>/best/;
            data/processed/dataset/<model>/ (dev windows).
    Writes: data/onnx/<model>/<run>/ (git-ignored).
    Consumed by: js/benchmark.mjs (smoke, parity, speed), scripts/evaluate.py
                 (Phase 9 parity), scripts/package_models.py (Phase 11).

Status: implemented (Phase 7 pre-work). Not yet run on a trained candidate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import yaml

from metrics import LabelSpace, word_argmax
from prepare_data import encode_words, validate_labels_json

if TYPE_CHECKING:
    import onnx
    from datasets import Dataset
    from transformers import PreTrainedTokenizerBase

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
VARIANT_FILES = {
    "fp32": "onnx/model.onnx",
    "int8": "onnx/model_quantized.onnx",
    "fp16": "onnx/model_fp16.onnx",
}
SHIPPED_VARIANTS = ("int8", "fp16")
NOT_SHIPPED = {"labels.json", "reference.json", "parity_inputs.jsonl", "export_report.json"}


def sha256(path: Path) -> str:
    """Hex SHA-256 of a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def export_fp32(checkpoint: Path, out: Path, opset: int) -> None:
    """Optimum export of the checkpoint (fp32) into out/, ONNX file under onnx/."""
    from optimum.exporters.onnx import main_export

    with tempfile.TemporaryDirectory() as tmp:
        main_export(
            str(checkpoint),
            output=tmp,
            task="token-classification",
            opset=opset,
            device="cpu",
            do_validation=True,
            local_files_only=True,
        )
        tmp_dir = Path(tmp)
        (out / "onnx").mkdir(parents=True, exist_ok=True)
        for f in tmp_dir.iterdir():
            if f.suffix == ".onnx" or f.name.endswith(".onnx_data"):
                shutil.move(str(f), out / "onnx" / f.name)
            elif f.is_file():
                shutil.copy2(f, out / f.name)


def make_int8(out: Path, per_channel: bool, exclude: list[str]) -> None:
    """Dynamic int8 quantization of the fp32 model."""
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(
        model_input=str(out / VARIANT_FILES["fp32"]),
        model_output=str(out / VARIANT_FILES["int8"]),
        weight_type=QuantType.QInt8,
        per_channel=per_channel,
        nodes_to_exclude=exclude,
    )


def make_fp16(out: Path, keep_io_types: bool) -> None:
    """fp16 weights; fp32 inputs and outputs when keep_io_types."""
    import onnx
    from onnxruntime.transformers.float16 import convert_float_to_float16

    model = onnx.load(str(out / VARIANT_FILES["fp32"]))
    onnx.save(
        convert_float_to_float16(model, keep_io_types=keep_io_types),
        str(out / VARIANT_FILES["fp16"]),
    )


def _reads(node: onnx.NodeProto) -> set[str]:
    """Values a node reads, including outer-scope values used inside its subgraphs."""
    import onnx

    names = {i for i in node.input if i}
    for attr in node.attribute:
        graphs = [attr.g] if attr.type == onnx.AttributeProto.GRAPH else list(attr.graphs)
        for g in graphs:
            local = {i.name for i in g.input} | {t.name for t in g.initializer}
            for n in g.node:
                local |= set(n.output)
            for n in g.node:
                names |= {x for x in _reads(n) if x not in local}
    return names


def topo_sort(path: Path) -> bool:
    """Re-order the main graph's nodes topologically; True if the order changed."""
    import onnx

    model = onnx.load(str(path))
    g = model.graph
    available = {i.name for i in g.input} | {t.name for t in g.initializer} | {""}
    pending = list(g.node)
    ordered: list[Any] = []
    while pending:
        rest = []
        for n in pending:
            if _reads(n) <= available:
                ordered.append(n)
                available |= set(n.output)
            else:
                rest.append(n)
        if len(rest) == len(pending):
            raise RuntimeError(
                f"{path.name}: cannot sort graph ({len(rest)} nodes, e.g. {rest[0].name})"
            )
        pending = rest
    changed = [list(n.output) for n in ordered] != [list(n.output) for n in g.node]
    if changed:
        del g.node[:]
        g.node.extend(ordered)
        onnx.save(model, str(path))
    return changed


def check_files(out: Path, variants: list[str]) -> dict[str, str]:
    """onnx.checker result per variant ("ok" or the error)."""
    import onnx

    results = {}
    for v in variants:
        try:
            onnx.checker.check_model(str(out / VARIANT_FILES[v]))
            results[v] = "ok"
        except Exception as e:  # noqa: BLE001 — record any checker failure
            results[v] = f"{type(e).__name__}: {e}"
    return results


def word_margins(
    logits: np.ndarray, token_word: list[int], space: LabelSpace
) -> tuple[list[float], list[float]]:
    """Top-two logit gap per word (first subword), per group."""
    from metrics import first_subword_positions

    firsts = first_subword_positions(token_word)
    n_words = max(firsts) + 1 if firsts else 0
    out: tuple[list[float], list[float]] = ([], [])
    for k, (lo, hi) in enumerate(
        ((space.chunk_start, space.chunk_end), (space.dep_start, space.dep_end))
    ):
        for w in range(n_words):
            top = np.sort(logits[firsts[w], lo:hi])[::-1]
            out[k].append(round(float(top[0] - top[1]), 4))
    return out


def torch_argmax(
    checkpoint: Path, windows: list[dict[str, Any]], space: LabelSpace
) -> list[tuple[list[int], list[int], list[float], list[float]]]:
    """PyTorch (CPU) argmax and top-two margin per word for each window."""
    import torch
    from transformers import AutoModelForTokenClassification

    model = AutoModelForTokenClassification.from_pretrained(str(checkpoint), local_files_only=True)
    model.eval()
    out = []
    with torch.no_grad():
        for w in windows:
            ids = torch.tensor([w["input_ids"]])
            logits = model(input_ids=ids, attention_mask=torch.ones_like(ids)).logits[0].numpy()
            pa, pb = word_argmax(logits, w["token_word"], space)
            ma, mb = word_margins(logits, w["token_word"], space)
            out.append((pa, pb, ma, mb))
    return out


def ort_argmax(
    model_path: Path, windows: list[dict[str, Any]], space: LabelSpace
) -> tuple[list[tuple[list[int], list[int]]], int]:
    """onnxruntime (CPU) argmax per word for each window; also the logits width."""
    import onnxruntime as ort

    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    names = {i.name for i in sess.get_inputs()}
    out = []
    width = 0
    for w in windows:
        ids = np.array([w["input_ids"]], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": np.ones_like(ids)}
        if "token_type_ids" in names:
            feed["token_type_ids"] = np.zeros_like(ids)
        logits = sess.run(None, {k: v for k, v in feed.items() if k in names})[0][0]
        width = int(logits.shape[-1])
        out.append(word_argmax(logits.astype(np.float32), w["token_word"], space))
    return out, width


def agreement(
    ref: list[tuple[list[int], list[int], list[float], list[float]]],
    other: list[tuple[list[int], list[int]]],
    margin: float = 0.0,
) -> dict[str, float]:
    """Share of words with the same argmax per group, over words whose reference margin > margin."""
    same = [0, 0]
    total = [0, 0]
    for (pa, pb, ma, mb), (qa, qb) in zip(ref, other, strict=True):
        for k, (p, q, m) in enumerate(((pa, qa, ma), (pb, qb, mb))):
            for x, y, gap in zip(p, q, m, strict=True):
                if gap > margin or margin == 0.0:
                    total[k] += 1
                    same[k] += int(x == y)
    return {
        "chunk": same[0] / total[0] if total[0] else 1.0,
        "dep": same[1] / total[1] if total[1] else 1.0,
    }


def reference_windows(
    tokenizer: PreTrainedTokenizerBase, sentences: list[str], max_per_word: int
) -> list[dict[str, Any]]:
    """Token ids of fixed sentences (pre-split words, per-word cap), like the runtime."""
    out = []
    for text in sentences:
        words = text.split()
        ids, wids = encode_words(tokenizer, words, max_per_word)
        out.append(
            {"words": words, "input_ids": ids, "token_word": [-1 if w is None else w for w in wids]}
        )
    return out


def dev_windows(dataset: Dataset, n: int | None) -> list[dict[str, Any]]:
    """First n dev windows (all if None) with the fields the checks need."""
    count = len(dataset) if n is None else min(n, len(dataset))
    return [
        {"input_ids": dataset[i]["input_ids"], "token_word": dataset[i]["token_word"]}
        for i in range(count)
    ]


def export(
    checkpoint: Path,
    out: Path,
    export_cfg: dict[str, Any],
    reference_sentences: list[str],
    dev: list[dict[str, Any]],
) -> dict[str, Any]:
    """Run every export step; return the export report."""
    from transformers import AutoTokenizer

    started = time.perf_counter()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    labels_json = json.loads((checkpoint / "labels.json").read_text())
    space = LabelSpace.from_labels_json(labels_json)
    tokenizer = AutoTokenizer.from_pretrained(str(checkpoint), local_files_only=True)
    variants = list(export_cfg["variants"])

    export_fp32(checkpoint, out, int(export_cfg["opset"]))
    if "int8" in variants:
        make_int8(out, bool(export_cfg["int8_per_channel"]), list(export_cfg["int8_exclude_nodes"]))
    if "fp16" in variants:
        make_fp16(out, bool(export_cfg["fp16_keep_io_types"]))
    resorted = [v for v in variants if topo_sort(out / VARIANT_FILES[v])]
    checker = check_files(out, variants)

    max_per_word = int(labels_json["window"]["max_subwords_per_word"])
    ref = reference_windows(tokenizer, reference_sentences, max_per_word)
    ref_torch = torch_argmax(checkpoint, ref, space)
    dev_torch = torch_argmax(checkpoint, dev, space)

    report: dict[str, Any] = {
        "checkpoint": str(checkpoint),
        "checker": checker,
        "resorted": resorted,
        "variants": {},
    }
    report_margin = float(export_cfg.get("report_margin", 0.1))
    for v in variants:
        path = out / VARIANT_FILES[v]
        ref_ort, width = ort_argmax(path, ref, space)
        dev_ort, _ = ort_argmax(path, dev, space)
        report["variants"][v] = {
            "file": VARIANT_FILES[v],
            "bytes": path.stat().st_size,
            "logits_width": width,
            "logits_width_ok": width == len(labels_json["labels"]),
            "reference_agreement": agreement(ref_torch, ref_ort),
            "dev_agreement": agreement(dev_torch, dev_ort),
            "dev_confident_agreement": agreement(dev_torch, dev_ort, report_margin),
            "dev_windows": len(dev),
        }

    (out / "reference.json").write_text(
        json.dumps(
            {
                "max_subwords_per_word": max_per_word,
                "sentences": [
                    {
                        **r,
                        "torch_chunk_ids": pa,
                        "torch_dep_ids": pb,
                        "torch_chunk_margin": ma,
                        "torch_dep_margin": mb,
                    }
                    for r, (pa, pb, ma, mb) in zip(ref, ref_torch, strict=True)
                ],
            },
            indent=1,
        )
        + "\n"
    )
    with (out / "parity_inputs.jsonl").open("w") as f:
        for w, (pa, pb, ma, mb) in zip(dev, dev_torch, strict=True):
            row = {**w, "torch_chunk_ids": pa, "torch_dep_ids": pb}
            f.write(json.dumps(row | {"torch_chunk_margin": ma, "torch_dep_margin": mb}) + "\n")

    shipped = sorted(
        p
        for p in out.rglob("*")
        if p.is_file()
        and p.name not in NOT_SHIPPED
        and (
            p.parent == out
            or p.relative_to(out).as_posix() in {VARIANT_FILES[v] for v in SHIPPED_VARIANTS}
        )
    )
    labels_json["files"] = {
        p.relative_to(out).as_posix(): {"bytes": p.stat().st_size, "sha256": sha256(p)}
        for p in shipped
    }
    problems = validate_labels_json(labels_json)
    if problems:
        raise RuntimeError(f"labels.json invalid after export: {problems}")
    (out / "labels.json").write_text(json.dumps(labels_json, indent=2, ensure_ascii=False) + "\n")

    report["shipped_files"] = labels_json["files"]
    report["seconds"] = round(time.perf_counter() - started, 1)
    (out / "export_report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    """Export one run of one candidate."""
    parser = argparse.ArgumentParser(description="ONNX export (Phase 7 smoke test, Phase 9).")
    parser.add_argument("--model", required=True, help="key of configs/train_<key>.yaml")
    parser.add_argument("--run", required=True, help="run name under data/checkpoints/<model>/")
    parser.add_argument(
        "--parity-windows", default=None, help="dev windows for parity (int or 'all')"
    )
    args = parser.parse_args()

    from datasets import load_from_disk

    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    eval_cfg = yaml.safe_load((CONFIG_DIR / "eval.yaml").read_text())
    checkpoint = TRAINING_DIR / data_cfg["paths"]["checkpoints"] / args.model / args.run / "best"
    out = TRAINING_DIR / data_cfg["paths"]["onnx"] / args.model / args.run
    if args.parity_windows == "all":
        n: int | None = None
    else:
        n = (
            int(args.parity_windows)
            if args.parity_windows
            else int(eval_cfg["smoke"]["dev_windows"])
        )
    dev_ds = load_from_disk(str(TRAINING_DIR / data_cfg["paths"]["dataset"] / args.model))["dev"]
    report = export(
        checkpoint,
        out,
        eval_cfg["export"],
        eval_cfg["smoke"]["reference_sentences"],
        dev_windows(dev_ds, n),
    )
    for v, r in report["variants"].items():
        print(
            f"{args.model}/{args.run} {v}: {r['bytes'] / 1e6:.1f} MB, "
            f"checker {report['checker'][v]}, "
            f"dev agreement A {r['dev_agreement']['chunk']:.4f} / B {r['dev_agreement']['dep']:.4f}"
        )
    print(f"-> {out}")


if __name__ == "__main__":
    main()
