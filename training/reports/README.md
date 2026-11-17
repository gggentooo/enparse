<!--
training/reports/README.md — index of training reports

Description:
  Reports are small Markdown files committed to git (unlike data/).
  Each is produced by a script or by manual review in a specific phase.

Tasks:
  1. Keep this index in sync with the reports actually produced.
  2. Summarize key outcomes in plan-training.md as each phase exits.

Dependencies:
  Produced by: scripts/*.py, js/*.mjs, and manual review (see table).

Status: index only; no reports yet.
-->

# Training reports

| Report | Phase | Produced by |
|--------|-------|-------------|
| `chunks.md` | 2 | `scripts/derive_chunks.py` |
| `chunk_review.md` | 2 | `scripts/derive_chunks.py` (sample) + manual review |
| `alignment.md` | 3 | `js/align_tokens.mjs` |
| `dataset.md` | 4 | `scripts/prepare_data.py` |
| `baselines.md` | 5 | `js/evaluate_baselines.mjs` |
| `model_selection.md` | 6 | `scripts/train.py` + `scripts/evaluate.py` + `js/benchmark.mjs` |
| `training.md` | 7 | `scripts/train.py` + `scripts/evaluate.py` |
| `errors.md` | 7 | `scripts/evaluate.py` + manual grouping |
| `calibration.md` | 8 | `scripts/calibrate.py` |
| `parity.md` | 9 | `scripts/evaluate.py` + `js/benchmark.mjs` |
| `benchmark.md` | 10 | `js/benchmark.mjs` (Node) + browser test page (manual) |
