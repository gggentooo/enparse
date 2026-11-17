# Document Maintaining Guide

This guide applies to all contributors (human and AI) editing this file.

## Rules

1. **Direct edits.** Edits are made directly on the document. Existing content may be modified, reordered, or removed as needed.
2. **Changelog at bottom.** A 'Changelog' section must always exist at the bottom of the document. All changes made with each update are appended to the bottom of the changelog with a summary and timestamp. The [Author] field must be filled in with the username in the case of human contributors, and the model name in the case that an agent makes the update.
3. **Concise language.** Write in brief, clear English. Avoid unnecessary verbosity.
4. **Changelog format.** Each changelog entry must begin with a datetime stamp in ISO 8601 format (e.g., `2026-11-17T10:30:00Z`), followed by a bulleted list of what was added, modified, or removed.

## Format template

```md
## Changelog

## YYYY-MM-DDTHH:MM:SSZ — [Author], [Brief title]

- Added: ...
- Modified: ...
- Removed: ...
```

---

## Overview

- **Goal:** Train the Enparse parser model: a token classifier that labels each word with its UPOS tag and chunk tag (NP, VP, PP, ADJP, ADVP).
- **Output:** A quantized ONNX model loaded by `parser/transformerBackend.ts` via Transformers.js (see *Parsing engine* in `architecture.md`).
- **Priority:** Accuracy before speed. Runtime budget: ≤ ~5 s per 5,000 characters on a typical laptop.
- **Training machine:** MacBook Pro M5 Pro, 48 GB unified memory. Training uses the PyTorch MPS (Metal) backend.
- **Training framework:** Unsloth, with plain Hugging Face `Trainer` as fallback (see Phase 0).

### Key design decisions

- **Single combined-label head.** Each word gets one label `UPOS|CHUNK` (e.g., `NOUN|B-NP`). This is a standard `AutoModelForTokenClassification`, so Unsloth/`Trainer`, Optimum's `token-classification` export, and Transformers.js all work without custom code. UPOS and chunk probabilities are recovered by summing the combined-label probabilities.
  - A two-head model (separate UPOS and chunk outputs) is an optional experiment in Phase 7, only if the combined head underperforms.
- **Word unit = runtime word unit.** Training words must match the words wink-nlp produces at runtime (Phase 3).
- **Labels on first subword.** Only the first subword of each word carries a label; others are ignored in the loss (`-100`).
- **Multi-sentence context.** Training examples are windows of consecutive sentences from the same document, matching the runtime's overlapping context windows.
- **Cased models only.** Capitalization is a strong cue for proper nouns and sentence boundaries.

### Open questions

- **Acceptance thresholds:** minimum UPOS accuracy and chunk F1 to ship (proposed ≥ 97% / ≥ 94%). Tracked in `plan.md` → *Undecided*.
- **Training data license:** CC BY-SA 4.0 obligations for derived data and trained weights (Phase 1).
- **Download size cap:** proposed ≤ 80 MB for the shipped model file; affects base-model choice (Phase 6).
- **Extra data:** whether to add GUM (Phase 1) and learner-style noise augmentation (Phase 4).


---

## Prerequisites

### Hardware

- MacBook Pro M5 Pro, 48 GB memory. Sufficient for every candidate model; no cloud GPU needed.
- ~20 GB free disk space (datasets, checkpoints, ONNX exports).

### System software

| Tool | Purpose |
|------|---------|
| macOS (current release) + Xcode Command Line Tools | Compilers and Metal support for PyTorch MPS |
| Python 3.12 (managed with `uv`) | Training environment |
| Node.js 20+ | Tokenization alignment, JS baselines, Transformers.js benchmarks |
| git + git-lfs | Fetching UD treebanks and model weights; storing shipped model files in `public/models/` |
| Chrome, Safari, Firefox (current) | Browser benchmarks (WebGPU and WASM) |

### Python libraries (`training/requirements.txt`, versions pinned at setup)

