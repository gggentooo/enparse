"""
training/scripts/run_phase7.py — unattended Phase 7 training and evaluation for every candidate

Description:
    Runs Phase 7 tasks 1, 2, and 4 for each model in configs/eval.yaml →
    phase7.models, without supervision, and writes reports/training.md after
    every model (a partial report is always available).

Phase: 7 — Full training and tuning.

Per model:
    1. Learning-rate sweep (configs/train_<m>.yaml → lr_sweep) at the default
       λ and first seed.
    2. λ sweep (dep_loss_weight_sweep) at the best learning rate.
    3. Seeds (seeds) at the best learning rate and λ.
    4. Evaluate every seed run on dev and test (scripts/evaluate.py) and score
       nested phrases with the app's treeDecoder.ts (js/nested_eval.mjs).
       Cached nested scores missing a NESTED_KEYS metric are recomputed.
    5. Delete the weights of sweep runs not used as seeds (keeps summary.json and
       TensorBoard logs), if phase7.prune_unselected.
    Selection uses dev only: mean of phase7.selection metrics (chunk F1 and
    LAS). The checkpoint offered later is the seed run with the best dev score;
    test results are reported for every seed and never used for choices.

Unattended operation:
    - Every training run is a separate process (MPS memory is freed between
      runs); its output goes to data/logs/phase7/<model>/<run>.log.
    - Resumable: a run with summary.json, or an evaluation with its output file,
      is reused; rerunning the script continues where it stopped.
    - A failed run is recorded and skipped; a failed model does not stop the
      others.
    - Progress: data/logs/phase7_status.json (current step, finished and failed
      steps, timestamps).

Biaffine stage (--stage biaffine; T51): every run uses --head biaffine
    (scripts/biaffine.py); the learning-rate sweep adds
    phase7_stages.biaffine.lr_sweep_extra[<model>]; λ is fixed from the base
    run. Augmentation experiment: at the best learning rate, the first seed is
    also trained on the augmented train split (tag `<tag>aug`); if its dev
    selection score is not lower, the seed runs use the augmented split.

Report: a model is offered if it meets acceptance.min_upos_accuracy and
    min_chunk_f1 and beats the baselines. Its nested view is judged by
    acceptance.nested_view: UAS without punctuation and multi-word bracket F1
    are checked here; shown-bracket precision needs Phase 8 confidence gating,
    so a model that meets both is marked "pending Phase 8".

Usage (from training/, venv active):
    python scripts/run_phase7.py [--models m1 m2] [--dry-run] [--report-only]
    --report-only merges the current <split>_nested.json files into the saved
    records before rendering.
    Overnight: sh scripts/run_phase7_overnight.sh (detached, caffeinate)

Dependencies:
    Python: pyyaml; scripts/train.py, scripts/evaluate.py (subprocesses);
            Node: js/nested_eval.mjs (npx tsx).
    Reads:  configs/eval.yaml (phase7, acceptance, baselines), configs/train_<m>.yaml,
            configs/data.yaml (paths).
    Writes: data/checkpoints/<m>/<run>/, data/eval/<m>/<run>/, data/eval/<m>/phase7.json,
            data/logs/phase7/, data/logs/phase7_status.json, reports/training.md.

Status: implemented (Phase 7).
"""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
REPORT = TRAINING_DIR / "reports" / "training.md"
METRICS = ("upos_acc", "chunk_f1", "uas", "las")
# Nested scores the report needs; older *_nested.json files without them are recomputed.
NESTED_KEYS = ("tree_uas_no_punct", "nested_multiword_f1")


def run_name(lr: float, w: float, seed: int, tag: str = "") -> str:
    """Same naming as train.py single runs, plus a stage tag (e.g. `_e30`)."""
    return f"lr{lr:g}_w{w:g}_s{seed}" + (f"_{tag}" if tag else "")


def in_stage(run: str, tag: str) -> bool:
    """True if a run folder belongs to the stage with this tag ("" = base Phase 7); a stage's
    augmented runs (`<tag>aug`) belong to it too."""
    import re

    if not tag:
        return re.fullmatch(r"lr[^_]+_w[^_]+_s\d+", run) is not None
    return run.endswith(f"_{tag}") or run.endswith(f"_{tag}aug")


