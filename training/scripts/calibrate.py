"""
training/scripts/calibrate.py — Phase 8 calibration, ambiguity margins, and bracket gating

Description:
    Makes the probabilities of a biaffine model (labels.json schema v2)
    reliable for runtime alternatives and confidence gating, per model
    (plan-training.md → Phase 8):
      1. Run the checkpoint on dev and test; collect per word the group A
         logits (UPOS|CHUNK), relation logits, and arc scores over the word's
         sentence plus root (first subword; scripts/biaffine.py).
      2. Fit one temperature per output on dev (minimize NLL of the gold
         label / relation / head): calibration.temperature, rel_temperature,
         arc_temperature. Report expected calibration error (ECE, top-1
         confidence) before and after, on dev and test.
      3. Ambiguity margins on dev (calibrated probabilities): a word is
         ambiguous if its top-two group A probabilities differ by less than
         `margin`; a PP-attachment word (gold obl/nmod with a case dependent)
         gets an attachment alternative if its top-two head probabilities
         differ by less than `attachment_margin`. Alternatives per sentence =
         min(cap, 2^k − 1) for k ambiguous words, plus attachment
         alternatives, capped at ambiguity.max_alternatives (5). Chosen pair:
         the most errors recovered (gold label or head shown as an
         alternative) with mean alternatives per sentence ≤
         ambiguity.max_mean_alternatives. (proposed rule)
      4. Bracket threshold: js/gating_eval.mjs decodes trees with the app's
         treeDecoder.ts (MST, calibrated head probabilities), builds and labels
         the phrases the app shows, and picks the lowest span-confidence
         threshold (T78) whose dev shown-bracket precision
         (labeled, multi-word) is ≥ acceptance.nested_view.min_shown_precision;
         reports test precision and coverage at that threshold.
      5. Write the values into the checkpoint's labels.json (export copies
         it), and reports/calibration.md (all models in the record).
    Margins must also be recorded per model in architecture.md (Phase 8 exit).

Phase: 8 — Calibration and ambiguity threshold (T58).

Usage (from training/):
    python scripts/calibrate.py                       # offered models of the biaffine stage
    python scripts/calibrate.py --models deberta_v3_xsmall [--device cpu]
    python scripts/calibrate.py --model m --run <run>   # one run (e.g. smoke_bf), no record

Dependencies:
    Python: torch, transformers, datasets, numpy, pyyaml; scripts/biaffine.py,
            scripts/metrics.py, scripts/train.py (Collator, pick_device),
            scripts/prepare_data.py (validate_labels_json).
    Node:   js/gating_eval.mjs (npx tsx; treeDecoder.ts).
    Reads:  configs/eval.yaml (calibration, ambiguity, gating, acceptance, baselines,
            phase7_stages.biaffine); configs/data.yaml (paths);
            data/eval/<model>/phase7_biaffine.json (selected_run, test metrics);
            data/checkpoints/<model>/<run>/best/; data/processed/dataset_arc/<model>/;
            data/eval/<model>/<run>/<split>_predictions.jsonl (for gating_eval.mjs).
    Writes: data/checkpoints/<model>/<run>/best/labels.json (calibration, ambiguity, nested);
            data/eval/<model>/<run>/calibration.json; reports/calibration.md.
    Related: src/modules/parser/transformerBackend.ts (temperatures), ambiguity.ts
             (margins), treeDecoder.ts (spanConfidence), phraseLabeler.ts (gateLabeled with
             nested.bracket_threshold; role gate with nested.role_threshold).

Status: implemented (T58; span-confidence gating T78).
"""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
import torch
import yaml

if TYPE_CHECKING:
    from metrics import LabelSpace

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
REPORT = TRAINING_DIR / "reports" / "calibration.md"
PP_RELATIONS = ("obl", "nmod")


# -- collection --------------------------------------------------------------------------


@dataclass
class Collected:
    """Per-word logits and gold labels of one split (only fully labeled sentences)."""

    a_logits: list[np.ndarray] = field(default_factory=list)  # [C_A] per word
    a_gold: list[int] = field(default_factory=list)
    r_logits: list[np.ndarray] = field(default_factory=list)  # [C_B] per word
    r_gold: list[int] = field(default_factory=list)
    arc_rows: list[np.ndarray] = field(default_factory=list)  # [n + 1] per word (col 0 = root)
    arc_gold: list[int] = field(default_factory=list)  # 0 = root, k = k-th word of the sentence
    arc_self: list[int] = field(default_factory=list)  # column of the word itself (excluded)
    pp_word: list[bool] = field(default_factory=list)  # gold obl/nmod with a case dependent
    sentence: list[int] = field(default_factory=list)  # sentence index per word


