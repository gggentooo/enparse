"""
training/scripts/evaluate.py — metrics, parity checks, and error analysis

Description:
    Shared evaluation for PyTorch checkpoints and ONNX exports of every
    candidate model: UPOS accuracy, chunk F1 (overall and per type), UAS/LAS
    and nested-phrase F1, ONNX parity, and error sampling. Single place where
    model metrics are computed.

Phases: 7 (dev metrics, final test evaluation per candidate, error
        analysis), 9 (ONNX parity per candidate), 12 (retrain regression checks).

Tasks:
    1. Metrics: UPOS accuracy; chunk precision/recall/F1 via seqeval,
       overall and per type (NP, VP, PP, ADJP, ADVP). Combined labels are
       split into UPOS and chunk; probabilities summed per part.
    2. Backends: PyTorch checkpoint, or ONNX file via onnxruntime.
    3. Parity mode: fp32 ONNX vs PyTorch label agreement (>= 99.9% on dev);
       int8/fp16 chunk F1 drop vs fp32 (<= 0.3 points).
    4. Test mode (Phase 7, run once per candidate): evaluate on test, compare
       with reports/baselines.md and the acceptance thresholds; record which
       candidates qualify for the model library (flat view) and the nested
       view (UAS/LAS).
    5. Error analysis: done in js/error_analysis.mjs (it needs the app's
       treeDecoder.ts to decode trees) from the predictions written here;
       writes reports/errors.md.
    6. Write results to data/eval/<model>/<run>/ (metrics JSON, per-sentence
       predictions JSONL with group B top-k candidates for js/nested_eval.mjs);
       scripts/run_phase7.py builds reports/training.md from them.
    7. Biaffine checkpoints (T51): data from dataset_arc/; each sentence record
       has `arc_scores` (word-level head log-probabilities: row i = word i,
       column 0 = root, column j = word j; softmax over the sentence plus root)
       and `rel_candidates` (top-k relations per word); treeDecoder.ts decodes
       them with MST (js/nested_eval.mjs). Raw UAS/LAS use argmax heads.

Dependencies:
    Python: torch, transformers, datasets, onnxruntime, seqeval, evaluate,
            numpy, pandas, pyyaml.
    Reads:  configs/eval.yaml (parity, acceptance);
            configs/train_<model>.yaml; configs/data.yaml;
            data/processed/dataset/<model>/; data/checkpoints/<model>/;
            data/onnx/<model>/;
            js/benchmark.mjs output (Transformers.js predictions for parity).
    Writes: data/eval/<model>/<run>/ (scripts/run_phase7.py writes
            reports/training.md; js/error_analysis.mjs reports/errors.md),
            reports/parity.md.
    Shares metric code with: scripts/train.py (compute_metrics). Nested-phrase
    F1 runs src/modules/parser/treeDecoder.ts via tsx (js/).

Usage (from training/):
    python scripts/evaluate.py --model <m> --run <run> --split test

    python scripts/evaluate.py --parity                 # Phase 9, offered models
    python scripts/evaluate.py --parity --model <m> --run <run>

Parity mode (Phase 9): needs export_onnx.py --parity-windows all and
    js/benchmark.mjs --mode parity first. Scores PyTorch (parity_inputs.jsonl)
    and each Transformers.js variant (js_predictions_<variant>.jsonl) on the
    same dev windows; checks fp32 agreement and int8/fp16 chunk F1 / LAS drops
    (configs/eval.yaml → parity); writes parity.json and the word-encoding
    strategy (labels.json → tokenizer_word_encoding) into the export folder,
    and reports/parity.md.

Status: test mode (Phase 7) and parity mode (Phase 9) implemented.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import torch
import yaml

from metrics import (
    LabelSpace,
    WindowPrediction,
    biaffine_words,
    first_subword_positions,
    score,
)
from prepare_data import base_relation
from train import Collator, pick_device

if TYPE_CHECKING:
    from transformers import PreTrainedModel

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"


def predict_with_candidates(
    model: PreTrainedModel,
    rows: list[dict[str, Any]],
    space: LabelSpace,
    batch_size: int,
    device: torch.device,
    top_k: int,
    pad_id: int,
) -> tuple[list[WindowPrediction], list[list[list[tuple[int, float]]]]]:
    """Argmax per word (both groups) and the top-k group B candidates with probabilities."""
    collator = Collator(pad_id)
    preds: list[WindowPrediction] = []
    cands: list[list[list[tuple[int, float]]]] = []
    model.eval()
    with torch.no_grad():
        for start in range(0, len(rows), batch_size):
            batch_rows = rows[start : start + batch_size]
            batch = collator(batch_rows)
            logits = model(
                input_ids=batch["input_ids"].to(device),
                attention_mask=batch["attention_mask"].to(device),
            ).logits.float()
            dep_probs = torch.softmax(logits[..., space.dep_start : space.dep_end], dim=-1)
            top_p, top_i = dep_probs.topk(min(top_k, space.n_dep), dim=-1)
            logits_np = logits.cpu().numpy()
            top_p, top_i = top_p.cpu().numpy(), top_i.cpu().numpy()
            for k, row in enumerate(batch_rows):
                firsts = first_subword_positions(row["token_word"])
                n = len(row["words"])
                a = logits_np[k, :, space.chunk_start : space.chunk_end].argmax(-1)
                pa = [int(a[firsts[w]]) if w in firsts else -1 for w in range(n)]
                pb = [int(top_i[k, firsts[w], 0]) if w in firsts else -1 for w in range(n)]
                preds.append(WindowPrediction(pa, pb))
                cands.append(
                    [
                        [
                            (int(i), float(p))
                            for i, p in zip(top_i[k, firsts[w]], top_p[k, firsts[w]], strict=True)
                        ]
                        if w in firsts
                        else []
                        for w in range(n)
                    ]
                )
    return preds, cands


def predict_biaffine(
    model: PreTrainedModel,
    rows: list[dict[str, Any]],
    space: LabelSpace,
    batch_size: int,
    device: torch.device,
    top_k: int,
    pad_id: int,
) -> tuple[list[WindowPrediction], list[list[dict[str, Any]]]]:
    """Argmax predictions per word and, per fully labeled sentence, arc log-probs and the top-k
    relations (sentence records without the gold fields)."""
    from biaffine import sentence_arc_logprobs

    collator = Collator(pad_id)
    preds: list[WindowPrediction] = []
    extras: list[list[dict[str, Any]]] = []
    model.eval()
    with torch.no_grad():
        for start in range(0, len(rows), batch_size):
            batch_rows = rows[start : start + batch_size]
            batch = collator(batch_rows)
            out = model(
                input_ids=batch["input_ids"].to(device),
                attention_mask=batch["attention_mask"].to(device),
            )
            logits = out.logits.float()
            rel_p = torch.softmax(logits[..., space.dep_start : space.dep_end], dim=-1)
            top_p, top_i = rel_p.topk(min(top_k, space.n_dep), dim=-1)
            logits_np, arc_np = logits.cpu().numpy(), out.arc_scores.float().cpu().numpy()
            top_p, top_i = top_p.cpu().numpy(), top_i.cpu().numpy()
            for k, row in enumerate(batch_rows):
                n_tok = len(row["input_ids"])
                arc = arc_np[k, :n_tok, :n_tok]
                preds.append(
                    biaffine_words(
                        logits_np[k, :n_tok], arc, row["token_word"], row["word_sent"], space
                    )
                )
                firsts = first_subword_positions(row["token_word"])
                by_sent: dict[int, list[int]] = {}
                for w, s in enumerate(row["word_sent"]):
                    by_sent.setdefault(s, []).append(w)
                per_sent = []
                for s, words in by_sent.items():
                    if any(w not in firsts for w in words):
                        per_sent.append({"sent": s, "skip": True})
                        continue
                    per_sent.append(
                        {
                            "sent": s,
                            "arc_scores": sentence_arc_logprobs(arc, row["token_word"], words),
                            "rel_candidates": [
                                [
                                    {
                                        "relation": space.dep_label(int(i)),
                                        "prob": round(float(p), 5),
                                    }
                                    for i, p in zip(
                                        top_i[k, firsts[w]], top_p[k, firsts[w]], strict=True
                                    )
                                ]
                                for w in words
                            ],
                        }
                    )
                extras.append(per_sent)
    return preds, extras


def sentence_records_biaffine(
    rows: list[dict[str, Any]],
    preds: list[WindowPrediction],
    extras: list[list[dict[str, Any]]],
    space: LabelSpace,
) -> list[dict[str, Any]]:
    """One record per fully labeled sentence: gold, predictions, arc log-probs, relations."""
    out = []
    for row, pred, per_sent in zip(rows, preds, extras, strict=True):
        by_sent: dict[int, list[int]] = {}
        for w, s in enumerate(row["word_sent"]):
            by_sent.setdefault(s, []).append(w)
        extra = {e["sent"]: e for e in per_sent}
        for s, words in by_sent.items():
            if any(row["word_context"][w] or not row["word_reviewed"][w] for w in words):
                continue
            if extra[s].get("skip"):
                continue
            pairs = [
                space.chunk_label(pred.chunk_ids[w]) if pred.chunk_ids[w] >= 0 else ("X", "O")
                for w in words
            ]
            out.append(
                {
                    "sent_id": row["sent_ids"][s],
                    "words": [row["words"][w] for w in words],
                    "gold_upos": [row["gold_upos"][w] for w in words],
                    "gold_chunk": [row["gold_chunk"][w] for w in words],
                    "gold_head": [row["gold_head"][w] for w in words],
                    "gold_rel": [base_relation(row["gold_deprel"][w]) for w in words],
                    "gold_deprel": [row["gold_deprel"][w] for w in words],
                    "pred_upos": [p[0] for p in pairs],
                    "pred_chunk": [p[1] for p in pairs],
                    "arc_scores": extra[s]["arc_scores"],
                    "rel_candidates": extra[s]["rel_candidates"],
                }
            )
    return out


def sentence_records(
    rows: list[dict[str, Any]],
    preds: list[WindowPrediction],
    cands: list[list[list[tuple[int, float]]]],
    space: LabelSpace,
) -> list[dict[str, Any]]:
    """One record per fully labeled sentence: gold and predicted fields, group B candidates."""
    out = []
    for row, pred, cand in zip(rows, preds, cands, strict=True):
        by_sent: dict[int, list[int]] = {}
        for w, s in enumerate(row["word_sent"]):
            by_sent.setdefault(s, []).append(w)
        for s, words in by_sent.items():
            if any(row["word_context"][w] or not row["word_reviewed"][w] for w in words):
                continue
            pairs = [
                space.chunk_label(pred.chunk_ids[w]) if pred.chunk_ids[w] >= 0 else ("X", "O")
                for w in words
            ]
            out.append(
                {
                    "sent_id": row["sent_ids"][s],
                    "words": [row["words"][w] for w in words],
                    "gold_upos": [row["gold_upos"][w] for w in words],
                    "gold_chunk": [row["gold_chunk"][w] for w in words],
                    "gold_head": [row["gold_head"][w] for w in words],
                    "gold_rel": [base_relation(row["gold_deprel"][w]) for w in words],
                    "pred_upos": [p[0] for p in pairs],
                    "pred_chunk": [p[1] for p in pairs],
                    "dep_candidates": [
                        [{"label": space.dep_label(i), "prob": round(p, 5)} for i, p in cand[w]]
                        for w in words
                    ],
                }
            )
    return out


def evaluate_split(
    checkpoint: Path,
    rows: list[dict[str, Any]],
    out_dir: Path,
    split: str,
    top_k: int,
    device: torch.device,
) -> dict[str, Any]:
    """Metrics (raw argmax) and per-sentence predictions for one split; written to out_dir."""
    from transformers import AutoModelForTokenClassification, AutoTokenizer

    from biaffine import is_biaffine, load_biaffine

    labels_json = json.loads((checkpoint / "labels.json").read_text())
    space = LabelSpace.from_labels_json(labels_json)
    biaffine = is_biaffine(str(checkpoint))
    model = (
        load_biaffine(str(checkpoint), local_files_only=True)
        if biaffine
        else AutoModelForTokenClassification.from_pretrained(str(checkpoint), local_files_only=True)
    ).to(device)
    tokenizer = AutoTokenizer.from_pretrained(str(checkpoint), local_files_only=True)
    pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else 0
    started = time.perf_counter()
    if biaffine:
        preds, extras = predict_biaffine(model, rows, space, 32, device, top_k, pad)
        records = sentence_records_biaffine(rows, preds, extras, space)
    else:
        preds, cands = predict_with_candidates(model, rows, space, 32, device, top_k, pad)
        records = sentence_records(rows, preds, cands, space)
    metrics = score(rows, preds, space)
    metrics["seconds"] = round(time.perf_counter() - started, 1)
    metrics["checkpoint"] = str(checkpoint)
    metrics["split"] = split
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{split}_metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    with (out_dir / f"{split}_predictions.jsonl").open("w") as f:
        for rec in records:
            f.write(json.dumps(rec) + "\n")
    return metrics


# -- Phase 9 parity --------------------------------------------------------------------------

PARITY_REPORT = TRAINING_DIR / "reports" / "parity.md"
PARITY_VARIANTS = ("fp32", "int8", "fp16")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _window_preds(rows: list[dict[str, Any]], prefix: str) -> list[WindowPrediction]:
    """WindowPrediction per window from parity_inputs.jsonl (prefix torch_) or js_predictions."""
    return [
        WindowPrediction(
            list(r[f"{prefix}chunk_ids"]), list(r[f"{prefix}dep_ids"]), r.get(f"{prefix}heads")
        )
        for r in rows
    ]


def parity_check(
    metrics: dict[str, dict[str, float]],
    agreement: dict[str, dict[str, float]],
    width_ok: dict[str, bool],
    limits: dict[str, Any],
) -> dict[str, list[str]]:
    """Problems per variant: fp32 agreement vs PyTorch; int8/fp16 chunk F1 and LAS drops vs fp32."""
    problems: dict[str, list[str]] = {v: [] for v in metrics if v != "torch"}
    fp32_min = float(limits["fp32_min_agreement"])
    max_drop = float(limits["max_f1_drop_points"])
    for v in problems:
        if not width_ok.get(v, False):
            problems[v].append("output shape differs from labels.json")
    for g, a in agreement.get("fp32", {}).items():
        if a < fp32_min:
            problems["fp32"].append(f"agreement {g} {a:.4f} < {fp32_min}")
    for v in problems:
        if v == "fp32":
            continue
        if problems["fp32"]:
            problems[v].append("fp32 failed parity")
        for k in ("chunk_f1", "las"):
            drop = 100 * (metrics["fp32"][k] - metrics[v][k])
            if drop > max_drop:
                problems[v].append(f"{k} drop {drop:.2f} points > {max_drop}")
    return problems


def offered_runs(data_cfg: dict[str, Any], eval_cfg: dict[str, Any]) -> list[tuple[str, str]]:
    """(model, selected run) of each offered model of the biaffine stage (calibrate.py's rule)."""
    from calibrate import offered

    stage = eval_cfg["phase7_stages"]["biaffine"]
    out = []
    for m in eval_cfg["phase7"]["models"]:
        path = TRAINING_DIR / data_cfg["paths"]["eval"] / m / stage["record"]
        if not path.exists():
            continue
        rec = json.loads(path.read_text())
        run = rec.get("selected_run")
        test = (rec.get("seeds", {}).get(run) or {}).get("test") if run else None
        if test and offered(test, eval_cfg):
            out.append((m, run))
    return out


def run_parity(
    model_key: str, run: str, data_cfg: dict[str, Any], eval_cfg: dict[str, Any]
) -> dict[str, Any]:
    """Score PyTorch and every Transformers.js variant on the parity windows; write parity.json."""
    from datasets import load_from_disk

    from biaffine import is_biaffine

    out = TRAINING_DIR / data_cfg["paths"]["onnx"] / model_key / run
    checkpoint = TRAINING_DIR / data_cfg["paths"]["checkpoints"] / model_key / run / "best"
    labels_path = out / "labels.json"
    labels_json = json.loads(labels_path.read_text())
    space = LabelSpace.from_labels_json(labels_json)
    key = "dataset_arc" if is_biaffine(str(checkpoint)) else "dataset"
    ds = load_from_disk(str(TRAINING_DIR / data_cfg["paths"][key] / model_key))["dev"]
    inputs = _read_jsonl(out / "parity_inputs.jsonl")
    rows = [ds[i] for i in range(len(inputs))]
    for r, w in zip(rows, inputs, strict=True):
        if r["input_ids"] != w["input_ids"]:
            raise RuntimeError("parity_inputs.jsonl does not match the dev windows")
    bench = json.loads((out / "benchmark_parity.json").read_text())
    export_report = json.loads((out / "export_report.json").read_text())

    metrics = {"torch": score(rows, _window_preds(inputs, "torch_"), space)}
    agreement: dict[str, dict[str, float]] = {}
    dev_agreement: dict[str, dict[str, float]] = {}
    width_ok: dict[str, bool] = {}
    for v in bench["variants"]:
        name = v["variant"]
        metrics[name] = score(
            rows, _window_preds(_read_jsonl(out / f"js_predictions_{name}.jsonl"), ""), space
        )
        groups = [g for g in ("chunk", "dep", "arc") if g in v["parity_agreement"]]
        # fp32 check: dev windows and reference sentences; the report shows dev windows.
        agreement[name] = {
            g: min(v["parity_agreement"][g], v["reference_agreement"][g]) for g in groups
        }
        dev_agreement[name] = {g: v["parity_agreement"][g] for g in groups}
        width_ok[name] = bool(v["logits_width_ok"])
    problems = parity_check(metrics, agreement, width_ok, eval_cfg["parity"])
    strategy = bench["tokenizer"]["strategy"]
    if strategy is None:
        for v in problems:
            problems[v].append("no word-encoding strategy reproduces Python's token ids")
    shipped = [v for v in ("int8", "fp16") if v in problems and not problems[v]]
    labels_json["tokenizer_word_encoding"] = strategy
    labels_path.write_text(json.dumps(labels_json, indent=2, ensure_ascii=False) + "\n")
    result = {
        "model": model_key,
        "run": run,
        "dev_windows": len(inputs),
        "tokenizer_word_encoding": strategy,
        "metrics": {
            k: {m: v[m] for m in ("upos_acc", "chunk_f1", "uas", "las")} for k, v in metrics.items()
        },
        "js_agreement": dev_agreement,
        "js_check_agreement": agreement,
        "tokenizer_check": {k: bench["tokenizer"].get(k) for k in ("cases", "matches")},
        "ort_agreement": {v: r["dev_agreement"] for v, r in export_report["variants"].items()},
        "bytes": {v: r["bytes"] for v, r in export_report["variants"].items()},
        "problems": problems,
        "shipped_variants": shipped,
    }
    (out / "parity.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def render_parity(results: list[dict[str, Any]], eval_cfg: dict[str, Any]) -> str:
    """reports/parity.md."""
    lim = eval_cfg["parity"]
    L = [
        "# Parity report (Phase 9)",
        "",
        "Generated by `scripts/evaluate.py --parity` from `js/benchmark.mjs --mode parity` "
        "(Transformers.js 4.3.2 in Node, CPU) on every dev window, against PyTorch. Pass: fp32 "
        f"agrees with PyTorch on ≥ {100 * lim['fp32_min_agreement']:.1f}% of words per output "
        "(group A, relation, head; dev windows and reference sentences), and int8 / fp16 lose at "
        f"most {lim['max_f1_drop_points']} points of chunk F1 and LAS vs fp32 (raw argmax heads). "
        "A variant that fails is not shipped.",
        "",
        "| Model | Variant | Size (MB) | Dev agreement A / rel / head (JS) | UPOS | Chunk F1 | UAS "
        "| LAS "
        "| Δ chunk F1 | Δ LAS | Result |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        m = r["metrics"]
        L.append(
            f"| {r['model']} | PyTorch | — | — | {100 * m['torch']['upos_acc']:.2f} | "
            f"{100 * m['torch']['chunk_f1']:.2f} | {100 * m['torch']['uas']:.2f} | "
            f"{100 * m['torch']['las']:.2f} | — | — | reference |"
        )
        for v in PARITY_VARIANTS:
            if v not in m:
                continue
            a = r["js_agreement"][v]
            agr = " / ".join(f"{100 * a[g]:.2f}" for g in ("chunk", "dep", "arc") if g in a)
            d_f1 = (
                "—" if v == "fp32" else f"{100 * (m['fp32']['chunk_f1'] - m[v]['chunk_f1']):+.2f}"
            )
            d_las = "—" if v == "fp32" else f"{100 * (m['fp32']['las'] - m[v]['las']):+.2f}"
            probs = r["problems"][v]
            verdict = "pass" if not probs else "**fail**: " + "; ".join(probs)
            if v in ("int8", "fp16") and not probs:
                verdict = "pass (shipped)"
            L.append(
                f"| {r['model']} | {v} | {r['bytes'][v] / 1e6:.1f} | {agr} | "
                f"{100 * m[v]['upos_acc']:.2f} | {100 * m[v]['chunk_f1']:.2f} | "
                f"{100 * m[v]['uas']:.2f} | {100 * m[v]['las']:.2f} | {d_f1} | {d_las} | "
                f"{verdict} |"
            )
    L += ["", "Δ = fp32 − variant (points; positive = the variant is worse).", ""]
    L += [
        "Word encoding: the Transformers.js strategy that reproduces Python's token ids on "
        "every case (3 reference sentences + all dev windows); written to labels.json → "
        "tokenizer_word_encoding.",
        "",
        "| Model | Run | Dev windows | Word encoding | Cases matched (plain / space) | "
        "Shipped variants |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        tc = r["tokenizer_check"]
        L.append(
            f"| {r['model']} | `{r['run']}` | {r['dev_windows']} | "
            f"{r['tokenizer_word_encoding'] or '**none**'} | "
            f"{tc['matches'].get('plain', 0)} / {tc['matches'].get('space', 0)} of {tc['cases']} | "
            f"{', '.join(r['shipped_variants']) or '**none**'} |"
        )
    L.append("")
    return "\n".join(L)


def main() -> None:
    """Evaluate one run on a split (Phase 7 test mode), or ONNX parity (Phase 9, --parity)."""
    parser = argparse.ArgumentParser(description="Phase 7 evaluation; Phase 9 parity.")
    parser.add_argument("--model")
    parser.add_argument("--run")
    parser.add_argument("--split", default="test", choices=["dev", "test"])
    parser.add_argument("--device", default="auto")
    parser.add_argument(
        "--parity",
        action="store_true",
        help="Phase 9: parity of the exports (default: offered models of the biaffine stage)",
    )
    args = parser.parse_args()

    from datasets import load_from_disk

    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    eval_cfg = yaml.safe_load((CONFIG_DIR / "eval.yaml").read_text())
    from biaffine import is_biaffine

    if args.parity:
        targets = (
            [(args.model, args.run)]
            if args.model and args.run
            else offered_runs(data_cfg, eval_cfg)
        )
        results = [run_parity(m, r, data_cfg, eval_cfg) for m, r in targets]
        for r in results:
            print(
                f"{r['model']}/{r['run']}: shipped {r['shipped_variants']}, "
                f"problems {r['problems']}"
            )
        if not (args.model and args.run):
            PARITY_REPORT.write_text(render_parity(results, eval_cfg), encoding="utf-8")
            print(f"report -> {PARITY_REPORT.relative_to(TRAINING_DIR)}")
        return
    if not (args.model and args.run):
        parser.error("--model and --run are required (or use --parity)")

    checkpoint = TRAINING_DIR / data_cfg["paths"]["checkpoints"] / args.model / args.run / "best"
    key = "dataset_arc" if is_biaffine(str(checkpoint)) else "dataset"
    ds = load_from_disk(str(TRAINING_DIR / data_cfg["paths"][key] / args.model))[args.split]
    rows = [ds[i] for i in range(len(ds))]
    out_dir = TRAINING_DIR / data_cfg["paths"]["eval"] / args.model / args.run
    m = evaluate_split(
        checkpoint,
        rows,
        out_dir,
        args.split,
        int(eval_cfg["phase7"]["dep_top_k"]),
        pick_device(args.device),
    )
    print(
        f"{args.model}/{args.run} {args.split}: UPOS {m['upos_acc']:.4f}, "
        f"chunk F1 {m['chunk_f1']:.4f}, UAS {m['uas']:.4f}, LAS {m['las']:.4f} -> {out_dir}"
    )


if __name__ == "__main__":
    np.seterr(all="ignore")
    main()
