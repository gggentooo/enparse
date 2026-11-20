"""
training/tests/test_calibrate.py — unit tests for scripts/calibrate.py (Phase 8, T58)

Description:
    Temperature fitting recovers a known temperature, ECE drops after
    calibration, the margin table counts recovered errors and alternatives,
    the margin rule respects the alternatives budget, and the report renders.

Status: implemented (T58).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from calibrate import Collected, choose_margins, ece, fit_temperature, margin_table, nll, render


def _samples(
    t_true: float, n: int = 4000, c: int = 5, seed: int = 0
) -> tuple[list[np.ndarray], list[int]]:
    rng = np.random.default_rng(seed)
    rows, gold = [], []
    for _ in range(n):
        z = rng.normal(0, 2, c)
        p = np.exp(z / t_true)
        p /= p.sum()
        rows.append(z)
        gold.append(int(rng.choice(c, p=p)))
    return rows, gold


def test_fit_temperature_recovers_true_temperature_and_lowers_ece() -> None:
    rows, gold = _samples(2.0)
    t = fit_temperature(rows, gold, None, 0.25, 4.0)
    assert t == pytest.approx(2.0, rel=0.1)
    assert nll(rows, gold, t) <= nll(rows, gold, 1.0)
    assert ece(rows, gold, t, 15) < ece(rows, gold, 1.0, 15)


def test_exclusion_column_is_ignored() -> None:
    rows = [np.array([0.0, 50.0, 1.0])]
    assert nll(rows, [2], 1.0, exclude=[1]) == pytest.approx(-np.log(np.exp(1) / (1 + np.exp(1))))


def _collected() -> Collected:
    c = Collected()
    # sentence 0: word 0 ambiguous (0.5/0.4), gold = 2nd label; word 1 confident and right
    c.a_logits = [np.log(np.array([0.5, 0.4, 0.1])), np.log(np.array([0.9, 0.05, 0.05]))]
    c.a_gold = [1, 0]
    # arcs: word 0 is a PP word whose head is the 2nd candidate (0.55 vs 0.45)
    c.arc_rows = [np.log(np.array([0.55, 1e-9, 0.45])), np.log(np.array([0.98, 0.02, 1e-9]))]
    c.arc_gold = [2, 0]
    c.arc_self = [1, 2]
    c.pp_word = [True, False]
    c.sentence = [0, 0]
    return c


def test_margin_table_counts_recovered_errors_and_alternatives() -> None:
    table = margin_table(_collected(), 1.0, 1.0, [0.05, 0.2], [0.0, 0.2], cap=5)
    row = {(r["margin"], r["attachment_margin"]): r for r in table}
    assert row[(0.05, 0.0)]["errors_recovered"] == 0.0
    assert row[(0.2, 0.0)]["label_errors_recovered"] == 1.0
    assert row[(0.2, 0.2)]["errors_recovered"] == 1.0
    assert row[(0.2, 0.2)]["mean_alternatives"] == 2.0  # one label alternative + one attachment
    best = choose_margins(table, max_mean=1.0)
    assert best["mean_alternatives"] <= 1.0 and best["errors_recovered"] == 0.5


def test_render_lists_models_and_skipped() -> None:
    cfg: dict[str, Any] = {
        "ambiguity": {"max_mean_alternatives": 1.0, "max_alternatives": 5},
        "acceptance": {"nested_view": {"min_shown_precision": 0.95}},
        "calibration": {"ece_bins": 15},
    }
    curve_row = {"precision": 0.96, "coverage": 0.8, "recall": 0.7}
    result = {
        "model": "m",
        "run": "r",
        "temperatures": {"chunk": 1.1, "rel": 1.2, "arc": 1.3},
        "ece": {
            g: dict.fromkeys(("dev_before", "dev_after", "test_before", "test_after"), 0.01)
            for g in ("chunk", "rel", "arc")
        },  # noqa: E501
        "margins": {"margin": 0.2, "attachment_margin": 0.1, "mean_alternatives": 0.8},
        "margin_table": [
            {
                "margin": 0.2,
                "attachment_margin": 0.1,
                "label_errors_recovered": 0.3,
                "pp_errors_recovered": 0.4,
                "mean_alternatives": 0.8,
                "sentences_with_alternatives": 0.5,
            },  # noqa: E501
        ],
        "gating": {
            "threshold": 0.5,
            "test": curve_row,
            "curve": [{"threshold": 0.5, "dev": curve_row, "test": curve_row}],
            "role": {
                "threshold": 0.4,
                "test": curve_row,
                "curve": [{"threshold": 0.4, "dev": curve_row, "test": curve_row}],
            },
        },  # noqa: E501
        "nested_view": "**yes**",
    }
    text = render([result], ["x"], cfg)
    assert "| m | `r` | 1.1 / 1.2 / 1.3 |" in text and "Not calibrated" in text and "0.5 ←" in text
