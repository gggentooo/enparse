#!/usr/bin/env sh
# =============================================================================
# training/scripts/run_smoke.sh — Phase 7 task 0: smoke test for every candidate
# =============================================================================
#
# Description:
#   For each configs/train_<model>.yaml: 1-epoch training on a small subset
#   (train.py --smoke), ONNX export (export_onnx.py --run smoke), and the
#   Transformers.js check (js/benchmark.mjs --mode smoke). A failing model does
#   not stop the others. Then writes reports/smoke_test.md (smoke_report.py).
#
# Usage (from training/, venv active):  sh scripts/run_smoke.sh [--biaffine] [model ...]
#
# Dependencies: training/.venv (python), Node.js; training/js and root
#   node_modules installed (npm ci in both).
#
# Status: implemented (Phase 7 pre-work). Not yet run.
# =============================================================================

set -u
TRAINING_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$TRAINING_DIR"
PYTHON="$TRAINING_DIR/.venv/bin/python"

# --biaffine (first argument): biaffine head (T05); run name smoke_bf, report smoke_test_biaffine.md.
HEAD_ARGS=""; RUN=smoke; REPORT_ARGS=""
if [ "${1:-}" = "--biaffine" ]; then
  HEAD_ARGS="--head biaffine"; RUN=smoke_bf; REPORT_ARGS="--biaffine"; shift
fi

if [ "$#" -gt 0 ]; then
  MODELS="$*"
else
  MODELS=$(ls configs/train_*.yaml | sed 's#configs/train_##; s#\.yaml$##')
fi

for m in $MODELS; do
  echo "=== $m"
  # shellcheck disable=SC2086
  "$PYTHON" scripts/train.py --model "$m" --smoke $HEAD_ARGS || { echo "$m: train failed"; continue; }
  "$PYTHON" scripts/export_onnx.py --model "$m" --run "$RUN" || { echo "$m: export failed"; continue; }
  (cd js && node benchmark.mjs --model "$m" --run "$RUN" --mode smoke) || echo "$m: benchmark failed"
done
# shellcheck disable=SC2086
"$PYTHON" scripts/smoke_report.py $REPORT_ARGS
