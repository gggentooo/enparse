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
    5. Error analysis: sample 100 test errors, group by type (noun/verb
       homographs, PP chunks, coordination, PP attachment, ...) per
       candidate into reports/errors.md.
    6. Write results to data/eval/<model>/<run>/ (metrics JSON, per-sentence
       predictions JSONL with group B top-k candidates for js/nested_eval.mjs);
       scripts/run_phase7.py builds reports/training.md from them.

Dependencies:
    Python: torch, transformers, datasets, onnxruntime, seqeval, evaluate,
            numpy, pandas, pyyaml.
    Reads:  configs/eval.yaml (parity, acceptance);
            configs/train_<model>.yaml; configs/data.yaml;
            data/processed/dataset/<model>/; data/checkpoints/<model>/;
            data/onnx/<model>/;
            js/benchmark.mjs output (Transformers.js predictions for parity).
    Writes: reports/training.md, reports/errors.md, reports/parity.md.
    Shares metric code with: scripts/train.py (compute_metrics). Nested-phrase
    F1 runs src/modules/parser/treeDecoder.ts via tsx (js/).

Usage (from training/):
    python scripts/evaluate.py --model <m> --run <run> --split test

Status: test mode implemented (Phase 7). TODO(phase9-parity): parity mode
    (js_predictions_<variant>.jsonl vs fp32: chunk F1 / LAS drops).
    TODO(error-analysis): sample and group 100 test errors (task 5).
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

from metrics import LabelSpace, WindowPrediction, first_subword_positions, score
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

    labels_json = json.loads((checkpoint / "labels.json").read_text())
    space = LabelSpace.from_labels_json(labels_json)
    model = AutoModelForTokenClassification.from_pretrained(
        str(checkpoint), local_files_only=True
    ).to(device)
    tokenizer = AutoTokenizer.from_pretrained(str(checkpoint), local_files_only=True)
    pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else 0
    started = time.perf_counter()
    preds, cands = predict_with_candidates(model, rows, space, 32, device, top_k, pad)
    metrics = score(rows, preds, space)
    metrics["seconds"] = round(time.perf_counter() - started, 1)
    metrics["checkpoint"] = str(checkpoint)
    metrics["split"] = split
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{split}_metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    with (out_dir / f"{split}_predictions.jsonl").open("w") as f:
        for rec in sentence_records(rows, preds, cands, space):
            f.write(json.dumps(rec) + "\n")
    return metrics


def main() -> None:
    """Evaluate one run's best checkpoint on a split (Phase 7 test mode)."""
    parser = argparse.ArgumentParser(description="Phase 7 evaluation.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--split", default="test", choices=["dev", "test"])
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    from datasets import load_from_disk

    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    eval_cfg = yaml.safe_load((CONFIG_DIR / "eval.yaml").read_text())
    checkpoint = TRAINING_DIR / data_cfg["paths"]["checkpoints"] / args.model / args.run / "best"
    ds = load_from_disk(str(TRAINING_DIR / data_cfg["paths"]["dataset"] / args.model))[args.split]
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