| Library | Purpose |
|---------|---------|
| `torch` (MPS build) | Training backend |
| `unsloth` | Training acceleration and memory savings (if Phase 0 passes) |
| `transformers` | Models, tokenizers, `Trainer` |
| `datasets` | Dataset building and caching |
| `accelerate` | Device handling for `Trainer` |
| `conllu` | Parsing UD `.conllu` files |
| `seqeval` | CoNLL-style chunk precision/recall/F1 |
| `evaluate` | Metric helpers |
| `optimum[onnxruntime]` | ONNX export and quantization |
| `onnx`, `onnxruntime` | ONNX validation and parity checks |
| `numpy`, `pandas` | Data handling and reports |
| `tensorboard` | Local training logs (no external tracking service) |
| `pytest` | Tests for data conversion scripts |
| `pyyaml` | Reading `configs/*.yaml` |
| `ruff` | Format and lint (dev only) |

### Node libraries (`training/js/package.json`)

| Library | Purpose |
|---------|---------|
| `wink-nlp`, `wink-eng-lite-web-model` | Runtime tokenizer for alignment; fallback baseline |
| `compromise` | Comparison baseline |
| `@huggingface/transformers` (Transformers.js) | ONNX parity and speed tests outside the browser |
| `tsx` | Runs the app's TypeScript (e.g., `chunkPatterns.ts`) from Node scripts |
| `js-yaml` | Reading `../configs/*.yaml` |

### Data

| Dataset | License | Use |
|---------|---------|-----|
| UD English EWT (latest UD release, pinned tag) | CC BY-SA 4.0 | Primary train/dev/test data (~254k words, web text) |
| UD English GUM (optional) | Varies by subcorpus | Extra training data, if licenses allow |

### Base model candidates

Approximate shipped size at int8 ≈ 1 MB per million parameters.

| Model | License | Params | Approx. int8 size | Notes |
|-------|---------|--------|-------------------|-------|
| `distilbert-base-cased` | Apache 2.0 | ~65M | ~65 MB | Fast, well supported in Transformers.js |
| `microsoft/deberta-v3-xsmall` | MIT | ~70M | ~70 MB | Strong accuracy for its size |
| `bert-base-cased` | Apache 2.0 | ~110M | ~110 MB | Reference baseline; likely over size cap |
| `answerdotai/ModernBERT-base` | Apache 2.0 | ~150M | ~150 MB | Accuracy upper bound; over size cap unless the cap is raised |

---

## Training directory layout

```
training/
├── README.md (setup and run commands)
├── .gitignore (data/, weights, caches)
├── .python-version (3.12, used by uv)
├── pyproject.toml (ruff and pytest settings only; no dependencies)
├── requirements.txt
├── configs/
│   ├── data.yaml (UD release tag, paths, window size)
│   ├── eval.yaml (calibration, export, parity, benchmark settings) (proposed)
│   └── train_<model>.yaml (hyperparameters per candidate; one file per model)
├── data/ (git-ignored: raw UD files, processed datasets, checkpoints, ONNX exports)
├── scripts/
│   ├── check_env.py (Phase 0 MPS and Unsloth check) (proposed)
│   ├── fetch_data.sh
│   ├── derive_chunks.py (UD trees → chunk tags)
│   ├── prepare_data.py (labels, windows, splits)
│   ├── train.py
│   ├── calibrate.py
│   ├── export_onnx.py
│   └── evaluate.py
├── js/
│   ├── package.json
│   ├── align_tokens.mjs (wink tokenizer vs UD words)
│   ├── evaluate_baselines.mjs (wink + chunkPatterns, compromise)
│   ├── benchmark.mjs (Transformers.js speed and parity)
│   └── bench-page/ (minimal Vite page for Phase 10: index.html, bench.worker.mjs)
├── tests/ (pytest for derive_chunks and prepare_data; conftest.py)
├── reports/ (metrics, error samples, benchmark results; README.md index)
└── MODEL_CARD.md
```

---

## Phases

Each phase lists tasks, deliverables, and an exit criterion. Do not start a phase until the previous exit criterion is met.

### Phase pre-0 — Pre-flight check

Pre-flight review run on 2026-11-17 against the training machine and the repository. Everything below must be done before Phase 0 starts, except items in *Gates for later phases*, which must be done before the phase named.

**Machine check (2026-11-17)**

