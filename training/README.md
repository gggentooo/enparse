<!--
training/README.md — entry point for the offline model pipeline

Description:
  How to set up and run the Enparse tagger training pipeline. The full plan,
  phase order, and exit criteria are in dev_meta/plan-training.md; rules are
  in dev_meta/agents.md → Training code. Not shipped with the app.

Tasks:
  1. Phase 0: fill in setup commands (uv venv, pip install, npm install in js/).
  2. Add one run command per phase as scripts are implemented.
  3. Keep in sync with plan-training.md → Training directory layout.

Dependencies:
  System: macOS + Xcode CLT, uv, Python 3.12, Node.js 20+, git + git-lfs.
  Python: requirements.txt. Node: js/package.json.

Status: skeleton only; commands not written yet.
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

TODO(training-setup): written in Phase 0.

## Running

TODO(training-setup): one command per phase, added as scripts are implemented.