def selection_score(dev: dict[str, Any], keys: list[str]) -> float:
    """Mean of the selection metrics (dev)."""
    return statistics.mean(float(dev.get(k, 0.0)) for k in keys)


@dataclass
class Status:
    """Progress file for unattended runs."""

    path: Path
    data: dict[str, Any] = field(default_factory=dict)

    def update(self, **kw: Any) -> None:  # noqa: ANN401 — JSON values
        """Merge fields and write the file."""
        self.data.update(kw, updated_at=now())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2) + "\n")

    def append(self, key: str, value: Any) -> None:  # noqa: ANN401 — JSON values
        """Append to a list field and write the file."""
        self.data.setdefault(key, []).append(value)
        self.update()


def matches(settings: dict[str, Any], expected: dict[str, Any]) -> bool:
    """True if a finished run used the expected settings (keys present in expected)."""
    return all(settings.get(k) == v for k, v in expected.items())


def has_nested_keys(path: Path) -> bool:
    """True if a cached *_nested.json has every metric in NESTED_KEYS."""
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    return all(k in data for k in NESTED_KEYS)


def now() -> str:
    """UTC timestamp."""
    return datetime.now(UTC).isoformat(timespec="seconds")


class Runner:
    """Runs and reuses training and evaluation steps for one model."""

    def __init__(
        self,
        model: str,
        paths: dict[str, Path],
        status: Status,
        dry: bool,
        expected: dict[str, Any] | None = None,
        tag: str = "",
        head: str = "rel_pos",
    ) -> None:
        self.expected = expected or {}
        self.tag = tag
        self.head = head
        self.model = model
        self.paths = paths
        self.status = status
        self.dry = dry

    def summary_path(self, run: str) -> Path:
        """summary.json of a run."""
        return self.paths["checkpoints"] / self.model / run / "summary.json"

    def _call(self, cmd: list[str], log: Path, cwd: Path) -> bool:
        if self.dry:
            print("DRY:", " ".join(cmd))
            return False
        log.parent.mkdir(parents=True, exist_ok=True)
        self.status.update(current={"model": self.model, "cmd": " ".join(cmd[1:4]), "since": now()})
        with log.open("a") as f:
            f.write(f"\n=== {now()} {' '.join(cmd)}\n")
            f.flush()
            proc = subprocess.run(cmd, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, check=False)
        return proc.returncode == 0

    def run_for(self, lr: float, w: float, seed: int, augment: bool = False) -> str:
        """Run name; augmented runs get the tag suffix `aug`."""
        return run_name(lr, w, seed, self.tag + ("aug" if augment else ""))

    def train(self, lr: float, w: float, seed: int, augment: bool = False) -> dict[str, Any] | None:
        """Train (or reuse) one run; None if it failed or in dry-run mode."""
        run = self.run_for(lr, w, seed, augment)
        path = self.summary_path(run)
        expected = self.expected | (
            {"head": self.head, "augment": augment} if self.head != "rel_pos" else {}
        )
        if path.exists():
            old = json.loads(path.read_text())
            if matches(old.get("settings", {}), expected):
                return old
            # Same name, different settings (e.g., changed batch size): keep it aside and retrain.
            stale = path.parent.with_name(f"{run}.stale-{int(time.time())}")
            path.parent.rename(stale)
            self.status.append("stale", f"{self.model}/{run} → {stale.name}")
        cmd = [sys.executable, "scripts/train.py", "--model", self.model]
        cmd += ["--lr", f"{lr:g}", "--dep-weight", f"{w:g}", "--seed", str(seed), "--run-name", run]
        if self.head != "rel_pos":
            cmd += ["--head", self.head] + (["--augment"] if augment else [])
        cmd += (
            ["--epochs", str(self.expected.get("epochs", ""))] if "epochs" in self.expected else []
        )
        if "early_stopping_patience" in self.expected:
            cmd += ["--patience", str(self.expected["early_stopping_patience"])]
        ok = self._call(
            cmd, self.paths["logs"] / "phase7" / self.model / f"{run}.log", TRAINING_DIR
        )
        if ok and path.exists():
            summary = json.loads(path.read_text())
            self.status.append("finished", f"{self.model}/{run} ({summary['train_seconds']} s)")
            return summary
        if not self.dry:
            self.status.append("failed", f"{self.model}/{run}")
        return None

    def evaluate(self, run: str, split: str) -> dict[str, Any] | None:
        """Evaluate (or reuse) one run on a split, incl. nested phrases."""
        out = self.paths["eval"] / self.model / run
        metrics_path, nested_path = out / f"{split}_metrics.json", out / f"{split}_nested.json"
        log = self.paths["logs"] / "phase7" / self.model / f"{run}.eval.log"
        if not metrics_path.exists():
            cmd = [sys.executable, "scripts/evaluate.py", "--model", self.model, "--run", run]
            if not self._call(cmd + ["--split", split], log, TRAINING_DIR):
                return None
        if not nested_path.exists() or not has_nested_keys(nested_path):
            cmd = [
                "npx",
                "tsx",
                "nested_eval.mjs",
                "--model",
                self.model,
                "--run",
                run,
                "--split",
                split,
            ]
            if not self._call(cmd, log, TRAINING_DIR / "js"):
                return None
        if self.dry:
            return None
        return json.loads(metrics_path.read_text()) | json.loads(nested_path.read_text())

    def prune(self, keep: set[str]) -> list[str]:
        """Delete weights of runs not in keep (summary.json and logs stay)."""
        removed = []
        for best in sorted((self.paths["checkpoints"] / self.model).glob("*/best")):
            run = best.parent.name
            if run not in keep and in_stage(run, self.tag):
                shutil.rmtree(best)
                removed.append(run)
        return removed


