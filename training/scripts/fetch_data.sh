#!/usr/bin/env sh
# =============================================================================
# training/scripts/fetch_data.sh — download UD treebanks at pinned versions
# =============================================================================
#
# Description:
#   Clones UD English EWT (and, if enabled, license-compatible GUM
#   subcorpora) at the pinned release tag into training/data/raw/, then
#   verifies file checksums against configs/data.yaml.
#
# Phase: 1 — Data acquisition and licensing.
#
# Tasks:
#   1. Read repo URL, release tag, and expected checksums from
#      configs/data.yaml (no hard-coded versions or paths).
#   2. Shallow-clone UD_English-EWT at the tag into data/raw/ud_ewt/.
#   3. Record the resolved commit hash (first run) or verify it (later runs).
#   4. Compute SHA-256 of train/dev/test .conllu files; on first run print
#      them for recording in data.yaml; on later runs fail on mismatch.
#   5. If gum.enabled, fetch only the subcorpora listed in data.yaml.
#   6. Be idempotent: skip clone if the pinned commit already exists.
#
# Dependencies:
#   System: git, git-lfs, shasum (macOS), a YAML reader (e.g., python -c with
#           pyyaml from the training venv).
#   Reads:  configs/data.yaml (ud_ewt.*, gum.*, paths.raw).
#   Writes: data/raw/ (git-ignored).
#   Network: github.com (UniversalDependencies), development only.
#   License: UD EWT is CC BY-SA 4.0 — see MODEL_CARD.md for obligations.
#
# Status: header only; not implemented.
# =============================================================================
