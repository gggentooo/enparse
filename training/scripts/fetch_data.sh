#!/usr/bin/env sh
# =============================================================================
# training/scripts/fetch_data.sh — download UD treebanks at pinned versions
# =============================================================================
#
# Description:
#   Clones UD English EWT (and, if enabled, license-compatible GUM
#   subcorpora) at the pinned release tag into training/data/raw/, then
#   verifies the commit and file checksums against configs/data.yaml.
#
# Phase: 1 — Data acquisition and licensing.
#
# Behavior:
#   1. Reads repo URL, release tag, commit, files, and checksums from
#      configs/data.yaml (no hard-coded versions or paths).
#   2. Shallow-clones the tag into <paths.raw>/<dataset>/. Skips the clone
#      if that directory already holds the pinned commit (idempotent).
#   3. Commit: if data.yaml has `commit: null`, prints the resolved hash for
#      recording; otherwise fails on mismatch.
#   4. Checksums: SHA-256 of each listed file; `null` → printed for
#      recording; otherwise fails on mismatch.
#   5. GUM is fetched only if gum.enabled is true (Phase 1 decision: false).
#
# Dependencies:
#   System: git, shasum (macOS).
#   Python: training/.venv with pyyaml (reads data.yaml).
#   Reads:  configs/data.yaml (ud_ewt.*, gum.*, paths.raw).
#   Writes: data/raw/ (git-ignored).
#   Network: github.com (UniversalDependencies), development only.
#   License: UD EWT is CC BY-SA 4.0 — see MODEL_CARD.md for obligations.
#
# Usage (from training/):
#   sh scripts/fetch_data.sh
#
# Status: implemented (Phase 1).
# =============================================================================

set -eu

TRAINING_DIR=$(cd "$(dirname "$0")/.." && pwd)
CONFIG="$TRAINING_DIR/configs/data.yaml"
PYTHON="$TRAINING_DIR/.venv/bin/python"

if [ ! -x "$PYTHON" ]; then
  echo "error: $PYTHON not found; run the setup in training/README.md first" >&2
  exit 1
fi

# cfg <dotted.key> — print a scalar from data.yaml ("null" for None).
cfg() {
  "$PYTHON" -I -c '
import sys, yaml
value = yaml.safe_load(open(sys.argv[1]))
for part in sys.argv[2].split("."):
    value = value[part]
print("null" if value is None else str(value).lower() if isinstance(value, bool) else value)
' "$CONFIG" "$1"
}

# cfg_keys <dotted.key> — print the keys of a mapping, one per line.
cfg_keys() {
  "$PYTHON" -I -c '
import sys, yaml
value = yaml.safe_load(open(sys.argv[1]))
for part in sys.argv[2].split("."):
    value = value[part]
print("\n".join(value))
' "$CONFIG" "$1"
}

RAW_DIR="$TRAINING_DIR/$(cfg paths.raw)"
STATUS=0

# fetch <dataset key in data.yaml>
fetch() {
  key=$1
  url=$(cfg "$key.repo_url")
  tag=$(cfg "$key.release_tag")
  want_commit=$(cfg "$key.commit")
  dest="$RAW_DIR/$(cfg "$key.dir")"

  echo "== $key ($tag) -> $dest"

  if [ -d "$dest/.git" ]; then
    have_commit=$(git -C "$dest" rev-parse HEAD)
    if [ "$want_commit" != "null" ] && [ "$have_commit" != "$want_commit" ]; then
      echo "error: $dest is at $have_commit, expected $want_commit; delete it and rerun" >&2
      exit 1
    fi
    echo "   already cloned; skipping clone"
  else
    mkdir -p "$RAW_DIR"
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" "$url" "$dest"
  fi

  have_commit=$(git -C "$dest" rev-parse HEAD)
  if [ "$want_commit" = "null" ]; then
    echo "   commit: $have_commit  (record in data.yaml → $key.commit)"
    STATUS=2
  elif [ "$have_commit" != "$want_commit" ]; then
    echo "error: commit $have_commit does not match pinned $want_commit" >&2
    exit 1
  else
    echo "   commit: $have_commit  OK"
  fi

  for split in $(cfg_keys "$key.files"); do
    file="$dest/$(cfg "$key.files.$split")"
    if [ ! -f "$file" ]; then
      echo "error: missing $file" >&2
      exit 1
    fi
    have_sum=$(shasum -a 256 "$file" | cut -d' ' -f1)
    want_sum=$(cfg "$key.checksums.$split")
    if [ "$want_sum" = "null" ]; then
      echo "   $split: $have_sum  (record in data.yaml → $key.checksums.$split)"
      STATUS=2
    elif [ "$have_sum" != "$want_sum" ]; then
      echo "error: $split checksum $have_sum does not match pinned $want_sum" >&2
      exit 1
    else
      echo "   $split: OK"
    fi
  done
}

fetch ud_ewt

if [ "$(cfg gum.enabled)" = "true" ]; then
  # TODO(gum): per-subcorpus filtering is not implemented; GUM is disabled
  # (CC BY-NC-SA 4.0, see MODEL_CARD.md). Implement before enabling.
  echo "error: gum.enabled is true but subcorpus filtering is not implemented" >&2
  exit 1
fi

if [ "$STATUS" -eq 2 ]; then
  echo "Unpinned values printed above; record them in configs/data.yaml and rerun."
fi
exit "$STATUS"
