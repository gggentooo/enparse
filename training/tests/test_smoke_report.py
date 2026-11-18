"""
training/tests/test_smoke_report.py — unit test for smoke_report.py rendering

Description:
    Renders the smoke-test table from fake step results (one passing model,
    one with a failed benchmark, one that did not export).

Phase: 7 task 0. Status: implemented (Phase 7 pre-work).
"""

from __future__ import annotations

from smoke_report import render


def _ok_export() -> dict:
    v = {"bytes": 66_000_000}
    return {
        "checker": {"fp32": "ok", "int8": "ok", "fp16": "ok"},
        "variants": {"int8": v, "fp16": v},
    }


def _bench(passed: bool) -> dict:
    agree = {
        "parity_agreement": {"chunk": 1.0, "dep": 0.99},
        "confident_agreement": {"chunk": 1.0, "dep": 1.0},
    }
    return {
        "passed": passed,
        "problems": [] if passed else ["int8: group B agreement 0.9 < 0.99"],
        "tokenizer": {"strategy": "plain"},
        "variants": [agree, agree, agree],
    }


def test_render_pass_fail_and_missing() -> None:
    text = render(
        [
            {
                "key": "a",
                "train": {"train_seconds": 12.3},
                "export": _ok_export(),
                "bench": _bench(True),
            },
            {
                "key": "b",
                "train": {"train_seconds": 20.0},
                "export": _ok_export(),
                "bench": _bench(False),
            },
            {"key": "c", "train": {"train_seconds": 5.0}, "export": None, "bench": None},
        ]
    )
    rows = [line for line in text.split("\n") if line.startswith("| ")][1:]  # skip the header
    assert rows[0].endswith("| Pass |") and "66.0 / 66.0" in rows[0] and "plain" in rows[0]
    assert rows[1].endswith("| **Fail** |")
    assert "missing export, benchmark" in rows[2]
    assert "- b: int8: group B agreement 0.9 < 0.99" in text
    assert "- c: did not run: export, benchmark" in text
