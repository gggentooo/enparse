"""
training/scripts/smoke_report.py — collect smoke-test results into reports/smoke_test.md

Description:
    Reads, for each candidate, the smoke run summary (train.py --smoke), the
    export report (export_onnx.py), and the Transformers.js check
    (js/benchmark.mjs --mode smoke), and writes one table plus the problems
    found. A candidate passes if all three steps ran and the benchmark passed.

Phase: 7 task 0 — smoke test.

Usage (from training/): python scripts/smoke_report.py   (run by scripts/run_smoke.sh)

Dependencies:
    Python: pyyaml.
    Reads:  configs/data.yaml (paths), configs/train_*.yaml (model keys);
            data/checkpoints/<model>/smoke/summary.json;
            data/onnx/<model>/smoke/export_report.json, benchmark_smoke.json.
    Writes: reports/smoke_test.md.

Status: implemented (Phase 7 pre-work). Not yet run.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

TRAINING_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = TRAINING_DIR / "configs"
RUN = "smoke"


def _load(path: Path) -> dict[str, Any] | None:
    return json.loads(path.read_text()) if path.exists() else None


def collect(key: str, ckpt_root: Path, onnx_root: Path) -> dict[str, Any]:
    """The three smoke-step results for one model (None where a step did not run)."""
    return {
        "key": key,
        "train": _load(ckpt_root / key / RUN / "summary.json"),
        "export": _load(onnx_root / key / RUN / "export_report.json"),
        "bench": _load(onnx_root / key / RUN / "benchmark_smoke.json"),
    }


def render(results: list[dict[str, Any]]) -> str:
    """Markdown report for all models."""
    lines = [
        "# Smoke test (Phase 7 task 0)",
        "",
        "Per candidate: 1-epoch training on a small train subset (`train.py --smoke`), ONNX export "
        "(`export_onnx.py`), and a Transformers.js load-and-parse check in Node "
        "(`js/benchmark.mjs --mode smoke`). Scores after 1 epoch on a subset are not meaningful; "
        "the test checks that every step works. *Confident words*: PyTorch's top-two logit gap "
        "> `parity.smoke_margin`; int8/fp16 are judged there (near-ties flip under any rounding).",
        "",
        "| Model | Train (s) | int8 / fp16 MB | onnx.checker | Tokenizer strategy | "
        "JS vs PyTorch agreement A / B, all words (fp32, int8, fp16) | "
        "… on confident words | Result |",
        "|---|---|---|---|---|---|---|---|",
    ]
    problems: list[str] = []
    for r in results:
        key, train, exp, bench = r["key"], r["train"], r["export"], r["bench"]
        missing = [
            name
            for name, v in (("train", train), ("export", exp), ("benchmark", bench))
            if v is None
        ]
        if missing:
            problems.append(f"{key}: did not run: {', '.join(missing)}")
            lines.append(
                f"| {key} | — | — | — | — | — | — | **Fail** (missing {', '.join(missing)}) |"
            )
            continue
        sizes = " / ".join(
            f"{exp['variants'][v]['bytes'] / 1e6:.1f}"
            for v in ("int8", "fp16")
            if v in exp["variants"]
        )
        checker = "ok" if all(x == "ok" for x in exp["checker"].values()) else "errors"
        agree = ", ".join(
            f"{v['parity_agreement']['chunk']:.3f} / {v['parity_agreement']['dep']:.3f}"
            for v in bench["variants"]
        )
        confident = ", ".join(
            f"{v['confident_agreement']['chunk']:.3f} / {v['confident_agreement']['dep']:.3f}"
            for v in bench["variants"]
            if "confident_agreement" in v
        )
        strategy = bench["tokenizer"]["strategy"] or "none"
        ok = bench["passed"] and checker == "ok"
        problems += [f"{key}: {p}" for p in bench["problems"]]
        if checker != "ok":
            problems.append(f"{key}: onnx.checker {exp['checker']}")
        lines.append(
            f"| {key} | {train['train_seconds']} | {sizes} | {checker} | {strategy} | {agree} | "
            f"{confident or '—'} | {'Pass' if ok else '**Fail**'} |"
        )
    lines += ["", "## Problems", ""]
    lines += [f"- {p}" for p in problems] if problems else ["None."]
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    """Write reports/smoke_test.md for every configs/train_*.yaml model."""
    data_cfg = yaml.safe_load((CONFIG_DIR / "data.yaml").read_text())
    keys = sorted(p.stem.removeprefix("train_") for p in CONFIG_DIR.glob("train_*.yaml"))
    ckpt_root = TRAINING_DIR / data_cfg["paths"]["checkpoints"]
    onnx_root = TRAINING_DIR / data_cfg["paths"]["onnx"]
    out = TRAINING_DIR / "reports" / "smoke_test.md"
    out.write_text(render([collect(k, ckpt_root, onnx_root) for k in keys]), encoding="utf-8")
    print(f"report -> {out.relative_to(TRAINING_DIR)}")


if __name__ == "__main__":
    main()
