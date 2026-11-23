"""
training/scripts/package_models.py — package offered models and the model catalog

Description:
    Copies every model that meets the acceptance thresholds into
    public/models/<model-id>/ and writes public/models/catalog.json, the
    list the app's model library shows (src/modules/modelLibrary). Each
    catalog entry combines the texts in configs/catalog.yaml with measured
    facts: download sizes, test metrics (Phase 7), nested-view metrics
    (Phase 8), and browser speed (Phase 10).

Phase: 11 — Packaging and release (T66).

Run (from training/, venv active):
    python scripts/package_models.py            # package, check, write the release record
    python scripts/package_models.py --check    # only check public/models against the exports

Steps:
    1. For each model in configs/catalog.yaml (in order; the order is the app's
       preference order, the first offered model is the default; owner, T43):
       the selected run (data/eval/<id>/phase7_biaffine.json → selected_run),
       its test metrics (test_metrics.json), nested metrics (test_nested.json),
       gating (gating.json), and its export (data/onnx/<id>/<run>/).
    2. Offer a model only if test UPOS and chunk F1 meet configs/eval.yaml →
       acceptance; nested_view = true only if it meets acceptance.nested_view
       (UAS excl. punctuation, multi-word bracket F1, shown-bracket precision).
       Skipped models are reported with the reason.
    3. Copy the shipped files (labels.json → files: config and tokenizer files,
       onnx/model_quantized.onnx (int8), onnx/model_fp16.onnx) to
       public/models/<id>/ (unchanged files are not copied again) and write
       labels.json with model_version (catalog.yaml → release.version) and
       files (sizes and SHA-256 of the copied files). Every labels.json must
       pass validate_labels_json with no needed field null.
    4. Write public/models/catalog.json (schema v1; architecture.md → Model
       library) and remove model folders that are no longer offered.
    5. Write the integration reference per model (data/release/integration/<id>.json:
       the first Phase 9 parity windows covering 20 sentences, with the
       Transformers.js int8 outputs; read by
       src/modules/parser/packagedModels.test.ts) and the release record
       (reports/release.md: version, tag, commit, run, config, seed, data
       version, checksums; MODEL_CARD.md links to it).

Dependencies:
    Python: pyyaml. scripts/prepare_data.py (validate_labels_json).
    Reads:  configs/catalog.yaml, configs/eval.yaml, configs/data.yaml,
            configs/train_<id>.yaml; data/eval/<id>/; data/onnx/<id>/<run>/;
            data/bench/catalog_performance.json (Phase 10, js/bench_report.mjs).
    Writes: public/models/<id>/, public/models/catalog.json,
            data/release/integration/<id>.json, reports/release.md.
    Consumed by: the app (modules/modelLibrary, modules/parser); the R2 upload
            (scripts/r2.ts at the repository root; PUBLISHING.md).

Status: implemented (T66).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

TRAINING_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = TRAINING_DIR.parent
CONFIG_DIR = TRAINING_DIR / "configs"
OUT_DIR = REPO_DIR / "public" / "models"
REPORT = TRAINING_DIR / "reports" / "release.md"
INTEGRATION_DIR = TRAINING_DIR / "data" / "release" / "integration"
PERFORMANCE = TRAINING_DIR / "data" / "bench" / "catalog_performance.json"
VARIANT_FILES = {"int8": "onnx/model_quantized.onnx", "fp16": "onnx/model_fp16.onnx"}
CATALOG_SCHEMA = 1
INTEGRATION_SENTENCES = 20
# Needed labels.json fields that the export leaves null until calibration (Phase 8) and packaging.
NEEDED = ("calibration", "ambiguity", "nested")


def load_yaml(name: str) -> dict[str, Any]:
    with open(CONFIG_DIR / name, encoding="utf8") as f:
        return yaml.safe_load(f)


def load_json(path: Path) -> Any:  # noqa: ANN401 (any JSON value)
    with open(path, encoding="utf8") as f:
        return json.load(f)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def file_ref(folder: Path, rel: str) -> dict[str, Any]:
    path = folder / rel
    return {"file": rel, "bytes": path.stat().st_size, "sha256": sha256(path)}


def r4(x: float) -> float:
    return round(float(x), 4)


# -- selection ----------------------------------------------------------------------------


def acceptance(
    test: dict[str, Any], nested: dict[str, Any], gating: dict[str, Any], rules: dict[str, Any]
) -> tuple[bool, bool, list[str]]:
    """(offered, nested_view, reasons) for one model's test results."""
    reasons: list[str] = []
    if test["upos_acc"] < rules["min_upos_accuracy"]:
        reasons.append(f"UPOS {test['upos_acc']:.5f} < {rules['min_upos_accuracy']}")
    if test["chunk_f1"] < rules["min_chunk_f1"]:
        reasons.append(f"chunk F1 {test['chunk_f1']:.5f} < {rules['min_chunk_f1']}")
    nv = rules["nested_view"]
    shown = gating.get("test", {}).get("precision")
    nested_ok = (
        nested.get("tree_uas_no_punct", 0) >= nv["min_uas_no_punct"]
        and nested.get("nested_multiword_f1", 0) >= nv["min_bracket_f1"]
        and shown is not None
        and shown >= nv["min_shown_precision"]
    )
    return not reasons, nested_ok and not reasons, reasons


