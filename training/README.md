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

Offline pipeline that trains the `UPOS|CHUNK` token classifier and exports it to `public/models/enparse-tagger/`.

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

TODO(training-setup): commands for Phases 5–11, added as scripts are implemented.
