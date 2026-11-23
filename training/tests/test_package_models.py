"""
training/tests/test_package_models.py — unit tests for scripts/package_models.py (Phase 11, T66)

Description:
    Acceptance decides offered models and the nested view; catalog metrics are
    rounded from the test results; packaged labels.json gets model_version and
    file checksums of the copied files; unchanged files are not copied again;
    the integration reference converts window heads to sentence heads; the
    shipped configs/catalog.yaml parses and names every offered model's base
    model license.

Status: implemented (T66).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml

from package_models import (
    CONFIG_DIR,
    acceptance,
    copy_if_changed,
    integration_reference,
    metrics_entry,
    packaged_labels,
)

RULES = {
    "min_upos_accuracy": 0.97,
    "min_chunk_f1": 0.94,
    "nested_view": {"min_uas_no_punct": 0.93, "min_bracket_f1": 0.88, "min_shown_precision": 0.95},
}
TEST = {"upos_acc": 0.9765, "chunk_f1": 0.9701, "uas": 0.94276, "las": 0.92448}
NESTED = {"tree_uas_no_punct": 0.94537, "nested_multiword_f1": 0.89038}
GATING = {
    "test": {"precision": 0.95720, "coverage": 0.66604},
    "role": {"test": {"precision": 0.95732}},
}


def test_acceptance_offers_models_that_meet_the_thresholds() -> None:
    assert acceptance(TEST, NESTED, GATING, RULES) == (True, True, [])
    offered, nested, reasons = acceptance({**TEST, "upos_acc": 0.96994}, NESTED, GATING, RULES)
    assert (offered, nested) == (False, False)
    assert reasons == ["UPOS 0.96994 < 0.97"]
    low_shown = {**GATING, "test": {"precision": 0.94, "coverage": 0.7}}
    assert acceptance(TEST, NESTED, low_shown, RULES) == (True, False, [])
    assert acceptance(TEST, {}, {}, RULES) == (True, False, [])


def test_metrics_entry_rounds_to_four_places() -> None:
    assert metrics_entry(TEST, NESTED, GATING) == {
        "upos": 0.9765,
        "chunk_f1": 0.9701,
        "uas": 0.9428,
        "las": 0.9245,
        "nested": {
            "uas_no_punct": 0.9454,
            "bracket_f1": 0.8904,
            "shown_precision": 0.9572,
            "shown_coverage": 0.666,
            "role_precision": 0.9573,
        },
    }
    assert "nested" not in metrics_entry(TEST, {}, {})


def test_packaged_labels_sets_version_and_checksums(tmp_path: Path) -> None:
    (tmp_path / "onnx").mkdir()
    (tmp_path / "config.json").write_text("{}")
    (tmp_path / "onnx" / "model_quantized.onnx").write_bytes(b"weights")
    labels = {"schema_version": 2, "model_version": None, "files": {"stale": {}}}
    out = packaged_labels(labels, "1.0.0", tmp_path, ["config.json", "onnx/model_quantized.onnx"])
    assert out["model_version"] == "1.0.0"
    assert out["files"] == {
        "config.json": {"bytes": 2, "sha256": hashlib.sha256(b"{}").hexdigest()},
        "onnx/model_quantized.onnx": {"bytes": 7, "sha256": hashlib.sha256(b"weights").hexdigest()},
    }
    assert labels["model_version"] is None  # the export's labels.json is not changed


def test_copy_if_changed_skips_identical_files(tmp_path: Path) -> None:
    src, dst = tmp_path / "a.bin", tmp_path / "out" / "a.bin"
    src.write_bytes(b"one")
    assert copy_if_changed(src, dst) is True
    assert copy_if_changed(src, dst) is False
    src.write_bytes(b"two")
    assert copy_if_changed(src, dst) is True
    assert dst.read_bytes() == b"two"


def test_integration_reference_uses_sentence_heads(tmp_path: Path, monkeypatch: object) -> None:
    import package_models

    monkeypatch.setattr(package_models, "TRAINING_DIR", tmp_path)  # type: ignore[attr-defined]
    monkeypatch.setattr(package_models, "INTEGRATION_SENTENCES", 2)  # type: ignore[attr-defined]
    window = {"words": ["Dogs", "bark", ".", "Cats", "sleep", "."], "word_sent": [0, 0, 0, 1, 1, 1]}
    pred = {"chunk_ids": [0, 1, 2, 0, 1, 2], "heads": [1, -1, 1, 4, -1, 4]}
    rows = [(window, pred)] * 3
    (tmp_path / "parity_inputs.jsonl").write_text("\n".join(json.dumps(w) for w, _ in rows))
    (tmp_path / "js_predictions_int8.jsonl").write_text("\n".join(json.dumps(p) for _, p in rows))
    labels = {"labels": ["NOUN|B-NP", "VERB|B-VP", "PUNCT|O"]}
    ref = integration_reference(tmp_path, labels, "1.0.0", "m")
    assert len(ref["windows"]) == 1  # stops once 2 sentences are covered
    first, second = ref["windows"][0]["sentences"]
    assert first == {
        "words": ["Dogs", "bark", "."],
        "labels": labels["labels"],
        "heads": [1, -1, 1],
    }
    assert second["heads"] == [1, -1, 1]


def test_catalog_yaml_parses_with_release_and_base_model_licenses() -> None:
    cfg = yaml.safe_load((CONFIG_DIR / "catalog.yaml").read_text("utf8"))
    assert cfg["release"]["version"]
    assert cfg["release"]["license"] == "CC BY-SA 4.0"
    for key in ("modernbert_base", "deberta_v3_xsmall"):
        entry = cfg["models"][key]
        assert entry["base_model_license"]
        assert entry["base_model_url"].startswith("https://")
        assert entry["description_ko"]
    assert list(cfg["models"])[:2] == ["modernbert_base", "deberta_v3_xsmall"]