| Item | Required | Found | Status |
|------|----------|-------|--------|
| Hardware | M5 Pro, 48 GB | Apple M5 Pro, 48 GB, macOS 27.0.1 | Ready |
| Free disk | ~20 GB | ~595 GB | Ready |
| Xcode CLT | Installed | `/Library/Developer/CommandLineTools` | Ready |
| `uv` | Installed | 0.13.5 | Ready |
| Python 3.12 | Installed via `uv` | 3.12.15 (uv-managed); pinned by `training/.python-version` (global pyenv default stays 3.15.2) | Ready |
| Node.js | 20+ | 26.13.1, npm 11.20.0 | Ready |
| git-lfs | Installed and active | 3.8.1; LFS filter configured; `.gitattributes` patterns tracked. Repo hooks (`pre-push`) not installed | **To do** (owner: run `git lfs install` inside the repo) |
| Repository scaffold | `training/` layout | Created; all files are headers only | Ready |

**Tasks**
1. Install git-lfs and run `git lfs install` inside the repository so the LFS hooks are added; confirm `git lfs track` lists the patterns in `.gitattributes`. *Status: installed and tracking; repo hooks pending.*
2. Install Python 3.12 with `uv python install 3.12`. Pin it for `training/` with `training/.python-version`. *Status: done.*
3. Add `training/pyproject.toml` with `ruff` and `pytest` settings only; dependencies stay in `requirements.txt`. *Status: done.*
4. Confirm Unsloth support (open risk): check Unsloth's current docs for Apple Silicon (MPS) and encoder token-classification support. If neither is supported, plan for `Trainer` and keep Unsloth only as a Phase 0 check.
5. Owner: confirm the gate schedule below.

**Gates for later phases**

| Needed before | Item | Owner of decision | Tracked in |
|---------------|------|-------------------|------------|
| Phase 1 exit | CC BY-SA 4.0 position for derived data and trained weights (legal advice before commercial release); GUM decision | Owner | `plan.md` → *Training data licensing* |
| Phase 3 | `src/modules/parser/winkBackend.ts` tokenization implemented (alignment must match runtime); root `package.json` with pinned `wink-nlp` and `@huggingface/transformers` versions to mirror in `training/js/` | Dev | `architecture.md` |
| Phase 5 | `src/modules/parser/chunkPatterns.ts` implemented (run via `tsx`) | Owner (patterns), dev | `plan.md` → *Fallback chunk patterns* |
| Phase 6 | Model size cap | Owner | `plan.md` → *Model size cap* |
| Phase 7 exit | Acceptance thresholds (proposed ≥ 97% UPOS / ≥ 94% chunk F1) | Owner | `plan.md` → *Acceptance thresholds* |
| Phase 10 | Vite tooling set up in the app (bench page uses the same Vite version) | Dev | `plan.md` → *Tooling* |
| Phase 11 | Where the app shows attribution; `transformerBackend.ts` implemented for the integration test | Owner, dev | `plan.md` → *Attribution display* |

**Deliverables:** git-lfs active; Python 3.12 pinned for `training/`; Python tool config; Unsloth support note; confirmed gate schedule.
**Exit criterion:** every row in *Machine check* is Ready, tasks 1–4 are done, and the owner has confirmed the gate schedule.

### Phase 0 — Environment setup and tooling check

**Tasks**
1. Confirm Phase pre-0 is complete.
2. Create a `uv` virtual environment with Python 3.12 in `training/.venv`; install and pin `requirements.txt`. Install and pin `training/js/package.json` with npm (lockfile committed).
3. Confirm PyTorch sees MPS: `torch.backends.mps.is_available()` returns `True` (`scripts/check_env.py`).
4. **Unsloth check:** load `distilbert-base-cased` as a token-classification model through Unsloth on MPS and run 50 training steps on dummy labels.
   - Pass → use Unsloth for all training.
   - Fail (unsupported architecture, task, or device) → use Hugging Face `Trainer` directly. Note the outcome in this document.
5. Check Unsloth with `deberta-v3-xsmall`, `bert-base-cased`, and `ModernBERT-base` the same way.

**Deliverables:** pinned `requirements.txt` and `training/js` lockfile; a note in this document on which framework is used per model.
**Exit criterion:** a dummy training run completes on MPS for every candidate model.

### Phase 1 — Data acquisition and licensing

