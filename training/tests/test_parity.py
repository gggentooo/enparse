"""
training/tests/test_parity.py — tests for the Phase 9 parity rule (scripts/evaluate.py)

Description:
    parity_check: fp32 agreement vs PyTorch, int8/fp16 chunk F1 and LAS drops
    vs fp32, output-shape check; a failing fp32 fails every variant.

Dependencies:
    Python: pytest; scripts/evaluate.py.

Status: implemented (Phase 9).
"""

from __future__ import annotations

from evaluate import parity_check

LIMITS = {"fp32_min_agreement": 0.999, "max_f1_drop_points": 0.3}


def _m(f1: float, las: float) -> dict[str, float]:
    return {"chunk_f1": f1, "las": las, "uas": las, "upos_acc": 0.97}


def test_parity_passes_and_fails_on_drops() -> None:
    metrics = {
        "torch": _m(0.9682, 0.9235),
        "fp32": _m(0.9682, 0.9235),
        "int8": _m(0.9649, 0.9233),  # chunk F1 −0.33 points
        "fp16": _m(0.9690, 0.9240),  # better than fp32
    }
    agreement = {v: {"chunk": 1.0, "dep": 1.0, "arc": 1.0} for v in ("fp32", "int8", "fp16")}
    width = dict.fromkeys(("fp32", "int8", "fp16"), True)
    p = parity_check(metrics, agreement, width, LIMITS)
    assert p["fp32"] == [] and p["fp16"] == []
    assert len(p["int8"]) == 1 and "chunk_f1 drop 0.33" in p["int8"][0]


def test_fp32_failure_fails_every_variant() -> None:
    metrics = {v: _m(0.96, 0.92) for v in ("torch", "fp32", "int8")}
    agreement = {"fp32": {"chunk": 0.998, "dep": 1.0}, "int8": {"chunk": 0.99, "dep": 0.99}}
    p = parity_check(metrics, agreement, {"fp32": True, "int8": False}, LIMITS)
    assert any("agreement chunk" in x for x in p["fp32"])
    assert "fp32 failed parity" in p["int8"]
    assert "output shape differs from labels.json" in p["int8"]