def metrics_entry(
    test: dict[str, Any], nested: dict[str, Any], gating: dict[str, Any]
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "upos": r4(test["upos_acc"]),
        "chunk_f1": r4(test["chunk_f1"]),
        "uas": r4(test["uas"]),
        "las": r4(test["las"]),
    }
    n: dict[str, float] = {}
    if "tree_uas_no_punct" in nested:
        n["uas_no_punct"] = r4(nested["tree_uas_no_punct"])
    if "nested_multiword_f1" in nested:
        n["bracket_f1"] = r4(nested["nested_multiword_f1"])
    if gating.get("test"):
        n["shown_precision"] = r4(gating["test"]["precision"])
        n["shown_coverage"] = r4(gating["test"]["coverage"])
    if gating.get("role", {}).get("test"):
        n["role_precision"] = r4(gating["role"]["test"]["precision"])
    if n:
        out["nested"] = n
    return out


# -- packaging ----------------------------------------------------------------------------


def copy_if_changed(src: Path, dst: Path) -> bool:
    """Copy src to dst unless dst already has the same size and SHA-256; True if copied."""
    if dst.exists() and dst.stat().st_size == src.stat().st_size and sha256(dst) == sha256(src):
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return True


def shipped_files(labels: dict[str, Any]) -> list[str]:
    """Files listed in the export's labels.json → files (labels.json itself excluded)."""
    files = labels.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("the export's labels.json has no files map (re-run export_onnx.py)")
    return sorted(files)


def packaged_labels(
    labels: dict[str, Any], version: str, folder: Path, files: list[str]
) -> dict[str, Any]:
    """labels.json as shipped: model_version and files (from the copied files) set."""
    out = dict(labels)
    out["model_version"] = version
    out["files"] = {
        rel: {k: v for k, v in file_ref(folder, rel).items() if k != "file"} for rel in files
    }
    return out


def check_labels(labels: dict[str, Any]) -> list[str]:
    sys.path.insert(0, str(TRAINING_DIR / "scripts"))
    from prepare_data import validate_labels_json

    problems = validate_labels_json(labels)
    for key in NEEDED:
        value = labels.get(key)
        if not isinstance(value, dict) or any(v is None for v in value.values()):
            problems.append(f"{key} has null fields (run calibrate.py)")
    if not labels.get("model_version"):
        problems.append("model_version is not set")
    return problems


def integration_reference(
    export: Path, labels: dict[str, Any], version: str, model_id: str
) -> dict[str, Any]:
    """First Phase 9 parity windows covering INTEGRATION_SENTENCES sentences (int8 outputs)."""
    with open(export / "parity_inputs.jsonl", encoding="utf8") as f:
        inputs = [json.loads(line) for line in f if line.strip()]
    with open(export / "js_predictions_int8.jsonl", encoding="utf8") as f:
        preds = [json.loads(line) for line in f if line.strip()]
    if len(inputs) != len(preds):
        raise ValueError("parity_inputs.jsonl and js_predictions_int8.jsonl differ in length")
    names = labels["labels"]
    windows: list[dict[str, Any]] = []
    total = 0
    for inp, pred in zip(inputs, preds, strict=True):
        if total >= INTEGRATION_SENTENCES:
            break
        sentences: list[dict[str, Any]] = []
        word_sent = inp["word_sent"]
        for s in sorted(set(word_sent)):
            idx = [i for i, ws in enumerate(word_sent) if ws == s]
            first = idx[0]
            sentences.append(
                {
                    "words": [inp["words"][i] for i in idx],
                    "labels": [names[pred["chunk_ids"][i]] for i in idx],
                    # window index → sentence index (-1 = root)
                    "heads": [
                        -1 if pred["heads"][i] < 0 else pred["heads"][i] - first for i in idx
                    ],
                }
            )
        windows.append({"sentences": sentences})
        total += len(sentences)
    return {
        "model_id": model_id,
        "model_version": version,
        "source": f"{export.relative_to(TRAINING_DIR)} "
        "(parity_inputs.jsonl, js_predictions_int8.jsonl)",
        "variant": "int8",
        "windows": windows,
    }