def collect(
    model: torch.nn.Module,
    rows: list[dict[str, Any]],
    space: LabelSpace,
    device: torch.device,
    pad_id: int,
    batch_size: int = 32,
) -> Collected:
    """Run the model and gather per-word logits for every fully labeled sentence."""
    from metrics import first_subword_positions
    from prepare_data import base_relation
    from train import Collator

    out = Collected()
    collator = Collator(pad_id)
    sent_counter = 0
    model.eval()
    with torch.no_grad():
        for start in range(0, len(rows), batch_size):
            batch_rows = rows[start : start + batch_size]
            batch = collator(batch_rows)
            res = model(
                input_ids=batch["input_ids"].to(device),
                attention_mask=batch["attention_mask"].to(device),
            )
            logits = res.logits.float().cpu().numpy()
            arcs = res.arc_scores.float().cpu().numpy()
            for k, row in enumerate(batch_rows):
                firsts = first_subword_positions(row["token_word"])
                by_sent: dict[int, list[int]] = {}
                for w, s in enumerate(row["word_sent"]):
                    by_sent.setdefault(s, []).append(w)
                for words in by_sent.values():
                    if any(
                        row["word_context"][w] or not row["word_reviewed"][w] or w not in firsts
                        for w in words
                    ):
                        continue
                    cols = [0] + [firsts[w] for w in words]
                    local = {row["word_index"][w]: i for i, w in enumerate(words)}
                    case_heads = {
                        row["gold_head"][w]
                        for w in words
                        if base_relation(row["gold_deprel"][w]) == "case"
                    }
                    for i, w in enumerate(words):
                        t = firsts[w]
                        a_id = row["labels_chunk"][t]
                        r_id = row["labels_rel"][t]
                        if a_id < 0 or r_id < 0 or row["labels_head"][t] < 0:
                            continue
                        out.a_logits.append(logits[k, t, space.chunk_start : space.chunk_end])
                        out.a_gold.append(int(a_id))
                        out.r_logits.append(logits[k, t, space.dep_start : space.dep_end])
                        out.r_gold.append(int(r_id))
                        out.arc_rows.append(arcs[k, t, cols])
                        gold = row["gold_head"][w]
                        out.arc_gold.append(0 if gold == 0 else local[gold - 1] + 1)
                        out.arc_self.append(i + 1)
                        rel = base_relation(row["gold_deprel"][w])
                        out.pp_word.append(
                            rel in PP_RELATIONS and (row["word_index"][w] + 1) in case_heads
                        )
                        out.sentence.append(sent_counter)
                    sent_counter += 1
    return out


# -- temperatures and ECE ----------------------------------------------------------------


def _log_softmax_rows(
    rows: list[np.ndarray], t: float, exclude: list[int] | None
) -> list[np.ndarray]:
    out = []
    for i, r in enumerate(rows):
        x = r.astype(np.float64) / t
        if exclude is not None:
            x = x.copy()
            x[exclude[i]] = -np.inf
        m = x[np.isfinite(x)].max()
        out.append(x - m - np.log(np.exp(x - m).sum()))
    return out


def nll(
    rows: list[np.ndarray], gold: list[int], t: float, exclude: list[int] | None = None
) -> float:
    """Mean negative log-likelihood of the gold class at temperature t."""
    lp = _log_softmax_rows(rows, t, exclude)
    return float(-np.mean([p[g] for p, g in zip(lp, gold, strict=True)]))