**Tasks**
1. `fetch_data.sh`: clone UD English EWT at a pinned release tag into `training/data/raw/`.
2. Record the release tag, commit hash, and file checksums in `configs/data.yaml`.
3. Review CC BY-SA 4.0 obligations:
   - Attribution text required in the app and in `MODEL_CARD.md`.
   - Whether share-alike applies to the derived chunk dataset (likely yes) and to trained weights (unsettled; get legal advice before commercial release).
4. Decide on GUM: check each subcorpus license; include only compatible ones.

**Deliverables:** raw data with pinned versions; a license summary in `MODEL_CARD.md`.
**Exit criterion:** license position recorded and accepted by the project owner.

### Phase 2 — Chunk derivation from UD trees

UD has dependency trees, not chunks. `derive_chunks.py` converts them to flat, non-recursive chunks in the style of the CoNLL-2000 standard.

**Rules (initial)**

| Chunk | Head | Includes | Excludes |
|-------|------|----------|----------|
| NP | `NOUN`, `PROPN`, `PRON`, `NUM` (nominal use) | Left dependents: `det`, `amod`, `nummod`, `compound`, `nmod:poss`, `flat`, `fixed` | Post-modifiers (PPs, relative clauses); these form their own chunks |
| VP | `VERB`, `AUX` (as predicate) | `aux`, `aux:pass`, `cop`, negation `advmod` (*not*) and `compound:prt` (phrasal-verb particle) if contiguous | Objects and complements |
| PP | `ADP` with `case` relation | Multiword prepositions (`fixed`, e.g. *because of*) | The NP that follows (separate chunk) |
| ADJP | `ADJ` not inside an NP | Left `advmod` (*very* happy) | — |
| ADVP | `ADV` not absorbed by VP or ADJP | Left `advmod` | — |
| O | Punctuation, conjunctions, other | — | — |

- Chunks must be contiguous; a non-contiguous span is split at the gap.
- Output BIO tags: `B-NP`, `I-NP`, …, `O`.

**Tasks**
1. Implement `derive_chunks.py` with the rules above.
2. Unit tests (`tests/`) for ~30 hand-written sentences covering each rule and edge cases (coordination, possessives, phrasal verbs, passives, questions).
3. Manual review: sample 200 dev sentences; mark errors; fix rules; repeat until the error rate is < 2% of chunks.
4. Report chunk-type distribution per split in `reports/chunks.md`.

**Deliverables:** `derive_chunks.py`, tests, review log.
**Exit criterion:** tests pass; manual review error rate < 2%.

### Phase 3 — Tokenization alignment with runtime

At runtime, wink-nlp splits text into words before the model runs. Training words must match.

**Tasks**
1. `align_tokens.mjs`: tokenize each EWT sentence's raw text (`# text =` line) with wink-nlp; align to UD words.
2. Handle UD multiword tokens (e.g., *don't* → *do* + *n't*): use the form that matches wink's split.
3. Measure word-level agreement. For mismatches, add mapping rules (merge or split) and define how labels transfer.
4. Store the final word segmentation in the processed dataset, so training uses wink-style words.

**Deliverables:** alignment script, mismatch report (`reports/alignment.md`), mapping rules.
**Exit criterion:** ≥ 99.5% of words align; remaining mismatches documented.

### Phase 4 — Dataset building

**Tasks**
1. `prepare_data.py`: combine UPOS and chunk tags into `UPOS|CHUNK` labels; build the label map; drop label combinations seen < 5 times in train and map them to the nearest valid label.
2. Build windows: consecutive sentences from the same document (`# newdoc id`) packed up to 256 subword tokens (same window size as the runtime), with sentence boundaries kept. Long single sentences are split at 256 with 32-token overlap.
3. Subword alignment: label the first subword of each word; set the rest to `-100`.
4. Keep the official EWT train/dev/test splits. Test is used only in Phase 7 final evaluation.
5. Optional augmentation (train split only, ≤ 15% of windows): lowercase sentence starts, drop final punctuation, common learner typos. Evaluate the effect in Phase 7; keep only if dev F1 does not drop.
6. Save processed datasets with `datasets` to `training/data/processed/`.

**Deliverables:** processed datasets, `labels.json` (label map), dataset statistics report.
**Exit criterion:** dataset loads; label and window statistics reviewed.

### Phase 5 — Baseline evaluation