def run_model(
    model: str,
    cfg: dict[str, Any],
    paths: dict[str, Path],
    status: Status,
    dry: bool,
    stage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Sweeps, seeds, evaluation, and pruning for one model; returns the model record.

    A stage (configs/eval.yaml → phase7_stages.<name>) overrides training settings, tags run
    names, and can fix λ to the base Phase 7 choice (skipping the λ sweep).
    """
    mcfg = yaml.safe_load((CONFIG_DIR / f"train_{model}.yaml").read_text())
    stage = stage or {}
    for k in ("epochs", "early_stopping_patience", "lr_sweep"):
        if k in stage:
            mcfg[k] = stage[k]
    extra_lr = (stage.get("lr_sweep_extra") or {}).get(model, [])
    mcfg["lr_sweep"] = list(mcfg["lr_sweep"]) + [x for x in extra_lr if x not in mcfg["lr_sweep"]]
    tag = str(stage.get("tag", ""))
    head = str(stage.get("head", "rel_pos"))
    keys = list(cfg["phase7"]["selection"])
    expected = {
        k: mcfg[k]
        for k in ("batch_size", "epochs", "early_stopping_patience", "weight_decay", "warmup_ratio")
    }
    r = Runner(model, paths, status, dry, expected, tag, head)
    base_w, seed0 = float(mcfg["dep_loss_weight"]), int(mcfg["seeds"][0])
    record: dict[str, Any] = {"model": model, "base_model": mcfg["model_name"], "started_at": now()}
    record["stage"] = stage.get("name", "base")
    if stage.get("fix_dep_weight"):
        base = json.loads((paths["eval"] / model / "phase7.json").read_text())
        base_w = float(base["chosen"]["dep_loss_weight"])

    def best_of(runs: dict[str, dict[str, Any] | None]) -> tuple[str, dict[str, Any]] | None:
        done = {k: v for k, v in runs.items() if v}
        if not done:
            return None
        k = max(done, key=lambda n: selection_score(done[n]["best_dev"], keys))
        return k, done[k]

    lr_runs = {f"{lr:g}": r.train(float(lr), base_w, seed0) for lr in mcfg["lr_sweep"]}
    record["lr_sweep"] = {k: v["best_dev"] if v else None for k, v in lr_runs.items()}
    best_lr = best_of(lr_runs)
    if best_lr is None:
        record["error"] = "learning-rate sweep produced no run"
        return record
    lr = float(best_lr[0])

    sweep_w = [base_w] if stage.get("fix_dep_weight") else mcfg["dep_loss_weight_sweep"]
    w_runs = {f"{w:g}": r.train(lr, float(w), seed0) for w in sweep_w}
    record["dep_weight_sweep"] = {k: v["best_dev"] if v else None for k, v in w_runs.items()}
    best_w = best_of(w_runs)
    if best_w is None:
        record["error"] = "λ sweep produced no run"
        return record
    w = float(best_w[0])
    record["chosen"] = {"learning_rate": lr, "dep_loss_weight": w}

    augment = False
    if stage.get("augmentation_experiment"):
        plain = best_w[1]
        aug = r.train(lr, w, seed0, augment=True)
        if aug is not None:
            s_plain = selection_score(plain["best_dev"], keys)
            s_aug = selection_score(aug["best_dev"], keys)
            augment = s_aug >= s_plain
            record["augmentation"] = {
                "plain_dev": plain["best_dev"],
                "augmented_dev": aug["best_dev"],
                "plain_select": s_plain,
                "augmented_select": s_aug,
                "used": augment,
            }
        record["chosen"]["augment"] = augment

    seed_runs = {
        r.run_for(lr, w, int(s), augment): r.train(lr, w, int(s), augment) for s in mcfg["seeds"]
    }
    record["seeds"] = {}
    for run, summary in seed_runs.items():
        if summary is None:
            record["seeds"][run] = None
            continue
        entry: dict[str, Any] = {
            "seed": summary["settings"]["seed"],
            "dev_best_epoch": summary["best_dev"],
            "epochs_run": summary["epochs_run"],
            "train_seconds": summary["train_seconds"],
        }
        for split in cfg["phase7"]["eval_splits"]:
            entry[split] = r.evaluate(run, split)
        record["seeds"][run] = entry
    done = {k: v for k, v in record["seeds"].items() if v and v.get("dev")}
    if done:
        record["selected_run"] = max(done, key=lambda k: selection_score(done[k]["dev"], keys))
    if cfg["phase7"]["prune_unselected"] and not dry:
        record["pruned"] = r.prune(set(seed_runs))
    record["finished_at"] = now()
    out = paths["eval"] / model / str(stage.get("record", "phase7.json"))
    if not dry:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(record, indent=2) + "\n")
    return record


# -- report ----------------------------------------------------------------------------


def _pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.2f}"


def _mean_sd(values: list[float]) -> str:
    if not values:
        return "—"
    if len(values) == 1:
        return f"{100 * values[0]:.2f}"
    return f"{100 * statistics.mean(values):.2f} ± {100 * statistics.stdev(values):.2f}"


def nested_view_verdict(test: dict[str, Any], nv: dict[str, Any]) -> str:
    """Nested-view column: "no", "pending Phase 8", or "—" when scores are missing."""
    uas, f1 = test.get("tree_uas_no_punct"), test.get("nested_multiword_f1")
    if uas is None or f1 is None:
        return "— (rescore)"
    if uas >= nv["min_uas_no_punct"] and f1 >= nv["min_bracket_f1"]:
        return "pending Phase 8"
    return "no"


def refresh_record(rec: dict[str, Any], model_eval_dir: Path) -> dict[str, Any]:
    """Merge the current <split>_nested.json of every seed run into a saved record."""
    for run, entry in (rec.get("seeds") or {}).items():
        if not entry:
            continue
        for split in ("dev", "test"):
            path = model_eval_dir / run / f"{split}_nested.json"
            if entry.get(split) and path.exists():
                entry[split] = entry[split] | json.loads(path.read_text())
    return rec


def render_report(records: list[dict[str, Any]], cfg: dict[str, Any]) -> str:
    """reports/training.md from the per-model records."""
    acc, base = cfg["acceptance"], cfg["baselines"]
    nv = acc["nested_view"]
    keys = " + ".join(cfg["phase7"]["selection"])
    L = [
        "# Training report (Phase 7)",
        "",
        "Generated by `scripts/run_phase7.py`. Dev chooses the learning rate, λ, and the offered seed "  # noqa: E501
        f"(mean of {keys}); test is reported for every seed and never used for choices. Raw scores are "  # noqa: E501
        "word-level argmax; *tree* scores and nested-phrase F1 use the app's `treeDecoder.ts` (repaired "  # noqa: E501
        "trees; MST over arc scores for biaffine models, where *Repaired* = words whose tree head is "  # noqa: E501
        "not their argmax head). Percentages.",
        "",
        f"Thresholds: offered if test UPOS ≥ {_pct(acc['min_upos_accuracy'])} and chunk F1 ≥ "
        f"{_pct(acc['min_chunk_f1'])} and both baselines are beaten (UPOS > {_pct(base['upos_accuracy'])}, "  # noqa: E501
        f"chunk F1 > {_pct(base['chunk_f1'])}). Nested view (`acceptance.nested_view`): tree UAS "
        f"without punctuation ≥ {_pct(nv['min_uas_no_punct'])}, multi-word bracket F1 ≥ "
        f"{_pct(nv['min_bracket_f1'])}, and shown-bracket precision ≥ {_pct(nv['min_shown_precision'])} "  # noqa: E501
        "after confidence gating; the last is measured in Phase 8, so a model meeting the first "
        "two is marked *pending Phase 8*. Thresholds: `configs/eval.yaml` → `acceptance`.",
        "",
        "## Summary (offered seed, test)",
        "",
        "| Model | Seed run | UPOS | Chunk F1 | Tree UAS | Tree LAS | UAS excl. punct | Nested F1 | Multi-word F1 | Repaired | Offered | Nested view |",  # noqa: E501
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for rec in records:
        sel = rec.get("selected_run")
        t = (rec.get("seeds", {}).get(sel) or {}).get("test") if sel else None
        if not t:
            L.append(
                f"| {rec['model']} | — | — | — | — | — | — | — | — | — | {rec.get('error', 'not finished')} | — |"  # noqa: E501
            )
            continue
        offered = (
            t["upos_acc"] >= acc["min_upos_accuracy"]
            and t["chunk_f1"] >= acc["min_chunk_f1"]
            and t["upos_acc"] > base["upos_accuracy"]
            and t["chunk_f1"] > base["chunk_f1"]
        )
        L.append(
            f"| {rec['model']} | `{sel}` | {_pct(t['upos_acc'])} | {_pct(t['chunk_f1'])} | {_pct(t['tree_uas'])} | "  # noqa: E501
            f"{_pct(t['tree_las'])} | {_pct(t.get('tree_uas_no_punct'))} | "
            f"{_pct(t['nested_f1'])} | {_pct(t.get('nested_multiword_f1'))} | "
            f"{_pct(t['repaired_share'])} | "
            f"{'yes' if offered else '**no**'} | {nested_view_verdict(t, nv)} |"
        )
    for rec in records:
        L += ["", f"## {rec['model']} (`{rec['base_model']}`)", ""]
        if rec.get("error"):
            L.append(f"**Stopped:** {rec['error']}.")
        for title, key, col in (
            ("Learning-rate sweep (dev)", "lr_sweep", "Learning rate"),
            ("λ sweep (dev)", "dep_weight_sweep", "λ"),
        ):
            sweep = rec.get(key)
            if not sweep:
                continue
            L += [
                f"{title}:",
                "",
                f"| {col} | UPOS | Chunk F1 | UAS | LAS |",
                "|---|---|---|---|---|",
            ]
            for k, dev in sweep.items():
                cells = " | ".join(_pct(dev.get(m)) if dev else "failed" for m in METRICS)
                L.append(f"| {k} | {cells} |")
            L.append("")
        seeds = rec.get("seeds")
        if seeds:
            if "chosen" in rec:
                c = rec["chosen"]
                L.append(
                    f"Chosen: learning rate {c['learning_rate']:g}, λ {c['dep_loss_weight']:g}."
                )
                L.append("")
            a = rec.get("augmentation")
            if a:
                L.append(
                    "Augmentation experiment (dev selection score, first seed): "
                    f"{_pct(a['plain_select'])} without, {_pct(a['augmented_select'])} with → "
                    f"{'used for the seed runs' if a['used'] else 'not used'}."
                )
                L.append("")
            done = [v for v in seeds.values() if v and v.get("test")]
            L += [
                "| Seeds (test) | UPOS | Chunk F1 | Tree UAS | Tree LAS | UAS excl. punct | Nested F1 | Multi-word F1 |",  # noqa: E501
                "|---|---|---|---|---|---|---|---|",
            ]
            for run, v in seeds.items():
                if not v or not v.get("test"):
                    L.append(f"| `{run}` | failed or not run | | | | | | |")
                    continue
                t = v["test"]
                L.append(
                    f"| `{run}` | {_pct(t['upos_acc'])} | {_pct(t['chunk_f1'])} | {_pct(t['tree_uas'])} | "  # noqa: E501
                    f"{_pct(t['tree_las'])} | {_pct(t.get('tree_uas_no_punct'))} | {_pct(t['nested_f1'])} | "  # noqa: E501
                    f"{_pct(t.get('nested_multiword_f1'))} |"
                )
            if done:
                cols = (
                    "upos_acc",
                    "chunk_f1",
                    "tree_uas",
                    "tree_las",
                    "tree_uas_no_punct",
                    "nested_f1",
                    "nested_multiword_f1",
                )
                vals = {k: [v["test"][k] for v in done if k in v["test"]] for k in cols}
                L.append("| mean ± sd | " + " | ".join(_mean_sd(vals[k]) for k in vals) + " |")
            total = sum(v["train_seconds"] for v in seeds.values() if v)
            L += ["", f"Training time of the seed runs: {total / 60:.0f} min."]
    L.append("")
    return "\n".join(L)


def main() -> None:
    """Run Phase 7 for every configured model (resumable)."""
    parser = argparse.ArgumentParser(description="Unattended Phase 7.")
    parser.add_argument("--models", nargs="*")
    parser.add_argument("--dry-run", action="store_true", help="print the commands only")
    parser.add_argument(
        "--report-only", action="store_true", help="rebuild the report from finished models"
    )
    parser.add_argument("--stage", help="configs/eval.yaml → phase7_stages.<name> (e.g. extended)")
    args = parser.parse_args()

    cfg = yaml.safe_load((CONFIG_DIR / "eval.yaml").read_text())
    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    paths = {k: TRAINING_DIR / data_cfg["paths"][k] for k in ("checkpoints", "eval", "logs")}
    models = args.models or list(cfg["phase7"]["models"])
    stage: dict[str, Any] | None = None
    report = REPORT
    if args.stage:
        stage = dict(cfg["phase7_stages"][args.stage]) | {"name": args.stage}
        report = TRAINING_DIR / stage["report"]
    status = Status(paths["logs"] / "phase7_status.json")
    records: list[dict[str, Any]] = []

    if args.report_only:
        for m in models:
            p = paths["eval"] / m / str((stage or {}).get("record", "phase7.json"))
            if p.exists():
                records.append(refresh_record(json.loads(p.read_text()), paths["eval"] / m))
        report.write_text(render_report(records, cfg), encoding="utf-8")
        print(f"report -> {report.relative_to(TRAINING_DIR)}")
        return

    status.update(
        started_at=now(),
        stage=args.stage or "base",
        models=models,
        state="running",
        finished=[],
        failed=[],
    )
    started = time.perf_counter()
    for m in models:
        try:
            rec = run_model(m, cfg, paths, status, args.dry_run, stage)
        except Exception as e:  # noqa: BLE001 — one model must not stop the others
            rec = {"model": m, "base_model": "?", "error": f"{type(e).__name__}: {e}"}
            status.append("failed", f"{m}: {rec['error']}")
        records.append(rec)
        if not args.dry_run:
            report.write_text(render_report(records, cfg), encoding="utf-8")
            status.append("models_done", m)
    status.update(
        state="done", current=None, hours=round((time.perf_counter() - started) / 3600, 2)
    )
    print(f"done -> {report.relative_to(TRAINING_DIR)}")


if __name__ == "__main__":
    main()
