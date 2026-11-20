"""
training/tests/test_run_phase7.py — unit tests for the Phase 7 orchestrator

Description:
    Fakes training and evaluation steps (no models) and checks the stage
    logic: learning rate and λ chosen by the dev selection score, the λ sweep
    at the chosen learning rate, seed runs at both, the offered seed chosen on
    dev only, reuse of finished runs, and the report (thresholds, baselines,
    nested-view targets, failures); rescoring of old nested scores.

Phase: 7. Status: implemented.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

import run_phase7 as rp

CFG: dict[str, Any] = {
    "phase7": {
        "selection": ["chunk_f1", "las"],
        "prune_unselected": False,
        "eval_splits": ["dev", "test"],
    },
    "acceptance": {
        "min_upos_accuracy": 0.97,
        "min_chunk_f1": 0.94,
        "nested_view": {
            "min_uas_no_punct": 0.93,
            "min_bracket_f1": 0.88,
            "min_shown_precision": 0.95,
        },
    },
    "baselines": {"upos_accuracy": 0.8876, "chunk_f1": 0.6965},
}
MCFG = {
    "model_name": "fake/base",
    "lr_sweep": [2e-5, 5e-5],
    "dep_loss_weight": 1.0,
    "dep_loss_weight_sweep": [0.5, 1.0, 2.0],
    "seeds": [13, 42],
    "batch_size": 8,
    "epochs": 15,
    "early_stopping_patience": 3,
    "weight_decay": 0.01,
    "warmup_ratio": 0.1,
}


def dev(chunk: float, las: float) -> dict[str, float]:
    return {"upos_acc": 0.97, "chunk_f1": chunk, "uas": 0.9, "las": las}


# Dev results per (lr, λ, seed): 5e-5 wins the LR sweep; λ 2.0 wins on chunk+LAS;
# seed 42 is best on dev.
DEV = {
    (2e-5, 1.0, 13): dev(0.90, 0.80),
    (5e-5, 1.0, 13): dev(0.93, 0.85),
    (5e-5, 0.5, 13): dev(0.94, 0.80),
    (5e-5, 2.0, 13): dev(0.92, 0.90),
    (5e-5, 2.0, 42): dev(0.93, 0.91),
}


AUG_DEV: dict[tuple[float, float, int], dict[str, float]] = {}


class FakeRunner:
    def __init__(
        self,
        model: str,
        paths: dict[str, Path],
        status: Any,  # noqa: ANN401
        dry: bool,
        expected: dict[str, Any] | None = None,
        tag: str = "",
        head: str = "rel_pos",
    ) -> None:
        self.calls: list[tuple[float, float, int]] = []
        self.aug_calls: list[tuple[float, float, int]] = []
        self.tag = tag
        self.head = head
        FakeRunner.last = self

    def run_for(self, lr: float, w: float, seed: int, augment: bool = False) -> str:
        return rp.run_name(lr, w, seed, self.tag + ("aug" if augment else ""))

    def train(self, lr: float, w: float, seed: int, augment: bool = False) -> dict[str, Any] | None:
        (self.aug_calls if augment else self.calls).append((lr, w, seed))
        d = (AUG_DEV if augment else DEV).get((lr, w, seed))
        if d is None:
            return None
        return {"best_dev": d, "settings": {"seed": seed}, "epochs_run": 5, "train_seconds": 60.0}

    def evaluate(self, run: str, split: str) -> dict[str, Any]:
        seed = int(__import__("re").search(r"_s(\d+)", run).group(1))
        # Test deliberately prefers seed 13, which must not influence the choice.
        good = (seed == 13) if split == "test" else (seed == 42)
        m = {"upos_acc": 0.975, "chunk_f1": 0.95 if good else 0.90, "uas": 0.9, "las": 0.9}
        nested = {"tree_uas": 0.92, "tree_las": 0.90, "nested_f1": 0.85, "repaired_share": 0.01}
        return m | nested | {"tree_uas_no_punct": 0.94, "nested_multiword_f1": 0.89}

    def prune(self, keep: set[str]) -> list[str]:
        return []


@pytest.fixture
def patched(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Path]:
    monkeypatch.setattr(rp, "Runner", FakeRunner)
    monkeypatch.setattr(rp.yaml, "safe_load", lambda _text: MCFG)
    cfg_dir = tmp_path / "configs"
    cfg_dir.mkdir()
    (cfg_dir / "train_fake.yaml").write_text("x")
    monkeypatch.setattr(rp, "CONFIG_DIR", cfg_dir)
    return {"checkpoints": tmp_path / "ck", "eval": tmp_path / "ev", "logs": tmp_path / "lg"}


def test_run_name_matches_train_py() -> None:
    assert rp.run_name(5e-5, 1.0, 13) == "lr5e-05_w1_s13"
    assert rp.selection_score(dev(0.9, 0.8), ["chunk_f1", "las"]) == pytest.approx(0.85)


def test_stages_choose_by_dev_and_ignore_test(patched: dict[str, Path]) -> None:
    status = rp.Status(patched["logs"] / "s.json")
    rec = rp.run_model("fake", CFG, patched, status, dry=False)
    calls = FakeRunner.last.calls
    assert calls[:2] == [(2e-5, 1.0, 13), (5e-5, 1.0, 13)]  # LR sweep
    assert calls[2:5] == [(5e-5, 0.5, 13), (5e-5, 1.0, 13), (5e-5, 2.0, 13)]  # λ sweep at best LR
    assert rec["chosen"] == {"learning_rate": 5e-5, "dep_loss_weight": 2.0}
    assert set(rec["seeds"]) == {"lr5e-05_w2_s13", "lr5e-05_w2_s42"}
    assert rec["selected_run"] == "lr5e-05_w2_s42"  # best on dev, although test prefers seed 13
    assert (patched["eval"] / "fake" / "phase7.json").exists()


def test_stops_when_a_sweep_has_no_run(
    patched: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(FakeRunner, "train", lambda self, lr, w, s, augment=False: None)
    rec = rp.run_model("fake", CFG, patched, rp.Status(patched["logs"] / "s.json"), dry=False)
    assert "learning-rate sweep" in rec["error"]


def test_report_marks_offered_nested_and_failures(patched: dict[str, Path]) -> None:
    rec = rp.run_model("fake", CFG, patched, rp.Status(patched["logs"] / "s.json"), dry=False)
    weak = {"model": "weak", "base_model": "w", "error": "λ sweep produced no run"}
    text = rp.render_report([rec, weak], CFG)
    row = next(line for line in text.split("\n") if line.startswith("| fake |"))
    assert "| no |" not in row  # chunk F1 0.90 on the offered seed's test → not offered
    assert "**no**" in row
    assert "| weak | — |" in text and "**Stopped:** λ sweep produced no run." in text
    assert "mean ± sd" in text
    assert row.endswith("| pending Phase 8 |")  # UAS excl. punct 94 ≥ 93, multi-word F1 89 ≥ 88
    assert "97.00" not in text.split("## Summary")[0].split("Nested view")[1]  # no old UAS ≥ 97


def test_nested_view_verdict_uses_nested_view_targets() -> None:
    nv = CFG["acceptance"]["nested_view"]
    assert rp.nested_view_verdict({"tree_uas_no_punct": 0.94, "nested_multiword_f1": 0.89}, nv) == (
        "pending Phase 8"
    )
    assert (
        rp.nested_view_verdict({"tree_uas_no_punct": 0.92, "nested_multiword_f1": 0.95}, nv) == "no"
    )
    assert (
        rp.nested_view_verdict({"tree_uas_no_punct": 0.99, "nested_multiword_f1": 0.87}, nv) == "no"
    )
    # Records scored before the new metrics existed: no verdict, not a silent "no".
    assert rp.nested_view_verdict({"tree_uas": 0.99, "tree_las": 0.99}, nv) == "— (rescore)"


def test_cached_nested_scores_are_rescored_when_metrics_are_missing(tmp_path: Path) -> None:
    import json

    old, new = tmp_path / "old.json", tmp_path / "new.json"
    old.write_text(json.dumps({"tree_uas": 0.9, "nested_f1": 0.8}))
    new.write_text(json.dumps({"tree_uas_no_punct": 0.9, "nested_multiword_f1": 0.8}))
    assert not rp.has_nested_keys(old)
    assert rp.has_nested_keys(new)
    assert not rp.has_nested_keys(tmp_path / "missing.json")


def test_refresh_record_merges_current_nested_scores(tmp_path: Path) -> None:
    import json

    run_dir = tmp_path / "lr1_w1_s13"
    run_dir.mkdir()
    (run_dir / "test_nested.json").write_text(json.dumps({"nested_multiword_f1": 0.9}))
    rec = {
        "seeds": {"lr1_w1_s13": {"test": {"upos_acc": 0.97}, "dev": {"upos_acc": 0.96}}, "x": None}
    }
    out = rp.refresh_record(rec, tmp_path)
    assert out["seeds"]["lr1_w1_s13"]["test"] == {"upos_acc": 0.97, "nested_multiword_f1": 0.9}
    assert out["seeds"]["lr1_w1_s13"]["dev"] == {"upos_acc": 0.96}  # no dev_nested.json


def test_finished_runs_are_reused_only_with_matching_settings(tmp_path: Path) -> None:
    paths = {"checkpoints": tmp_path / "ck", "eval": tmp_path / "ev", "logs": tmp_path / "lg"}
    run_dir = paths["checkpoints"] / "m" / rp.run_name(5e-5, 1.0, 13)
    run_dir.mkdir(parents=True)
    summary = {"settings": {"batch_size": 32, "epochs": 10}, "best_dev": dev(0.9, 0.8)}
    (run_dir / "summary.json").write_text(__import__("json").dumps(summary))
    status = rp.Status(tmp_path / "s.json")
    same = rp.Runner("m", paths, status, dry=True, expected={"batch_size": 32, "epochs": 10})
    assert same.train(5e-5, 1.0, 13) == summary
    other = rp.Runner("m", paths, status, dry=True, expected={"batch_size": 8, "epochs": 15})
    assert other.train(5e-5, 1.0, 13) is None  # dry run: would retrain
    assert not run_dir.exists() and any(
        p.name.startswith(run_dir.name + ".stale-") for p in run_dir.parent.iterdir()
    )


def test_extended_stage_fixes_lambda_tags_runs_and_keeps_base_runs(
    patched: dict[str, Path],
) -> None:
    import json

    base = rp.run_model("fake", CFG, patched, rp.Status(patched["logs"] / "s.json"), dry=False)
    assert base["chosen"]["dep_loss_weight"] == 2.0
    stage = {"name": "extended", "tag": "e30", "fix_dep_weight": True, "record": "ext.json"}
    stage |= {"epochs": 30, "lr_sweep": [5e-5]}
    # Extended runs reuse the fake dev table: (5e-5, 2.0, seed) entries exist.
    rec = rp.run_model("fake", CFG, patched, rp.Status(patched["logs"] / "s.json"), False, stage)
    calls = FakeRunner.last.calls
    assert calls[0] == (5e-5, 2.0, 13)  # LR sweep at the fixed λ
    assert all(w == 2.0 for _, w, _ in calls)  # no λ sweep
    assert set(rec["seeds"]) == {"lr5e-05_w2_s13_e30", "lr5e-05_w2_s42_e30"}
    assert json.loads((patched["eval"] / "fake" / "ext.json").read_text())["stage"] == "extended"
    assert (patched["eval"] / "fake" / "phase7.json").exists()  # base record untouched


def test_in_stage() -> None:
    assert rp.in_stage("lr5e-05_w1_s13", "") and not rp.in_stage("lr5e-05_w1_s13_e30", "")
    assert rp.in_stage("lr5e-05_w1_s13_e30", "e30") and not rp.in_stage("smoke", "")
    assert not rp.in_stage("probe_bs8", "")


def test_status_file(tmp_path: Path) -> None:
    s = rp.Status(tmp_path / "status.json")
    s.update(state="running")
    s.append("finished", "a")
    data = (tmp_path / "status.json").read_text()
    assert '"state": "running"' in data and '"finished": [\n    "a"\n  ]' in data


@pytest.mark.parametrize(("aug_las", "used"), [(0.92, True), (0.85, False)])
def test_biaffine_stage_extra_rates_and_augmentation(
    patched: dict[str, Path], monkeypatch: pytest.MonkeyPatch, aug_las: float, used: bool
) -> None:
    rp.run_model("fake", CFG, patched, rp.Status(patched["logs"] / "s.json"), dry=False)  # base
    monkeypatch.setitem(AUG_DEV, (5e-5, 2.0, 13), dev(0.92, aug_las))
    monkeypatch.setitem(AUG_DEV, (5e-5, 2.0, 42), dev(0.93, 0.92))
    stage = {"name": "biaffine", "tag": "bf", "head": "biaffine", "fix_dep_weight": True}
    stage |= {"record": "bf.json", "lr_sweep": [2e-5], "lr_sweep_extra": {"fake": [5e-5]}}
    stage |= {"augmentation_experiment": True}
    monkeypatch.setitem(DEV, (2e-5, 2.0, 13), dev(0.90, 0.80))
    rec = rp.run_model("fake", CFG, patched, rp.Status(patched["logs"] / "s.json"), False, stage)
    runner = FakeRunner.last
    assert runner.head == "biaffine"
    assert runner.calls[:2] == [(2e-5, 2.0, 13), (5e-5, 2.0, 13)]  # sweep incl. the extra rate
    assert runner.aug_calls[0] == (5e-5, 2.0, 13)  # experiment at the best rate, first seed
    assert rec["augmentation"]["used"] is used
    assert rec["chosen"]["augment"] is used
    tag = "bfaug" if used else "bf"
    assert set(rec["seeds"]) == {f"lr5e-05_w2_s13_{tag}", f"lr5e-05_w2_s42_{tag}"}


def test_in_stage_counts_augmented_runs() -> None:
    assert rp.in_stage("lr5e-05_w1_s13_bfaug", "bf") and rp.in_stage("lr5e-05_w1_s13_bf", "bf")
    assert not rp.in_stage("lr5e-05_w1_s13_e30", "bf")