def git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=REPO_DIR, capture_output=True, text=True, check=True
        )
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return out.stdout.strip() + (" (working tree has uncommitted changes)" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def render_report(
    version: str, generated_at: str, rows: list[dict[str, Any]], skipped: list[str]
) -> str:
    lines = [
        "<!-- Generated by scripts/package_models.py (Phase 11, T66). Do not edit by hand. -->",
        "",
        f"# Release record — model-v{version}",
        "",
        f"- Model version: `{version}` (every packaged `labels.json` and `catalog.json` entry)",
        f"- Git tag (owner creates it when the release is committed): `model-v{version}`",
        f"- Packaged: {generated_at}",
        f"- Repository commit at packaging: `{git_commit()}`",
        "- Output: `public/models/` (catalog.json and one folder per model; "
        "uploaded to R2, PUBLISHING.md)",
        "",
        "## Offered models (preference order)",
        "",
        "| Model | Display name | Run | Seed | Config | Base model | Data | Nested view |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| `{r['id']}` | {r['display_name']} | `{r['run']}` | {r['seed']} "
            f"| `configs/train_{r['id']}.yaml` "
            f"(SHA-256 `{r['config_sha'][:12]}`) | `{r['base_model']}` | UD {r['ud']} | "
            f"{'yes' if r['nested_view'] else 'no'} |"
        )
    if skipped:
        lines += ["", "## Not offered", ""] + [f"- {s}" for s in skipped]
    lines += ["", "## Checksums (SHA-256)", ""]
    for r in rows:
        lines += [f"### `{r['id']}`", "", "| File | Bytes | SHA-256 |", "|---|---|---|"]
        for f in r["files"]:
            lines.append(f"| `{f['file']}` | {f['bytes']:,} | `{f['sha256']}` |")
        lines.append("")
    return "\n".join(lines)


def package(out_dir: Path, check_only: bool = False) -> int:
    catalog_cfg = load_yaml("catalog.yaml")
    rules = load_yaml("eval.yaml")["acceptance"]
    data_cfg = load_yaml("data.yaml")
    release = catalog_cfg["release"]
    version = str(release["version"])
    performance = load_json(PERFORMANCE) if PERFORMANCE.exists() else {}
    eval_dir = TRAINING_DIR / data_cfg["paths"]["eval"]
    onnx_dir = TRAINING_DIR / data_cfg["paths"]["onnx"]

    entries: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    skipped: list[str] = []
    problems: list[str] = []
    for model_id, texts in catalog_cfg["models"].items():
        record = eval_dir / model_id / "phase7_biaffine.json"
        if not record.exists():
            skipped.append(f"`{model_id}`: not trained (no {record.relative_to(TRAINING_DIR)})")
            continue
        phase7 = load_json(record)
        run = phase7["selected_run"]
        run_eval = eval_dir / model_id / run
        export = onnx_dir / model_id / run
        test = load_json(run_eval / "test_metrics.json")
        nested = (
            load_json(run_eval / "test_nested.json")
            if (run_eval / "test_nested.json").exists()
            else {}
        )
        gating = load_json(run_eval / "gating.json") if (run_eval / "gating.json").exists() else {}
        offered, nested_view, reasons = acceptance(test, nested, gating, rules)
        if not offered:
            skipped.append(f"`{model_id}` (`{run}`): " + "; ".join(reasons))
            continue
        if not (export / "labels.json").exists():
            skipped.append(
                f"`{model_id}` (`{run}`): no export in {export.relative_to(TRAINING_DIR)}"
            )
            continue
        for key in ("base_model_url", "base_model_license", "description_ko"):
            if not texts.get(key):
                problems.append(f"{model_id}: configs/catalog.yaml has no {key}")

        export_labels = load_json(export / "labels.json")
        files = shipped_files(export_labels)
        folder = out_dir / model_id
        if check_only:
            labels = load_json(folder / "labels.json") if (folder / "labels.json").exists() else {}
            for rel in files:
                if not (folder / rel).exists() or sha256(folder / rel) != sha256(export / rel):
                    problems.append(f"{model_id}: {rel} differs from the export")
        else:
            copied = [rel for rel in files if copy_if_changed(export / rel, folder / rel)]
            print(
                f"{model_id}: {len(copied)} of {len(files)} files copied from "
                f"{export.relative_to(TRAINING_DIR)}"
            )
            labels = packaged_labels(export_labels, version, folder, files)
            (folder / "labels.json").write_text(
                json.dumps(labels, ensure_ascii=False, indent=1) + "\n", "utf8"
            )
        problems += [f"{model_id}: labels.json: {p}" for p in check_labels(labels)]
        if labels.get("model_version") != version:
            problems.append(
                f"{model_id}: labels.json model_version "
                f"{labels.get('model_version')!r} != {version}"
            )
        if problems:
            continue

        variants = {
            name: file_ref(folder, rel)
            for name, rel in VARIANT_FILES.items()
            if (folder / rel).exists()
        }
        shared = [file_ref(folder, rel) for rel in files if rel not in VARIANT_FILES.values()]
        entry: dict[str, Any] = {
            "id": model_id,
            "display_name": texts["display_name"],
            "description": texts["description"],
            "description_ko": texts.get("description_ko", ""),
            "base_model": phase7["base_model"],
            "base_model_url": texts.get("base_model_url", ""),
            "base_model_license": texts.get("base_model_license", ""),
            "license": release["license"],
            "model_version": version,
            "folder": model_id,
            "labels": file_ref(folder, "labels.json"),
            "variants": variants,
            "shared_files": shared,
            "metrics": metrics_entry(test, nested, gating),
            "nested_view": nested_view,
        }
        for key in ("description_ko", "base_model_url", "base_model_license"):
            if not entry[key]:
                del entry[key]  # optional in catalog.json; an empty string is invalid
        if model_id in performance:
            entry["performance"] = {"parse_5000_chars_s": performance[model_id]}
        entries.append(entry)
        train_cfg = CONFIG_DIR / f"train_{model_id}.yaml"
        rows.append(
            {
                "id": model_id,
                "display_name": texts["display_name"],
                "run": run,
                "seed": phase7["seeds"].get(run, {}).get("seed", "?"),
                "config_sha": sha256(train_cfg) if train_cfg.exists() else "missing",
                "base_model": phase7["base_model"],
                "ud": f"{export_labels['versions']['data']['ud_release']} "
                f"(`{export_labels['versions']['data']['ud_commit'][:12]}`)",
                "nested_view": nested_view,
                "files": [entry["labels"], *variants.values(), *shared],
                "reference": integration_reference(export, labels, version, model_id),
            }
        )

    for s in skipped:
        print(f"not offered: {s}")
    if problems:
        for p in problems:
            print(f"error: {p}", file=sys.stderr)
        return 1
    if not entries:
        print("error: no model meets the acceptance thresholds", file=sys.stderr)
        return 1

    catalog_path = out_dir / "catalog.json"
    if check_only:
        current = load_json(catalog_path) if catalog_path.exists() else {"models": []}
        want = {e["id"]: e for e in entries}
        have = {e["id"]: e for e in current["models"]}
        if list(have) != list(want) or any(have[k] != want[k] for k in want):
            print("error: catalog.json is out of date (run without --check)", file=sys.stderr)
            return 1
        print(f"ok: {', '.join(want)} match the exports")
        return 0

    generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    catalog = {"schema_version": CATALOG_SCHEMA, "generated_at": generated_at, "models": entries}
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", "utf8")
    offered = {e["id"] for e in entries}
    for child in out_dir.iterdir():
        if child.is_dir() and child.name not in offered:
            shutil.rmtree(child)
            print(f"removed {child.relative_to(REPO_DIR)} (no longer offered)")
    INTEGRATION_DIR.mkdir(parents=True, exist_ok=True)
    for r in rows:
        (INTEGRATION_DIR / f"{r['id']}.json").write_text(
            json.dumps(r["reference"], ensure_ascii=False) + "\n", "utf8"
        )
    REPORT.write_text(render_report(version, generated_at, rows, skipped) + "\n", "utf8")
    print(
        f"wrote {catalog_path.relative_to(REPO_DIR)} ({', '.join(e['id'] for e in entries)}), "
        f"{REPORT.relative_to(REPO_DIR)}, {INTEGRATION_DIR.relative_to(REPO_DIR)}/"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--out", type=Path, default=OUT_DIR, help="output folder (default public/models)"
    )
    parser.add_argument(
        "--check", action="store_true", help="only check the output against the exports"
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    return package(args.out, check_only=args.check)


if __name__ == "__main__":
    sys.exit(main())
