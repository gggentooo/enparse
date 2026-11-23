<!--
training/README.md — entry point for the offline model pipeline

Description:
  How to set up and run the Enparse tagger training pipeline. The full plan,
  phase order, and exit criteria are in dev_meta/plan-training.md; rules are
  in dev_meta/agents.md → Training code. Not shipped with the app.

Tasks:
  1. Phase 0: setup commands (done).
  2. Add one run command per phase as scripts are implemented.
  3. Keep in sync with plan-training.md → Training directory layout.

Dependencies:
  System: macOS + Xcode CLT, uv, Python 3.12, Node.js 20+, git + git-lfs.
  Python: requirements.txt. Node: js/package.json.

Status: setup written (Phase 0); run commands added per phase.
-->

# Enparse training pipeline

Offline pipeline that trains the two-group token classifier (`UPOS|CHUNK` + dependency heads) for each of the four candidate base models and packages the ones that meet the acceptance thresholds into `public/models/` (one folder per model plus `catalog.json`) for the app's model library.

- Plan and phases: [`dev_meta/plan-training.md`](../dev_meta/plan-training.md)
- Rules: [`dev_meta/agents.md`](../dev_meta/agents.md) → *Training code*

## Layout

| Path | Contents |
|------|----------|
| `configs/` | `data.yaml`, `eval.yaml`, `train_<model>.yaml` — all paths and settings |
| `data/` | Raw and processed data, checkpoints, logs, ONNX exports (git-ignored) |
| `scripts/` | Python and shell pipeline steps |
| `js/` | Node tools: alignment, baselines, Transformers.js benchmark; `bench-page/` browser benchmark (Phase 10) |
| `pyproject.toml` | `ruff` and `pytest` settings (no dependencies) |
| `.python-version` | Python 3.12 pin for `uv` |
| `tests/` | pytest for `derive_chunks.py` and `prepare_data.py` |
| `reports/` | Phase reports (see `reports/README.md`) |
| `MODEL_CARD.md` | Shipped model card |

## Setup