def fit_temperature(
    rows: list[np.ndarray], gold: list[int], exclude: list[int] | None, lo: float, hi: float
) -> float:
    """Temperature minimizing dev NLL (golden-section search on log t)."""
    a, b = np.log(lo), np.log(hi)
    g = (np.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = nll(rows, gold, np.exp(c), exclude), nll(rows, gold, np.exp(d), exclude)
    for _ in range(40):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = nll(rows, gold, np.exp(c), exclude)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = nll(rows, gold, np.exp(d), exclude)
    return round(float(np.exp((a + b) / 2)), 4)


def ece(
    rows: list[np.ndarray], gold: list[int], t: float, bins: int, exclude: list[int] | None = None
) -> float:
    """Expected calibration error of the top-1 prediction (equal-width confidence bins)."""
    lp = _log_softmax_rows(rows, t, exclude)
    conf = np.array([np.exp(p.max()) for p in lp])
    correct = np.array([int(p.argmax() == g) for p, g in zip(lp, gold, strict=True)])
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return round(float(total), 5)


# -- ambiguity margins -------------------------------------------------------------------


def _top2(lp: np.ndarray) -> tuple[int, int, float]:
    order = np.argsort(lp)[::-1]
    p = np.exp(lp[order[:2]])
    return int(order[0]), int(order[1]), float(p[0] - p[1])


def margin_table(
    dev: Collected,
    t_a: float,
    t_arc: float,
    margins: list[float],
    attachment_margins: list[float],
    cap: int,
) -> list[dict[str, float]]:
    """Errors recovered and mean alternatives per sentence for every margin pair (dev)."""
    a_lp = _log_softmax_rows(dev.a_logits, t_a, None)
    arc_lp = _log_softmax_rows(dev.arc_rows, t_arc, dev.arc_self)
    a_top = [_top2(p) for p in a_lp]
    arc_top = [_top2(p) for p in arc_lp]
    n_sent = max(dev.sentence) + 1 if dev.sentence else 1
    a_errors = sum(int(top[0] != g) for top, g in zip(a_top, dev.a_gold, strict=True))
    pp_errors = sum(
        int(top[0] != g)
        for top, g, pp in zip(arc_top, dev.arc_gold, dev.pp_word, strict=True)
        if pp
    )
    table = []
    for m in margins:
        amb = [top[2] < m for top in a_top]
        rec_a = sum(
            int(x and top[0] != g and top[1] == g)
            for x, top, g in zip(amb, a_top, dev.a_gold, strict=True)
        )
        k_per_sent = np.bincount(
            np.array(dev.sentence)[np.array(amb, dtype=bool)], minlength=n_sent
        )
        label_alts = np.minimum(cap, 2 ** np.minimum(k_per_sent, 16) - 1)
        for am in attachment_margins:
            att = [pp and top[2] < am for pp, top in zip(dev.pp_word, arc_top, strict=True)]
            rec_pp = sum(
                int(x and top[0] != g and top[1] == g)
                for x, top, g in zip(att, arc_top, dev.arc_gold, strict=True)
            )
            att_per_sent = np.bincount(
                np.array(dev.sentence)[np.array(att, dtype=bool)], minlength=n_sent
            )
            alts = np.minimum(cap, label_alts + att_per_sent)
            table.append(
                {
                    "margin": m,
                    "attachment_margin": am,
                    "label_errors_recovered": rec_a / max(1, a_errors),
                    "pp_errors_recovered": rec_pp / max(1, pp_errors),
                    "errors_recovered": (rec_a + rec_pp) / max(1, a_errors + pp_errors),
                    "mean_alternatives": float(alts.mean()),
                    "sentences_with_alternatives": float((alts > 0).mean()),
                }
            )
    return table


def choose_margins(table: list[dict[str, float]], max_mean: float) -> dict[str, float]:
    """Most errors recovered with mean alternatives per sentence ≤ max_mean (ties: smaller)."""
    ok = [r for r in table if r["mean_alternatives"] <= max_mean]
    if not ok:
        return min(table, key=lambda r: (r["mean_alternatives"], r["margin"]))
    return max(ok, key=lambda r: (r["errors_recovered"], -r["margin"], -r["attachment_margin"]))


# -- per model ---------------------------------------------------------------------------


def calibrate_run(
    model_key: str,
    run: str,
    cfg: dict[str, Any],
    data_cfg: dict[str, Any],
    device: torch.device,
    smoke: bool = False,
) -> dict[str, Any]:
    """Temperatures, margins, and gating for one run; writes labels.json and calibration.json."""
    from datasets import load_from_disk
    from transformers import AutoTokenizer

    from biaffine import load_biaffine
    from metrics import LabelSpace
    from prepare_data import validate_labels_json

    ckpt = TRAINING_DIR / data_cfg["paths"]["checkpoints"] / model_key / run / "best"
    labels_path = ckpt / "labels.json"
    labels_json = json.loads(labels_path.read_text())
    space = LabelSpace.from_labels_json(labels_json)
    model = load_biaffine(str(ckpt), local_files_only=True).to(device)
    tok = AutoTokenizer.from_pretrained(str(ckpt), local_files_only=True)
    pad = tok.pad_token_id if tok.pad_token_id is not None else 0
    ds = load_from_disk(str(TRAINING_DIR / data_cfg["paths"]["dataset_arc"] / model_key))
    splits = {}
    for split in ("dev", "test"):
        rows = [ds[split][i] for i in range(len(ds[split]))]
        if smoke:
            rows = rows[: int(cfg["smoke"]["dev_windows"])]
        splits[split] = collect(model, rows, space, device, pad)
    del model

    c = cfg["calibration"]
    lo, hi, bins = float(c["t_min"]), float(c["t_max"]), int(c["ece_bins"])
    dev, test = splits["dev"], splits["test"]
    groups = {
        "chunk": ("a_logits", "a_gold", None),
        "rel": ("r_logits", "r_gold", None),
        "arc": ("arc_rows", "arc_gold", "arc_self"),
    }
    temps: dict[str, float] = {}
    ece_rows: dict[str, dict[str, float]] = {}
    for g, (rk, gk, ek) in groups.items():
        ex_dev = getattr(dev, ek) if ek else None
        temps[g] = fit_temperature(getattr(dev, rk), getattr(dev, gk), ex_dev, lo, hi)
        ece_rows[g] = {}
        for name, data in (("dev", dev), ("test", test)):
            ex = getattr(data, ek) if ek else None
            rows_, gold_ = getattr(data, rk), getattr(data, gk)
            ece_rows[g][f"{name}_before"] = ece(rows_, gold_, 1.0, bins, ex)
            ece_rows[g][f"{name}_after"] = ece(rows_, gold_, temps[g], bins, ex)

    amb = cfg["ambiguity"]
    table = margin_table(
        dev,
        temps["chunk"],
        temps["arc"],
        [float(x) for x in amb["margin_candidates"]],
        [float(x) for x in amb["attachment_margin_candidates"]],
        int(amb["max_alternatives"]),
    )
    chosen = choose_margins(table, float(amb["max_mean_alternatives"]))

    gating = run_gating(model_key, run, temps["arc"], temps["rel"], cfg)

    labels_json["calibration"] = {
        "temperature": temps["chunk"],
        "rel_temperature": temps["rel"],
        "arc_temperature": temps["arc"],
    }
    labels_json["ambiguity"] = {
        "margin": chosen["margin"],
        "attachment_margin": chosen["attachment_margin"],
    }
    labels_json["nested"] = {
        "bracket_threshold": gating["threshold"],
        "role_threshold": gating["role"]["threshold"],
    }
    problems = validate_labels_json(labels_json)
    if problems:
        raise RuntimeError(f"labels.json invalid after calibration: {problems}")
    labels_path.write_text(json.dumps(labels_json, indent=2, ensure_ascii=False) + "\n")

    result = {
        "model": model_key,
        "run": run,
        "temperatures": temps,
        "ece": ece_rows,
        "margins": chosen,
        "margin_table": table,
        "gating": gating,
        "dev_words": len(dev.a_gold),
        "pp_words_dev": int(sum(dev.pp_word)),
    }
    out = TRAINING_DIR / data_cfg["paths"]["eval"] / model_key / run / "calibration.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    return result


def run_gating(
    model_key: str, run: str, arc_temperature: float, rel_temperature: float, cfg: dict[str, Any]
) -> dict[str, Any]:
    """js/gating_eval.mjs: bracket and role thresholds on dev, precision and coverage on test."""
    cmd = [
        "npx", "tsx", "gating_eval.mjs", "--model", model_key, "--run", run,
        "--arc-temperature", str(arc_temperature), "--rel-temperature", str(rel_temperature),
        "--min-precision", str(cfg["acceptance"]["nested_view"]["min_shown_precision"]),
    ]  # fmt: skip
    proc = subprocess.run(cmd, cwd=TRAINING_DIR / "js", capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"gating_eval.mjs failed: {proc.stderr[-2000:]}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


# -- report ------------------------------------------------------------------------------


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.2f}"


def offered(test: dict[str, Any], cfg: dict[str, Any]) -> bool:
    """Flat-view acceptance (same rule as run_phase7.py's report)."""
    acc, base = cfg["acceptance"], cfg["baselines"]
    return (
        test["upos_acc"] >= acc["min_upos_accuracy"]
        and test["chunk_f1"] >= acc["min_chunk_f1"]
        and test["upos_acc"] > base["upos_accuracy"]
        and test["chunk_f1"] > base["chunk_f1"]
    )


def nested_verdict(test: dict[str, Any], gating: dict[str, Any], cfg: dict[str, Any]) -> str:
    """Nested view decision: all targets on test (bracket and role precision after gating)."""
    nv = cfg["acceptance"]["nested_view"]
    ok = (
        test.get("tree_uas_no_punct", 0) >= nv["min_uas_no_punct"]
        and test.get("nested_multiword_f1", 0) >= nv["min_bracket_f1"]
        and (gating["test"]["precision"] or 0) >= nv["min_shown_precision"]
        and (gating["role"]["test"]["precision"] or 0) >= nv["min_shown_precision"]
    )
    return "**yes**" if ok else "no"


def render(results: list[dict[str, Any]], skipped: list[str], cfg: dict[str, Any]) -> str:
    """reports/calibration.md."""
    amb = cfg["ambiguity"]
    nv = cfg["acceptance"]["nested_view"]
    L = [
        "# Calibration report (Phase 8)",
        "",
        "Generated by `scripts/calibrate.py` for the offered biaffine models (carried-forward "
        "checkpoint = dev-selected seed run of the biaffine stage). Temperatures are fitted on dev "
        "(NLL); ECE is top-1 expected calibration error "
        f"({cfg['calibration']['ece_bins']} bins). Margins are chosen on dev: most errors "
        "recovered (gold label or PP head offered as an alternative) with mean alternatives "
        "per sentence "
        f"≤ {amb['max_mean_alternatives']} (cap {amb['max_alternatives']}; proposed rule, "
        "owner-set mean cap). The "
        "bracket threshold is the lowest span confidence (T78: per word, the probability that "
        "its head stays on its side of the bracket; `treeDecoder.ts` → `spanConfidence`; brackets "
        "are one per phrase, T75, with the quantifier display rule, T77) whose dev shown-bracket "
        "precision (labeled, "
        f"multi-word) is ≥ {_pct(nv['min_shown_precision'])}; test values are reported at it. "
        "The role threshold (T59) is the lowest role confidence (relation × head probability of "
        "the role's head word) whose dev role precision is ≥ the same target, with brackets gated "
        "at the bracket threshold and roles of collapsed brackets shown as head-word badges.",
        "",
        "## Summary",
        "",
        "| Model | Run | T (A / rel / arc) | ECE A before → after (test) | ECE arc before → after "
        "(test) | Margin | Attachment margin | Mean alternatives / sentence (dev) | Bracket "
        "threshold | Shown precision (test) | Coverage (test) | Role threshold | Role precision "
        "(test) | Roles shown (test) | Nested view |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        t, e, m, g = r["temperatures"], r["ece"], r["margins"], r["gating"]
        L.append(
            f"| {r['model']} | `{r['run']}` | {t['chunk']} / {t['rel']} / {t['arc']} | "
            f"{_pct(e['chunk']['test_before'])} → {_pct(e['chunk']['test_after'])} | "
            f"{_pct(e['arc']['test_before'])} → {_pct(e['arc']['test_after'])} | {m['margin']} | "
            f"{m['attachment_margin']} | {m['mean_alternatives']:.2f} | {g['threshold']} | "
            f"{_pct(g['test']['precision'])} | {_pct(g['test']['coverage'])} | "
            f"{g['role']['threshold']} | {_pct(g['role']['test']['precision'])} | "
            f"{_pct(g['role']['test']['coverage'])} | {r.get('nested_view', '—')} |"
        )
    if skipped:
        L += [
            "",
            "Not calibrated (not offered: flat thresholds not met): " + ", ".join(skipped) + ".",
        ]
    for r in results:
        L += ["", f"## {r['model']}", "", "ECE (%), before → after:", ""]
        L += ["| Output | Dev | Test |", "|---|---|---|"]
        for gname, label in (
            ("chunk", "Group A (UPOS\\|CHUNK)"),
            ("rel", "Relation"),
            ("arc", "Arc"),
        ):
            e = r["ece"][gname]
            L.append(
                f"| {label} | {_pct(e['dev_before'])} → {_pct(e['dev_after'])} | "
                f"{_pct(e['test_before'])} → {_pct(e['test_after'])} |"
            )
        L += [
            "",
            "Margins (dev; rows with attachment margin = chosen):",
            "",
            "| Margin | Attachment margin | Label errors recovered | PP-attachment errors "
            "recovered | Mean alternatives / sentence | Sentences with alternatives |",
            "|---|---|---|---|---|---|",
        ]
        for row in r["margin_table"]:
            if row["attachment_margin"] != r["margins"]["attachment_margin"]:
                continue
            mark = " ←" if row["margin"] == r["margins"]["margin"] else ""
            L.append(
                f"| {row['margin']}{mark} | {row['attachment_margin']} | "
                f"{_pct(row['label_errors_recovered'])} | {_pct(row['pp_errors_recovered'])} | "
                f"{row['mean_alternatives']:.2f} | {_pct(row['sentences_with_alternatives'])} |"
            )
        g = r["gating"]
        L += [
            "",
            "Bracket gating (multi-word brackets):",
            "",
            "| Threshold | Dev precision | Dev coverage | Test precision | Test coverage | "
            "Test recall |",
            "|---|---|---|---|---|---|",
        ]
        for row in g["curve"]:
            mark = " ←" if row["threshold"] == g["threshold"] else ""
            L.append(
                f"| {row['threshold']}{mark} | {_pct(row['dev']['precision'])} | "
                f"{_pct(row['dev']['coverage'])} | {_pct(row['test']['precision'])} | "
                f"{_pct(row['test']['coverage'])} | {_pct(row['test']['recall'])} |"
            )
        role = g["role"]
        L += [
            "",
            f"Role gating (T59; brackets gated at {g['threshold']}; coverage = share of roles "
            "shown without a role gate):",
            "",
            "| Role threshold | Dev precision | Dev coverage | Test precision | Test coverage | "
            "Test recall |",
            "|---|---|---|---|---|---|",
        ]
        for row in role["curve"]:
            mark = " ←" if row["threshold"] == role["threshold"] else ""
            L.append(
                f"| {row['threshold']}{mark} | {_pct(row['dev']['precision'])} | "
                f"{_pct(row['dev']['coverage'])} | {_pct(row['test']['precision'])} | "
                f"{_pct(row['test']['coverage'])} | {_pct(row['test']['recall'])} |"
            )
    L.append("")
    return "\n".join(L)


def main() -> None:
    """Calibrate the offered biaffine models (or one run) and write the report."""
    parser = argparse.ArgumentParser(description="Phase 8 calibration.")
    parser.add_argument("--models", nargs="*", help="model keys (default: phase7.models)")
    parser.add_argument("--model", help="one model with --run (no record, no report)")
    parser.add_argument("--run", help="run name under data/checkpoints/<model>/")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--smoke", action="store_true", help="first smoke.dev_windows windows only")
    parser.add_argument("--config", default=str(CONFIG_DIR / "eval.yaml"))
    args = parser.parse_args()

    from train import pick_device

    cfg = yaml.safe_load(Path(args.config).read_text())
    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    device = pick_device(args.device)
    if args.model:
        if not args.run:
            raise SystemExit("--model needs --run")
        r = calibrate_run(args.model, args.run, cfg, data_cfg, device, args.smoke)
        print(
            json.dumps(
                {k: r[k] for k in ("temperatures", "margins")}
                | {"gating": r["gating"]["threshold"]}
            )
        )
        return

    stage = cfg["phase7_stages"]["biaffine"]
    results, skipped = [], []
    for m in args.models or cfg["phase7"]["models"]:
        rec_path = TRAINING_DIR / data_cfg["paths"]["eval"] / m / stage["record"]
        if not rec_path.exists():
            skipped.append(f"{m} (no biaffine record)")
            continue
        rec = json.loads(rec_path.read_text())
        run = rec.get("selected_run")
        test = (rec.get("seeds", {}).get(run) or {}).get("test") if run else None
        if not test or not offered(test, cfg):
            skipped.append(m)
            continue
        r = calibrate_run(m, run, cfg, data_cfg, device)
        r["nested_view"] = nested_verdict(test, r["gating"], cfg)
        results.append(r)
        print(
            f"{m}/{run}: T {r['temperatures']}, margins {r['margins']['margin']} / "
            f"{r['margins']['attachment_margin']}, bracket threshold {r['gating']['threshold']}, "
            f"role threshold {r['gating']['role']['threshold']}"
        )
    REPORT.write_text(render(results, skipped, cfg), encoding="utf-8")
    print(f"report -> {REPORT.relative_to(TRAINING_DIR)}")


if __name__ == "__main__":
    main()
