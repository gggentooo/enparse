#!/usr/bin/env sh
# =============================================================================
# training/scripts/run_phase7_overnight.sh — start Phase 7 detached, for an unattended night
# =============================================================================
#
# Description:
#   Pre-flight checks (AC power, free disk, Node and Python dependencies), then
#   starts scripts/run_phase7.py detached from the terminal (nohup) under
#   `caffeinate -i -s` so the Mac does not idle- or system-sleep while it runs.
#   Survives closing the terminal or Claude Code. Resumable: running this again
#   after a crash or reboot continues where it stopped.
#
# Usage (from training/):  sh scripts/run_phase7_overnight.sh [model ...]
# Progress:  cat data/logs/phase7_status.json ; tail -f data/logs/phase7_main.log
# Stop:      kill "$(cat data/logs/phase7.pid)"
#
# Keep the Mac plugged in. With the lid closed, macOS sleeps anyway unless an
# external display is connected (clamshell mode), so leave the lid open.
#
# Status: implemented (Phase 7).
# =============================================================================

set -eu
TRAINING_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$TRAINING_DIR"
PYTHON="$TRAINING_DIR/.venv/bin/python"
LOGS="$TRAINING_DIR/data/logs"
mkdir -p "$LOGS"

if [ -f "$LOGS/phase7.pid" ] && kill -0 "$(cat "$LOGS/phase7.pid")" 2>/dev/null; then
  echo "Phase 7 is already running (pid $(cat "$LOGS/phase7.pid"))."; exit 1
fi
if ! pmset -g batt | grep -q "AC Power"; then
  echo "error: not on AC power; plug in the Mac first." >&2; exit 1
fi
FREE_GB=$(df -g "$TRAINING_DIR" | awk 'NR==2 {print $4}')
if [ "$FREE_GB" -lt 40 ]; then
  echo "error: only ${FREE_GB} GB free; Phase 7 needs about 40 GB." >&2; exit 1
fi
[ -d js/node_modules ] && [ -d ../node_modules ] || { echo "error: run npm ci in training/js and the repo root." >&2; exit 1; }
"$PYTHON" -c "import torch, transformers; assert torch.backends.mps.is_available()" || { echo "error: MPS not available." >&2; exit 1; }

nohup caffeinate -i -s "$PYTHON" scripts/run_phase7.py ${1+"$@"} >> "$LOGS/phase7_main.log" 2>&1 &
echo $! > "$LOGS/phase7.pid"
echo "Phase 7 started (pid $!). Log: $LOGS/phase7_main.log  Status: $LOGS/phase7_status.json"
