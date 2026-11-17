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

Status: Phase 1 sections filled (training data, licenses, attribution); others pending.
-->

# Model Card — enparse-tagger

## Model summary

## Base model and license

## Training data and licenses

| Dataset | Version | License | Used |
|---------|---------|---------|------|
| UD English EWT | UD r2.19, commit `6b021622f3ab7902730f313fa5955a8b8cdd52b8` | CC BY-SA 4.0 | Yes: train 12,544 / dev 2,001 / test 2,077 sentences (204,578 / 25,148 / 25,094 words) |
| UD English GUM | UD r2.19 | CC BY-NC-SA 4.0 (whole release) | No: non-commercial terms are not allowed (`agents.md` → *Dependency policy*) |

Checksums: `configs/data.yaml` → `ud_ewt.checksums`.

### CC BY-SA 4.0 obligations (UD EWT)

Summary for engineering, not legal advice.

| Artifact | Adapted Material? | Obligation |
|----------|-------------------|------------|
| Raw EWT files | No (redistribution) | Not redistributed; stay in git-ignored `training/data/`. |
| Derived chunk tags and processed datasets (Phases 2–4) | Yes | If shared: license under CC BY-SA 4.0 (or compatible), give attribution, state changes. Not shared for now (git-ignored). |
| Trained weights (`public/models/enparse-tagger/`) | Unsettled | Whether weights are Adapted Material is not settled in law. Working position (owner-accepted 2026-11-18): treat weights as CC BY-SA 4.0 derived material, ship them under CC BY-SA 4.0 with attribution. Legal advice required before commercial release. |
| App source code | No | Not affected by share-alike; the model files are separate files with their own license. |

- Attribution must name the creator, copyright notice, license with link, link to the source, and that the material was modified (Section 3(a)).
- No additional terms or technical measures may restrict reuse of shared Adapted Material (Section 3(b)(3)).
- Underlying EWT texts come from the LDC English Web Treebank; portions © Google, Yahoo!, UPenn, and others. The UD license covers annotations and database rights; the shipped model contains no source text.

## Attribution

## Attribution

Text shown in the app (location: `plan.md` → *Attribution display*) and here. Keep both identical.

> This model was trained on the Universal Dependencies English Web Treebank (UD English EWT, release 2.19), annotations © 2013–2021 The Board of Trustees of The Leland Stanford Junior University, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Source: https://github.com/UniversalDependencies/UD_English-EWT. Changes: chunk tags were derived from the dependency trees, words were re-segmented to match wink-nlp, and the data was used to train a token classifier. The model files are shared under CC BY-SA 4.0.

## Labels

## Metrics

## Calibration and ambiguity

## Export and quantization

## Performance

## Known weaknesses

## Intended use

## Reproducibility