Requires macOS (Apple Silicon), Xcode CLT, `uv`, Node.js 20+, git-lfs. Run from `training/`:

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
(cd js && npm ci)
python scripts/check_env.py   # Phase 0 check: MPS + dummy run per candidate model
```

- Framework: Hugging Face `Trainer` on MPS (Unsloth unsupported; see `plan-training.md` → Phase 0).
- Lint and format: `ruff check scripts tests` and `ruff format scripts tests`.
- Updating Python pins: install or upgrade with `uv pip install`, rerun `check_env.py`, then regenerate the pin list in `requirements.txt` with `uv pip freeze` (keep the header).

## Running

Run from `training/` with the venv active.

| Phase | Command | Notes |
|-------|---------|-------|
| 1 | `sh scripts/fetch_data.sh` | Clones UD EWT at the tag in `configs/data.yaml` into `data/raw/`; verifies commit and SHA-256. Exit 2 = unpinned values printed for recording. |

| 2 | `python scripts/derive_chunks.py [--review]` | Writes `data/processed/chunked/*.conllu` (`Chunk=` in MISC) and `reports/chunks.md`; `--review` writes the 200-sentence dev sample (git-ignored). |
| 2 | `python -m pytest tests/test_derive_chunks.py` | Chunk rule tests. |

| 3 | `(cd js && npm run align)` | Runs the app's `preprocess()` + `tokenize()` via `tsx`; writes `data/processed/aligned/*.jsonl` and `reports/alignment.md`; exits non-zero if a split misses the agreement target or a tree is invalid. Needs the root `npm ci` (app code imports wink from the root `node_modules`). |
| 3 | `(cd js && npm test)` | Alignment unit tests (`node:test`). |

| 4 | `python scripts/prepare_data.py [--models <key> ...]` | Builds `data/processed/dataset/<model>/` (train/dev/test windows + `labels.json`) for each `configs/train_<key>.yaml`, and `reports/dataset.md`. |
| 4 | `python -m pytest tests/test_prepare_data.py` | Dataset tests (tokenizer tests use the local Hugging Face cache). |

| 5 | `(cd js && npm run baselines)` | wink-nlp and compromise on dev/test (Phase 3 words); writes `reports/baselines.md`. |

| 7 | `sh scripts/run_smoke.sh [model ...]` | Smoke test (task 0) for every candidate: `train.py --smoke` → `export_onnx.py --run smoke` → `js/benchmark.mjs --mode smoke`; writes `reports/smoke_test.md`. |
| 7 | `sh scripts/run_phase7_overnight.sh [model ...]` | Unattended Phase 7 (detached, `caffeinate`, resumable): sweeps, seeds, dev/test evaluation, `reports/training.md`. Progress: `data/logs/phase7_status.json`; stop: `kill "$(cat data/logs/phase7.pid)"`. Keep the Mac plugged in, lid open. |
| 7 | `python scripts/evaluate.py --model <m> --run <run> --split test` + `(cd js && npx tsx nested_eval.mjs --model <m> --run <run> --split test)` | Metrics and nested-phrase F1 for one run. |
| 7 | `python scripts/train.py --model <m> [--sweep lr\|dep_weight\|seeds] [--lr X --dep-weight Y --seed Z]` | Full training runs; best checkpoint per run in `data/checkpoints/<m>/<run>/best/` with `summary.json`; TensorBoard logs in each run folder. |
| 7, 9 | `python scripts/export_onnx.py --model <m> --run <run> [--parity-windows N\|all]` | ONNX export (fp32, int8, fp16) to `data/onnx/<m>/<run>/` with `labels.json` file checksums, reference and parity inputs. |
| 7, 9, 10 | `(cd js && npm run benchmark -- --model <m> --run <run> --mode smoke\|parity\|speed)` | Transformers.js (Node) load, tokenizer, parity, and speed checks; writes `benchmark_<mode>.json`. |

| Lite (T98) | `python scripts/prune_vocab.py` | Derives `deberta_v3_xsmall_lite` from Compact by vocabulary pruning (`configs/prune.yaml`): pruned checkpoint and tokenizer, re-encoded dev and test windows, `reports/prune.md`. Then run the usual steps on the new key: `evaluate.py` (dev, test), `nested_eval.mjs`, `calibrate.py --model … --run …`, `export_onnx.py --parity-windows all`, `npm run benchmark -- --mode parity`, `evaluate.py --parity --model … --run …` (the script header lists them). Tests: `python -m pytest tests/test_prune_vocab.py`. |
| 11 | `python scripts/package_models.py [--check]` | Packages the offered models into `../public/models/` (`labels.json` with `model_version` and checksums, `catalog.json`), writes `reports/release.md` and `data/release/integration/`; `--check` compares with the exports. Upload and deploy: `../PUBLISHING.md`. Tests: `python -m pytest tests/test_package_models.py`. |
| Dictionary (T70) | `python -m dictionary.fetch --pin` | Downloads missing dictionary sources (`configs/dictionary.yaml`; large files as parallel byte ranges) and checks or pins their SHA-256. |
| Dictionary (T70) | `python -m dictionary.extract` | Once per Wiktionary download: writes the pinned subset `data/raw/dictionary/wiktionary-subset.jsonl.gz` from the 3.2 GB kaikki.org extract (which may then be deleted). |
| Dictionary (T70) | `python -m dictionary.build` | Writes `data/dict/v1/` (manifest, index, 128 shards) and `reports/dictionary.md`; runs `js/dict_lemmas.mjs` (app `lookupKey` and wink lemmas) through `npx tsx`. Uploaded to R2 under `dict/v1/` by `npm run r2 -- upload` (`../PUBLISHING.md`). Format and attribution: `dictionary/DATA_CARD.md`. |
| Dictionary (T70) | `python -m pytest tests/test_dictionary.py` | Dictionary build tests. |

TODO(training-setup): commands for Phases 8, 11, added as scripts are implemented.
