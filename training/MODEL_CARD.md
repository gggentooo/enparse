<!--
training/MODEL_CARD.md — model card for the Enparse tagger models (model library)

Description:
  Public record of the shipped parser model: base model, data sources and
  licenses, attribution, metrics, known weaknesses, and intended use.
  Required by agents.md → Dependency policy (record source, license, and
  version for every dataset and model).

Phases:
  1  — license summary and attribution text (UD EWT CC BY-SA 4.0; GUM if used).
  7  — per offered model: base model and license, test metrics.
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
           reports/*.md, public/models/catalog.json, public/models/<model-id>/labels.json.

Status: complete for release model-v1.0.0 (T66, 2026-11-23); update on every retrain.
-->

# Model Card — Enparse tagger models

## Model summary

Enparse parses English text in the browser for Korean learners of English: for each word a part of speech (UD UPOS) and a phrase chunk (NP, VP, PP, ADJP, ADVP), and for each sentence a dependency tree (head and relation per word) from which the app builds the nested phrase view. Release **model-v1.0.0** offers two models (catalog order = the app's preference order; owner, T43):

| Model id | Name in the app | Base model | Role | Download (int8 / fp16) |
|---|---|---|---|---|
| `modernbert_base` | Large | `answerdotai/ModernBERT-base` | Default | 156 MB / 302 MB |
| `deberta_v3_xsmall` | Compact | `microsoft/deberta-v3-xsmall` | Backup when Large does not run well (e.g. no WebGPU) | 90 MB / 144 MB |

Each model is the base encoder fine-tuned with a token-classification head (group A: 78 combined `UPOS|CHUNK` labels; relations: 45 labels) and a biaffine arc scorer (`scripts/biaffine.py`, `labels.json` schema v2, `dep_encoding: biaffine_v1`). int8 runs on WebAssembly, fp16 on WebGPU; both are in the release.

Not offered (below the UPOS threshold 97.00 on test): DistilBERT (96.82), BERT-base-cased (96.995). Release record with runs, seeds, configs, and checksums: [`reports/release.md`](reports/release.md).

## Base model and license

| Base model | Source | License | Trained model files |
|---|---|---|---|
| ModernBERT-base | https://huggingface.co/answerdotai/ModernBERT-base | Apache 2.0 | CC BY-SA 4.0 |
| DeBERTa-v3-xsmall | https://huggingface.co/microsoft/deberta-v3-xsmall | MIT | CC BY-SA 4.0 |

The base-model licenses permit fine-tuning and redistribution with their notices; the trained files are shared under CC BY-SA 4.0 because of the training data (below). `public/models/catalog.json` carries both licenses per model (`base_model_license`, `license`), and the app's About page shows them.

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
| Trained weights (`public/models/<model-id>/`, every offered model) | Unsettled | Whether weights are Adapted Material is not settled in law. Working position (owner-accepted 2026-11-18): treat weights as CC BY-SA 4.0 derived material, ship them under CC BY-SA 4.0 with attribution. Legal advice required before commercial release. |
| App source code | No | Not affected by share-alike; the model files are separate files with their own license. |

- Attribution must name the creator, copyright notice, license with link, link to the source, and that the material was modified (Section 3(a)).
- No additional terms or technical measures may restrict reuse of shared Adapted Material (Section 3(b)(3)).
- Underlying EWT texts come from the LDC English Web Treebank; portions © Google, Yahoo!, UPenn, and others. The UD license covers annotations and database rights; the shipped model contains no source text.

## Attribution

Text shown in the app (*About & licenses*, `#/about`: `src/components/Pages/AboutPage.tsx`; T21/T50) and here. Keep both identical (`AboutPage.test.tsx` checks it).

> This model was trained on the Universal Dependencies English Web Treebank (UD English EWT, release 2.19), annotations © 2013–2021 The Board of Trustees of The Leland Stanford Junior University, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Source: https://github.com/UniversalDependencies/UD_English-EWT. Changes: chunk tags were derived from the dependency trees, words were re-segmented to match wink-nlp, and the data was used to train a token classifier. The model files are shared under CC BY-SA 4.0.

## Labels

Two label groups per word, predicted together (`plan-training.md` → *Nested phrase structure*):

| Group | Labels | Meaning |
|-------|--------|---------|
| A | 78 `UPOS\|CHUNK` | UPOS tag and BIO chunk (NP, VP, PP, ADJP, ADVP) |
| B | 45 relations | UD relation of the word to its head (head from the arc scorer) |

Since the biaffine retrain (T05/T51; schema v2), group B is the dependency relation alone (45 labels: UD base relations plus 10 kept subtypes), and the head comes from the arc scorer (`arc_scores`, one row per word over its sentence plus root). Label sets built from EWT train (labels seen < 5 times merged; `label_merges` in `labels.json`; `reports/dataset_arc.md`).

## Metrics

UD English EWT r2.19 **test** split (2,077 sentences, 25,094 words), the dev-selected seed (42) of the biaffine stage. UAS without punctuation and bracket F1 are on the decoded tree (`test_nested.json`); the app decodes projectively (T83), which changes test UAS by +0.08 (Large) and +0.03 (Compact). Sources: `data/eval/<model>/<run>/test_metrics.json`, `test_nested.json`, `gating.json`; `reports/training_biaffine.md`, `reports/calibration.md`.

| Metric | Large (ModernBERT) | Compact (DeBERTa-v3-xsmall) | Acceptance |
|---|---|---|---|
| UPOS accuracy | 97.40 | 97.65 | ≥ 97.00 |
| Chunk F1 (NP/VP/PP/ADJP/ADVP) | 96.47 | 97.01 | ≥ 94.00 |
| UAS / LAS (all words; best head per word, before tree decoding) | 94.15 / 92.31 | 94.27 / 92.45 | — |
| UAS without punctuation (nested view) | 94.38 | 94.54 | ≥ 93.00 |
| Multi-word labeled bracket F1 (nested view) | 89.14 | 89.04 | ≥ 88.00 |
| Shown-bracket precision / coverage (after gating) | 95.64 / 68.0% | 95.72 / 66.6% | precision ≥ 95.00 |
| Role precision (after gating) | 95.87 | 95.73 | — |

Both models beat the baselines (UPOS: wink-nlp 88.76; chunk F1: compromise 69.65). Seed spread (3 seeds) ≤ 0.2 points (`reports/training_biaffine.md`). Per-type chunk F1 (Compact): NP 96.67, VP 98.48, PP 98.54, ADVP 93.59, ADJP 92.16.

## Calibration and ambiguity

Temperatures fitted on dev (Phase 8; `labels.json` → `calibration`, `ambiguity`, `nested`):

| Model | T (labels / relations / arcs) | Test ECE after (%) | Margin / attachment margin | Bracket threshold | Role threshold |
|---|---|---|---|---|---|
| Large | 2.05 / 2.28 / 9.39 | 0.64 / 0.70 / 1.67 | 0.3 / 0.3 | 0.80 | 0.4 |
| Compact | 1.78 / 1.99 / 5.57 | 0.61 / 0.73 / 0.41 | 0.4 / 0.3 | 0.85 | 0.3 |

Brackets below the threshold are not drawn (or drawn dashed when they are the pinned subject or predicate); alternatives are offered when the top two readings are within the margin.

## Export and quantization

ONNX opset 18 (Optimum), checked in Node with Transformers.js 4.3.2 against PyTorch on every dev window (Phase 9; `reports/parity.md`):

| Model | Variant | Size | Agreement A / rel / head | Δ chunk F1 | Δ LAS |
|---|---|---|---|---|---|
| Large | int8 (per-channel, arc scorer fp32) | 156 MB | 99.69 / 99.62 / 99.41% | +0.13 | +0.02 |
| Large | fp16 (fp32 inputs/outputs) | 302 MB | 99.99 / 100 / 99.98% | 0.00 | 0.00 |
| Compact | int8 | 90 MB | 99.81 / 99.78 / 99.78% | −0.04 | −0.05 |
| Compact | fp16 | 144 MB | 99.99 / 99.99 / 100% | −0.01 | −0.01 |

Word encoding `plain` for both (`labels.json` → `tokenizer_word_encoding`). The packaged files reproduce the Phase 9 int8 outputs exactly on 20 test sentences (`src/modules/parser/packagedModels.test.ts`).

## Performance

Seconds to parse 5,000 characters, slowest browser of Chrome and Safari on the development machine (Phase 10; `data/bench/catalog_performance.json`):

| Model | WASM, many threads | WASM, 2 cores | WASM, 1 thread | WebGPU (fp16) |
|---|---|---|---|---|
| Large | 1.48 | 5.17 | 4.91 | 0.28 |
| Compact | 0.42 | 1.34 | 1.22 | 0.52 |

Cold load 1.2–1.8 s, warm load 0.8–1.3 s; peak memory growth 1.2–2.9 GB depending on model and variant. On a 4 GB / 2-vCPU Windows VM, Compact int8 parsed in 1.34 s and Large int8 in 5.17 s; fp16 needs WebGPU with `shader-f16`.

## Known weaknesses

- **Domain:** trained and tested only on UD EWT (web text: reviews, emails, forums, blogs, news groups). Learner writing, textbooks, literary and academic text are not measured.
- **Proper nouns:** PROPN vs NOUN is the largest UPOS error group (31–37% of UPOS errors), then adjective vs noun/verb (15–18%).
- **Attachment:** most tree errors are clause and modifier attachment (for example where a prepositional phrase or relative clause attaches); about half are shared by every model. Ambiguous PP attachments are offered as alternatives.
- **Chunk boundaries:** NP boundaries are 42–48% of chunk errors (split or joined).
- **Nested view coverage:** with the precision target, about a third of brackets are not drawn (below the bracket threshold).
- **Devices:** Large on WASM with two cores or one thread is near or over the 5-second budget on slower devices; the app recommends Compact there.
- The two models can choose different readings of the same sentence; neither is right in every case.

## Intended use

- **For:** learners and teachers reading English text in the Enparse app (parts of speech, phrases, and sentence structure as a study aid), on the user's own device. No text leaves the device.
- **Not for:** grading, assessment, or any decision about a person; legal, medical, or safety-critical text processing; languages other than English.
- Outputs are probabilistic: the app shows uncertainty (dashed brackets, alternatives, near-tie readings), and users should treat the parse as a hint.

## Reproducibility

- Release **model-v1.0.0**, packaged 2026-11-23 by `scripts/package_models.py` (T66) from the runs `modernbert_base/lr0.0002_w1_s42_bfaug` and `deberta_v3_xsmall/lr0.0003_w2_s42_bf` (seed 42, biaffine stage, `configs/train_<model>.yaml`, `configs/eval.yaml`); data UD EWT r2.19 commit `6b021622f3ab7902730f313fa5955a8b8cdd52b8` (`configs/data.yaml` → checksums); wink-nlp 2.4.0, wink-eng-lite-web-model 1.8.1.
- Every shipped file's size and SHA-256: [`reports/release.md`](reports/release.md) (also in each `labels.json` → `files` and in `catalog.json`).
- Git tag `model-v1.0.0` marks the commit that contains the release (created by the owner when the release is committed).
- To rebuild: Phases 4 → 7 (`run_phase7.py --stage biaffine`) → 8 (`calibrate.py`) → 9 (`export_onnx.py`, `js/benchmark.mjs --mode parity`) → 11 (`package_models.py`); see `README.md` → Commands.
