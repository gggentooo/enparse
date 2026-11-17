<!--
training/MODEL_CARD.md — model card for the Enparse tagger (enparse-tagger)

Description:
  Public record of the shipped parser model: base model, data sources and
  licenses, attribution, metrics, known weaknesses, and intended use.
  Required by agents.md → Dependency policy (record source, license, and
  version for every dataset and model).

Phases:
  1  — license summary and attribution text (UD EWT CC BY-SA 4.0; GUM if used).
  6  — chosen base model and its license.
  7  — metrics (UPOS accuracy, chunk F1 overall/per type, mean ± spread over 3 seeds).
  8  — calibration temperature and ambiguity margin.
  9  — quantization variants and parity results.
  10 — browser performance summary.
  11 — release tag, config, seed, data version, checksums.

Tasks:
  1. Fill each section below as its phase completes.
  2. Keep attribution text identical to the in-app attribution.
  3. Update on every retrain (Phase 12).

Dependencies:
  Sources: configs/data.yaml, configs/train_<model>.yaml, configs/eval.yaml,
           reports/*.md, public/models/enparse-tagger/labels.json.

Status: skeleton only; no content yet.
-->

# Model Card — enparse-tagger

## Model summary

## Base model and license

## Training data and licenses

## Attribution

## Labels

## Metrics

## Calibration and ambiguity

## Export and quantization

## Performance

## Known weaknesses

## Intended use

## Reproducibility