Sets the bar the model must beat.

**Tasks**
1. `evaluate_baselines.mjs`: run wink-nlp + `chunkPatterns.ts` and compromise on the EWT dev and test splits using the Phase 3 word segmentation.
2. Map each baseline's tags to UPOS and chunk tags; report UPOS accuracy and chunk F1 (overall and per type).

**Deliverables:** `reports/baselines.md`.
**Exit criterion:** baseline numbers recorded.

### Phase 6 — Base model selection

**Tasks**
1. Short training run (3 epochs, default hyperparameters) for each candidate on the same data and seed.
2. Record on dev: UPOS accuracy, chunk F1, training time, and approximate int8 size.
3. Quick ONNX export and Transformers.js timing for each (see Phase 10 method) to confirm the size and speed budgets.
4. Pick the model with the best dev chunk F1 that meets the size cap and speed budget.

**Deliverables:** `reports/model_selection.md`.
**Exit criterion:** one base model chosen and recorded here.

### Phase 7 — Full training and tuning

**Starting hyperparameters**

| Setting | Value |
|---------|-------|
| Learning rate | 5e-5 (sweep 2e-5, 3e-5, 5e-5, 1e-4) |
| Schedule | Linear decay, 10% warmup |
| Batch size | 32 windows (gradient accumulation if needed) |
| Epochs | Up to 10, early stopping on dev chunk F1 (patience 2) |
| Weight decay | 0.01 |
| Max sequence length | 256 subword tokens |
| Precision | fp32 on MPS (switch to bf16 only if stable and faster) |
| Seeds | 3 seeds for the final configuration; report mean and spread |

**Tasks**
1. `train.py` with configs from `configs/train_<model>.yaml`; log to TensorBoard.
2. Learning-rate sweep; then the final run with 3 seeds; keep the best checkpoint by dev chunk F1.
3. Optional experiments, kept only if they improve dev F1: augmentation (Phase 4, task 5), GUM data, two-head model.
4. Final evaluation on the test split, run once: UPOS accuracy, chunk F1 overall and per type, comparison with Phase 5 baselines.
5. Error analysis: 100 test errors grouped by type (e.g., noun/verb homographs, PP chunks, coordination) in `reports/errors.md`.

**Deliverables:** best checkpoint, `reports/training.md`, `reports/errors.md`.
**Exit criterion:** test metrics meet the acceptance thresholds and beat both baselines.

### Phase 8 — Calibration and ambiguity threshold

Alternatives at runtime are built from label probabilities, so the probabilities must be reliable.

**Tasks**
1. `calibrate.py`: fit a single temperature on dev logits; report expected calibration error before and after.
2. Tune the ambiguity margin (proposed 0.2): for each margin, measure on dev how often the correct label is in the alternatives versus the average number of alternatives per sentence.
3. Pick the margin that best balances coverage and a cap of 5 alternatives per sentence.
4. Store temperature and margin in `labels.json`.

**Deliverables:** calibration report; updated `labels.json`.
**Exit criterion:** calibration error reduced; margin chosen and recorded in `architecture.md`.

### Phase 9 — ONNX export and quantization

**Tasks**
1. `export_onnx.py`: export with Optimum (`token-classification` task) in the folder layout Transformers.js expects (`config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model.onnx`).
2. Produce variants: int8 dynamic quantization (`onnx/model_quantized.onnx`, for WASM) and fp16 (`onnx/model_fp16.onnx`, for WebGPU).
3. Parity check (`benchmark.mjs` + `evaluate.py`):
   - fp32 ONNX vs PyTorch: ≥ 99.9% label agreement on dev.
   - int8 and fp16: chunk F1 drop ≤ 0.3 points vs fp32.
4. If int8 fails parity, try excluding sensitive layers (e.g., embeddings, classifier) from quantization.

**Deliverables:** ONNX files; parity report.
**Exit criterion:** both variants pass parity.

### Phase 10 — Browser benchmarking

**Tasks**
1. Build the minimal Vite test page in `training/js/bench-page/` that loads the model with Transformers.js in a Web Worker and parses a fixed 5,000-character sample.
2. Measure in Chrome, Safari, and Firefox, with WebGPU (where available) and WASM:
   - First load time (download + initialization), cached load time.
   - Parse time for 5,000 characters (median of 10 runs).
   - Peak memory.
3. Test on at least one lower-end device (e.g., older laptop or recent phone) to set fallback-mode rules.

**Deliverables:** `reports/benchmark.md`.
**Exit criterion:** ≤ 5 s per 5,000 characters on a typical laptop with WASM; fallback rules defined for devices that miss it.

### Phase 11 — Packaging and release

**Tasks**
1. Copy the exported files to `public/models/enparse-tagger/` (ONNX files tracked with Git LFS) with `labels.json` (label map, temperature, margin, model version, training data version).
2. Write `MODEL_CARD.md`: base model, data and licenses, attribution text, metrics, known weaknesses, intended use.
3. Tag the release (e.g., `model-v1.0.0`); record config, seed, data version, and checksums for reproducibility.
4. Integration test in the app: `transformerBackend.ts` loads the model and matches Phase 9 outputs on 20 fixed sentences.

**Deliverables:** shipped model files, model card, release tag.
**Exit criterion:** app integration test passes.

### Phase 12 — Maintenance (ongoing)

- Optional: collect misparsed sentences reported in the app (opt-in, stored locally until exported by the user) as a regression set. Requires a new app feature; not yet planned.
- Retrain when: a new UD release fixes relevant annotations, the regression set grows past ~200 sentences, or a better base model fits the budget.
- Every retrain repeats Phases 7–11 and must not regress on the test split or the regression set.

---

## Changelog

## 2026-11-17T02:03:03Z — Claude Opus 5.5, Created training plan

- Added: Document Maintaining Guide (same as `plan.md` and `architecture.md`).
- Added: Overview, key design decisions, and open questions.
- Added: Prerequisites (hardware, system software, Python and Node libraries, data, base model candidates).
- Added: `training/` directory layout.
- Added: Phases 0–12 with tasks, deliverables, and exit criteria.

## 2026-11-17T02:57:39Z — Claude Opus 5.5, Scaffolded training/ directory

- Added: `training/` scaffold matching the layout; every file has a header (description, phase, tasks, dependencies). No code yet.
- Added (proposed): `configs/eval.yaml` (post-training thresholds out of scripts), `scripts/check_env.py` (Phase 0 check), `tests/conftest.py`.
- Added: `training/README.md`, `training/.gitignore`, `reports/README.md`, `MODEL_CARD.md` skeleton; one `train_<model>.yaml` per candidate.
- Modified: *Training directory layout* lists the new files.

## 2026-11-17T03:31:22Z — Claude Opus 5.5, Unified window size; added dependencies

- Modified: Phase 4 states that training and runtime windows are both 256 subword tokens.
- Added: `pyyaml` and `ruff` to Python libraries; `tsx` and `js-yaml` to Node libraries (`tsx` runs TypeScript files in Node).

## 2026-11-17T04:00:45Z — Claude Opus 5.5, Pre-flight check (Phase pre-0)

- Added: *Phase pre-0 — Pre-flight check* with machine check results, tasks (git-lfs, Python 3.12, tool config, Unsloth support check), and gates for later phases.
- Added: open question on the Phase 10 browser benchmark page location.
- Modified: Phase 0 — tool installation moved to Phase pre-0; task 2 now also pins `training/js`; task 5 now includes `bert-base-cased` (exit criterion covers every candidate).
- Modified: git-lfs purpose and Phase 11 task 1 note that shipped ONNX files are tracked with Git LFS.
- Modified: `pyyaml`, `ruff`, `js-yaml` approved by owner; proposed marks removed.

## 2026-11-17T04:21:52Z — Claude Opus 5.5, Pre-0 progress; bench page and tool config

- Added: `training/pyproject.toml` (ruff and pytest settings, owner-approved), `training/.python-version` (3.12), `training/js/bench-page/` (`index.html`, `bench.worker.mjs` headers) to layout.
- Modified: Phase pre-0 machine check — Python 3.12 (3.12.15) ready; git-lfs 3.8.1 installed, repo hooks pending; tasks 2–3 done.
- Modified: Phase 10 task 1 uses `training/js/bench-page/` (owner decision).
- Removed: open question and gate row for the bench page location (decided); hosting-limit check from the Phase 6 gate (deferred by owner).
