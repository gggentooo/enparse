# Enparse Parser Training Plan

## Document Maintaining Guide

This guide applies to all contributors (human and AI) editing this file.

### Rules

1. **Direct edits.** Edits are made directly on the document. Existing content may be modified, reordered, or removed as needed.
2. **Changelog at bottom.** A 'Changelog' section must always exist at the bottom of the document. All changes made with each update are appended to the bottom of the changelog with a summary and timestamp. The [Author] field must be filled in with the username in the case of human contributors, and the model name in the case that an agent makes the update.
3. **Concise language.** Write in brief, clear English. Avoid unnecessary verbosity.
4. **Changelog format.** Each changelog entry must begin with a datetime stamp in ISO 8601 format (e.g., `2026-11-17T10:30:00Z`), followed by a bulleted list of what was added, modified, or removed.

### Format template

```md
## Changelog

### YYYY-MM-DDTHH:MM:SSZ — [Author], [Brief title]

- Added: ...
- Modified: ...
- Removed: ...
```

---

## Overview

- **Goal:** Train the Enparse parser model: a token classifier that gives each word two outputs in one pass:
  - **Flat output:** UPOS tag and chunk tag (NP, VP, PP, ADJP, ADVP).
  - **Structure output:** the word's dependency head and relation. The nested phrase view is built from it (see *Nested phrase structure*).
- **Output:** A quantized ONNX model loaded by `parser/transformerBackend.ts` via Transformers.js (see *Parsing engine* in `architecture.md`).
- **Priority:** Accuracy before speed. Runtime budget: ≤ ~5 s per 5,000 characters on a typical laptop.
- **Training machine:** MacBook Pro M5 Pro, 48 GB unified memory. Training uses the PyTorch MPS (Metal) backend.
- **Training framework:** Hugging Face `Trainer` on MPS for every candidate. Unsloth was ruled out in Phase 0.

### Key design decisions

- **Two label groups, one classifier.** Each word gets two labels, predicted together:
  - Group A: `UPOS|CHUNK` (e.g., `NOUN|B-NP`). UPOS and chunk probabilities are recovered by summing group-A probabilities.
  - Group B: dependency head and relation, encoded as a word label (see *Nested phrase structure*).
  - The model is a standard `AutoModelForTokenClassification` whose classifier has `|A| + |B|` outputs. One linear layer with `|A| + |B|` outputs is the same as two linear heads side by side. Training applies a separate softmax and cross-entropy loss to each slice (custom `compute_loss`). `Trainer`, Optimum's `token-classification` export, and Transformers.js work unchanged.
  - Why one packed `logits` output: Transformers.js `*ForTokenClassification` classes keep only the `logits` output and drop any other ONNX outputs (checked in `@huggingface/transformers` 4.3.2, `TokenClassifierOutput`). Separate outputs would need a custom export and a custom runtime model class.
  - `labels.json` records where each group's slice starts and ends (Phase 4 schema).
- **Word unit = runtime word unit.** Training words must match the words wink-nlp produces at runtime (Phase 3).
- **Labels on first subword.** Only the first subword of each word carries a label; others are ignored in the loss (`-100`).
- **Partial labels.** Words without a checked label (e.g., unreviewed words in user feedback) also get `-100`, so the loss uses only labels a person or the treebank confirmed (Phase 4).
- **Traceable outputs.** `labels.json` has a fixed, versioned schema (Phase 4), and the app's `ParseResult` carries the model version and wink word offsets (Phase 11), so any parse, including user feedback, can be traced to the model and word split that produced it.
- **Multi-sentence context.** Training examples are windows of consecutive sentences from the same document, matching the runtime's overlapping context windows.
- **Cased models only.** Capitalization is a strong cue for proper nouns and sentence boundaries.
- **No rule-based nesting.** The nested phrase view comes from the model's structure output, not from hand-written rules. The only runtime step is deterministic decoding (`parser/treeDecoder.ts`, below).

### Nested phrase structure

Confirmed by owner (2026-11-18): two views, bracketing order, and phrase labels as below. The nested view ships only if test UAS ≥ 97% and LAS ≥ 94%; otherwise the app ships without it (the flat view is unaffected).

The app shows two views of each sentence:

| View | Example: *The red dog rarely barks loudly.* | Source |
|------|---------------------------------------------|--------|
| Flat phrases | `[NP The red dog] [ADVP rarely] [VP barks] [ADVP loudly] .` | Group A (chunk tags) |
| Nested phrases | `[[The [red [dog]]] [rarely [[barks] loudly]]] .` | Group B (dependency tree) |

- **Training data:** EWT already contains gold dependency trees. No new annotation is needed; the Phase 2 chunked files keep `HEAD` and `DEPREL`.
- **Head encoding:** relative-POS encoding from dependency parsing as sequence labeling (Strzyż et al., 2019). Each word's label is `<offset>@<head UPOS>|<relation>`; for example, `+1@NOUN|amod` means "head is the next NOUN to the right; relation amod". The root is `0@ROOT|root`. Base relations only; subtypes such as `nmod:poss` are dropped from group B. They stay in the data and still drive the Phase 2 chunk rules. Decoding uses group A's predicted UPOS to find the head.
- **Decoding (`parser/treeDecoder.ts`):** turns group-B labels into a tree, then into nested phrases.
  1. Read each word's head from its label. If a head cannot be found or makes a cycle, use the next-best label for that word. If that fails too, attach the word to the root.
  2. Exactly one root per sentence: if several, keep the most probable one and attach the others to it.
  3. Build phrases head-outward: right dependents first (closest first), then left dependents (closest first). Each step adds one nesting level, which gives `[The [red [dog]]]` and `[rarely [[barks] loudly]]`.
  4. Punctuation is not bracketed; it is shown at the level of its head.
  5. Each phrase is labeled from its head word (noun → NP, verb → VP, adjective → ADJP, adverb → ADVP; a noun phrase with a `case` dependent → PP).
- **Why decoding is still needed:** a neural network outputs scores for each word, not brackets. Turning per-word head labels into a valid tree and then into brackets is a fixed procedure (like BIO decoding for chunks). It holds no grammar rules, so it is not a separate nesting module.
- **Flat and nested views can differ:** the views use different conventions (for example, `[NP the man] [PP in] [NP the car]` versus `[the [[man] [in [the [car]]]]]`). Both are shown as-is; the UI does not force one to match the other.
- **Fallback mode:** wink-nlp has no dependency parser, so the nested view is unavailable in basic mode.
- **Expected accuracy:** sequence-labeling parsers on EWT score slightly below biaffine parsers, and small models score lower than large ones. Actual UAS/LAS come from Phase 7. If they miss the thresholds (UAS 97% / LAS 94%), try a biaffine head in Phase 7 (needs a custom export and runtime model class); if that also misses, ship without the nested view.

### Open questions

- **Acceptance thresholds:** minimum UPOS accuracy and chunk F1 to ship (proposed ≥ 97% / ≥ 94%). Tracked in `plan.md` → *Undecided*.
- **Download size cap:** proposed ≤ 80 MB for the shipped model file; affects base-model choice (Phase 6).
- **Extra data:** learner-style noise augmentation (Phase 4). No extra treebanks for now (owner, 2026-11-18): GUM excluded (Phase 1, non-commercial); other CC BY-SA UD English treebanks (ESLSpok, CHILDES, Atis) and the Penn Treebank (LDC license, conversion needed) were considered and dropped.


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
| `transformers` | Models, tokenizers, `Trainer` |
| `datasets` | Dataset building and caching |
| `accelerate` | Device handling for `Trainer` |
| `conllu` | Parsing UD `.conllu` files |
| `seqeval` | CoNLL-style chunk precision/recall/F1 |
| `evaluate` | Metric helpers |
| `optimum`, `optimum-onnx` | ONNX export (exporter is in `optimum-onnx` since Optimum 2) and quantization |
| `onnx`, `onnxruntime` | ONNX validation and parity checks |
| `numpy`, `pandas` | Data handling and reports |
| `tensorboard` | Local training logs (no external tracking service) |
| `pytest` | Tests for data conversion scripts |
| `pyyaml` | Reading `configs/*.yaml` |
| `sentencepiece`, `protobuf` | DeBERTa-v3 tokenizer loading and fast-tokenizer conversion |
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
| UD English GUM | CC BY-NC-SA 4.0 (UD release) | Not used (non-commercial; Phase 1) |

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
│   ├── package.json (scripts: align, test)
│   ├── align_tokens.mjs (runtime words vs UD words; Phase 3)
│   ├── lib/ (conllu.mjs reader, align.mjs label transfer; Phase 3)
│   ├── tests/ (node:test unit tests, e.g. align.test.mjs)
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
| git-lfs | Installed and active | 3.8.1; LFS filter configured; `.gitattributes` patterns tracked; repo hooks installed (checked 2026-11-18) | Ready |
| Repository scaffold | `training/` layout | Created; all files are headers only | Ready |

**Tasks**
1. Install git-lfs and run `git lfs install` inside the repository so the LFS hooks are added; confirm `git lfs track` lists the patterns in `.gitattributes`. *Status: done.*
2. Install Python 3.12 with `uv python install 3.12`. Pin it for `training/` with `training/.python-version`. *Status: done.*
3. Add `training/pyproject.toml` with `ruff` and `pytest` settings only; dependencies stay in `requirements.txt`. *Status: done.*
4. Confirm Unsloth support (open risk): check Unsloth's current docs for Apple Silicon (MPS) and encoder token-classification support. If neither is supported, plan for `Trainer` and keep Unsloth only as a Phase 0 check. *Status: done, will use Huggingface Trainer.*
5. Owner: confirm the gate schedule below. *Status: done.*

**Gates for later phases**

| Needed before | Item | Owner of decision | Tracked in |
|---------------|------|-------------------|------------|
| Phase 1 exit | CC BY-SA 4.0 position for derived data and trained weights (legal advice before commercial release); GUM decision | Owner | Done: Phase 1 *Outcome* |
| Phase 3 | `src/modules/parser/winkBackend.ts` tokenization and `src/modules/input/textInput.ts` preprocessing implemented (alignment runs them via `tsx`); root `package.json` pins the same `wink-nlp` and `@huggingface/transformers` versions as `training/js/` | Dev | Done 2026-11-18 (Phase 3 *Pre-flight check 2*) |
| Phase 5 | `src/modules/parser/chunkPatterns.ts` implemented (run via `tsx`) | Owner (patterns), dev | `plan.md` → *Fallback chunk patterns* |
| Phase 6 | Model size cap | Owner | `plan.md` → *Model size cap* |
| Phase 7 | `src/modules/parser/treeDecoder.ts` implemented (nested-phrase F1 runs it via `tsx`) | Dev | `architecture.md` → *Logic modules* |
| Phase 7 exit | Acceptance thresholds (proposed ≥ 97% UPOS / ≥ 94% chunk F1) | Owner | `plan.md` → *Acceptance thresholds*. Nested view thresholds decided: UAS ≥ 97%, LAS ≥ 94% |
| Phase 10 | Vite tooling set up in the app (bench page uses the same Vite version) | Dev | Done 2026-11-18: Vite 8.3.8 in root and `training/js` |
| Phase 4 exit | `LabelConfig` in `src/modules/parser/types.ts` matches `labels.json` schema v1 | Dev | Done 2026-11-18 (Phase 4 *Outcome*) |
| Phase 11 | Where the app shows attribution; `transformerBackend.ts` implemented for the integration test; `ParseResult` carries model version and wink word offsets | Owner, dev | `plan.md` → *Attribution display*; `architecture.md` → *Model* |

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

**Outcome (2026-11-18): exit criterion met.**

- Environment: Python 3.12.15, torch 2.15.0 (MPS available), transformers 4.57.6. Full pin list in `requirements.txt`; `training/js/package-lock.json` committed.
- `scripts/check_env.py`: 50 steps, batch 8, 10 dummy labels, length 256, fp32, no `PYTORCH_ENABLE_MPS_FALLBACK` (settings in `configs/eval.yaml` → `env_check`).
- Unsloth 2026.11.6 (throwaway venv): on macOS, `FastModel.from_pretrained` goes to the MLX backend, not PyTorch MPS, and failed for every model. Its dependency `unsloth-zoo` is LGPL-3.0-or-later, which the dependency policy does not allow. Unsloth is not in `requirements.txt`.

| Model | Framework | Dummy run (HF `Trainer`, MPS) |
|-------|-----------|-------------------------------|
| `distilbert-base-cased` | `hf_trainer` | Pass, 7.2 s |
| `microsoft/deberta-v3-xsmall` | `hf_trainer` | Pass, 13.2 s |
| `bert-base-cased` | `hf_trainer` | Pass, 15.6 s |
| `answerdotai/ModernBERT-base` | `hf_trainer` | Pass, 21.2 s |

- Notes for later phases:
  - DeBERTa-v3: the fast-tokenizer conversion warns that byte fallback is not supported. Check unknown-token rates in Phase 3 and parity in Phase 9.
  - `training/js` versions were picked here (`wink-nlp` 2.4.0, `@huggingface/transformers` 4.3.2). The root `package.json` must use the same versions (Phase 3 gate).
  - Some npm dev dependencies are not under a permissive license: `sharp-libvips` (LGPL-3.0, via Transformers.js, Node image support) and `lightningcss` (MPL-2.0, via Vite). They are not shipped. Accepted by owner (2026-11-18): weak-copyleft transitive dependencies that are never shipped in the app bundle are allowed (`agents.md` → *Dependency policy*).
  - npm 11 blocked install scripts (`onnxruntime-node`, `esbuild`, `protobufjs`). All packages still load in Node without them.
  - `js-yaml` 5 has no default export. Use `import * as yaml from "js-yaml"`.

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

**Outcome (2026-11-18): exit criterion met (owner accepted the license position and GUM exclusion).**

- `fetch_data.sh` implemented: reads `configs/data.yaml`, shallow-clones the tag, verifies commit and SHA-256 (idempotent; exit 2 if values are unpinned).
- UD English EWT pinned at `r2.19` (latest UD release), commit `6b021622f3ab7902730f313fa5955a8b8cdd52b8`. Checksums for train/dev/test and `LICENSE.txt` in `data.yaml`.
- Size: train 12,544 / dev 2,001 / test 2,077 sentences; 204,578 / 25,148 / 25,094 words.
- License summary and attribution text in `MODEL_CARD.md`. Position (owner-accepted):
  - Raw and derived data are not redistributed (git-ignored).
  - Trained weights are treated as CC BY-SA 4.0 derived material and shipped under CC BY-SA 4.0 with attribution. Legal advice before commercial release.
- GUM: excluded (owner decision). The UD r2.19 release is CC BY-NC-SA 4.0 as a whole (per-text sources vary: wikiHow and fiction are BY-NC-SA). `gum.enabled: false`.

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

**Rule details (added during the Phase 2 review; owner-accepted 2026-11-18)**

| Area | Detail |
|------|--------|
| NP heads | Also: DET used as a pronoun (`all`, `some`); ADJ with `det`/`nmod:poss`/`case` dependent or as subject/object (`the same`, `Most of them`); VERB with `det` (`the following`); SYM with nominal dependents or role (`$ 5`, `50 %`). |
| NP members | Possessor's own left modifiers and `'s` (`my brother 's friend`); right-adjacent `nummod` (`$ 5`); adjacent `nmod:unmarked` (dates and times: `October 4th`, `05:09 PM`); `nmod:desc` right before the head (`President Putin`); left `advmod` of a NUM head (`more than 200`); `else` after a pronoun; adverbs between pre-modifiers (`a largely Sunni clan`). |
| NP coordination | Coordinated pre-modifiers stay in one NP with their `cc` (`red and blue cars`, `any and all info`). Coordinated heads are separate NPs (`[NP cats] and [NP dogs]`). |
| VP | Infinitive `to` joins the VP (`[VP to go]`). Adverbs strictly inside the verb group join it (`has always been`). Verb chains are separate VPs (`[VP want] [VP to go]`). A verb-group piece without a verb, auxiliary, or `to` (stranded particle or `not`) becomes ADVP (`picked it [ADVP up]`). `advmod` particles annotated as ADV (EWT `moving in`) are ADVP. |
| Copula | `cop`, `aux`, `to`, and `not` of a non-verbal predicate form a VP; the predicate keeps its own chunk (`[VP is not] [NP a teacher]`). |
| PP | Adjacent `case` words of one head form one PP (`out of`). A `mark` with a preposition lemma (`of`, `by`, `in`, `on`, `with`, `without`, `about`, `from`, `into`, `at`, `upon`, `through`) on a VERB is PP (`[PP by] [VP giving]`). Possessive `'s` and SYM `case` (`5 - 10`) are not PP. |
| ADJP/ADVP | Left `advmod`/`amod`/`det` join only if the gap is filled by their own subtree or the chunk (`so close together`, `the sooner`). `at least`, `at most` are one ADVP. |
| O | `cc` and `cc:preconj` with their `fixed` parts (`as well as`); subordinators (`because`, `that`, `if`); interjections; punctuation. |
| Punctuation | `-`, `–`, `/`, `,`, `+`, and quotes join a chunk only when they sit between two of its words and their head is in it (`a well - known author`). Brackets and sentence punctuation never join. |
| Not handled | Number ranges (`3 to 4 days`), addresses, place names with commas, `mark` on ADJ predicates (`on how agreeable`). See `reports/chunk_review.md`. |

**Tasks**
1. Implement `derive_chunks.py` with the rules above.
2. Unit tests (`tests/`) for ~30 hand-written sentences covering each rule and edge cases (coordination, possessives, phrasal verbs, passives, questions).
3. Manual review: sample 200 dev sentences; mark errors; fix rules; repeat until the error rate is < 2% of chunks.
4. Report chunk-type distribution per split in `reports/chunks.md`.

**Deliverables:** `derive_chunks.py`, tests, review log.
**Exit criterion:** tests pass; manual review error rate < 2%.

- Nested structure: the chunked files are full CoNLL-U, so `HEAD` and `DEPREL` are kept for group B. Phase 2 needs no rework.

**Outcome (2026-11-18): exit criterion met (owner accepted the rule details and the agent-run review).**

- `derive_chunks.py` writes `data/processed/chunked/*.conllu`: the raw EWT files with `Chunk=<BIO tag>` added to MISC of each word line. Comments and multiword-token lines are unchanged (checked: removing `Chunk=` restores the raw files exactly).
- Tests: 48 pass (`tests/test_derive_chunks.py`: 39 hand-written sentences covering every rule, plus multiword tokens, file annotation, and BIO validation).
- Review: 200 dev sentences (seed 13), two rounds. Round 1 ~2.5% errors; round 2 **0.36%** (5 of 1,375 chunks). Reviewer: Claude Opus 5.5. Log: `reports/chunk_review.md`.
- Distribution (`reports/chunks.md`): train 111,872 chunks — NP 50.7%, VP 24.2%, PP 15.3%, ADVP 6.5%, ADJP 3.2%.
- The review sample contains corpus text, so it stays in git-ignored `data/processed/review/`.

### Phase 3 — Tokenization alignment with runtime

At runtime, wink-nlp splits text into words before the model runs. Training words must match.

**Decisions (owner, 2026-11-18)**

| Topic | Decision |
|-------|----------|
| One implementation | `align_tokens.mjs` runs the app's `preprocess()` (`src/modules/input`) and `tokenize()` (`src/modules/parser/winkBackend.ts`) through `tsx`, as planned for `chunkPatterns.ts`. No copied settings. |
| Contractions | Always separate words: `'m`, `'s`, `'re`, `'ve`, `'ll`, `'d`, `n't` (`I'm` → `I` + `'m`). Done in `winkBackend.ts`, because wink is inconsistent (`it's` split, `I'm` not). |
| Hyphenated words | Always one word (`well-known`, `F-16-launched`), even where wink or UD splits them. |
| URLs and e-mail addresses | One word; a sentence never ends inside one (`www.juancole.com`, `Warner@ENRON`). Trailing sentence punctuation stays separate. |
| Symbol runs | A run of one repeated symbol is one word (`***`, `---------`, `.........`). |
| Labels for merged words | A wink word covering several UD words takes the UPOS, chunk type, head, and relation of the span's head word (the UD word whose head lies outside the span). Its chunk tag is `B-` if the span starts a chunk, else `I-`. |
| Changed sentences | Sentences where `preprocess()` removes text (non-Latin, emoji, control) are dropped from training. |
| Sentence boundaries | Training keeps UD sentence boundaries. At runtime, trees are built per wink sentence; a head outside the sentence attaches to the sentence root (`treeDecoder.ts`). Effect measured in Phase 7. |
| Main piece of a split (dev detail) | The first piece with a letter or digit keeps the labels (`'Akkab` → `Akkab`); if none, the first piece. Other pieces: `goeswith`, UPOS `X` (`PUNCT` if no letter or digit), same chunk. |
| Chunk prefixes (dev detail) | From chunk identity: a runtime word gets `B-` when its chunk (its head word's UD chunk) differs from the previous runtime word's, else `I-`. Merges never join two UD chunks (`I'ma sophomore` → `[NP I'ma] [NP sophomore]`). |
| Agreement metric | On **each** split (train, dev, test), ≥ 99.5% of counted UD words map to exactly one runtime word. Not counted (by design, still covered by merge rules): UD words merged by the hyphen rule, and UD words inside one written token (no space, no apostrophe) that the runtime keeps whole (`others`, `5pm`, `2/3`, `in.`). Every other mismatch is covered by a documented merge or split rule. |

**Tasks**
1. `align_tokens.mjs`: for each EWT sentence, run `preprocess()` on the raw text (`# text =`), drop it if anything was removed, and `tokenize()` the clean text. Normalize UD word forms with `normalizeChars()` and locate them in the clean text.
2. Handle UD multiword tokens (e.g., *don't* → *do* + *n't*): use the form that matches the runtime split.
3. Measure word-level agreement (metric above). For mismatches, add mapping rules (merge or split) and apply the label-transfer decision.
4. Store the final word segmentation in the processed dataset, so training uses wink-style words. Each word keeps its character offsets (`start`, `end`) into the sentence text, the same offsets wink gives at runtime.
5. **Remap dependency heads** onto wink words (group B):
   - Merge (several UD words → one wink word): the merged word takes the head and relation of the UD word whose head lies outside the span. Arcs into the span point to the merged word.
   - Split (one UD word → several wink words): the first piece keeps the head and relation; other pieces attach to the first with relation `goeswith`.
   - Check that every remapped sentence is a valid tree (one root, no cycles). Projectivity is not required.

**Pre-flight check 1 (2026-11-18)**

Probe: wink-nlp 2.4.0 + wink-eng-lite-web-model 1.8.1 (`training/js`) on the raw `# text` of each EWT sentence, no preprocessing or mapping rules; a UD word counts as aligned if a wink token has exactly its character span.

| Item | Found | Status |
|------|-------|--------|
| `training/js` packages | Installed at pinned versions; wink loads in Node 26.13.1 | Ready |
| Chunked input (Phase 2) | `data/processed/chunked/*.conllu` present | Ready |
| Raw word agreement | dev 98.10% (24,669 / 25,148); train 98.61% (201,740 / 204,578). Target 99.5% needs mapping rules | Expected |
| Sentence split | wink splits 95 of 2,001 dev sentences (4.7%) and 488 of 12,544 train sentences into more than one sentence | Needs decision |
| `winkBackend.ts` tokenization (gate) | Header only | Blocked |
| Root `package.json` pins (gate) | Header only; no dependencies | Blocked |
| `input/textInput.ts` preprocessor | Header only. Runtime text is normalized (NFKC, curly quotes → ASCII, emoji and non-Latin removed) before wink, so alignment must use the same normalization. 79 train sentences have curly quotes, 97 have non-ASCII text | Blocked |
| App test tooling | Undecided (`plan.md` → *Tooling*); `winkBackend.test.ts` needs it | Needs decision |
| `configs/data.yaml` → `paths.aligned` | Planned, not set | Set in Phase 3 |

Mismatch types on train (raw), for the mapping rules:

| Type | Count | Examples |
|------|-------|----------|
| wink keeps a token UD splits (no apostrophe) | 637 | `others` (UD: `other` + `s`), `its` (= *it's*), `cockerspaniel` |
| wink keeps a contraction UD splits | 478 | `I'm`, `Here's`; `Kerry’s` (curly apostrophe; fixed by preprocessing) |
| wink splits URLs, e-mail addresses, abbreviations | 399 | `www.juancole.com` → `www . juancole . com`; `Rev.` → `Rev .` |
| wink splits symbol runs | 394 | `***`, `====…`, `’’` |
| wink keeps hyphenated words UD splits | 351 | `AK-47`, `F-16-launched` |
| wink keeps word + punctuation | 322 | `in.`, `2/3` |
| wink splits hyphenated words UD keeps | 97 | `socio-political`, `Get-A-Free-House.com` |
| Other splits (apostrophes, numbers with units) | 159 | `'72`, `50's`, `86M` |

Merges can join words from different chunks (`I'm` = NP + VP), so label transfer needs a rule. wink is inconsistent with contractions (`it's` is split, `I'm` is not).

**Pre-flight check 2 (2026-11-18, after the decisions above)**

Probe: the app's own `preprocess()` + `tokenize()` (run from `training/js` via `tsx`) on EWT, UD forms normalized with `normalizeChars()`.

| Item | Found | Status |
|------|-------|--------|
| Root `package.json` | wink-nlp 2.4.0, wink-eng-lite-web-model 1.8.1, @huggingface/transformers 4.3.2 (runtime); typescript 7.0.2, vite 8.3.8, vitest 5.1.0 (dev); same pins as `training/js` | Ready |
| `input/textInput.ts` | Implemented; 11 Vitest tests pass | Ready |
| `winkBackend.ts` tokenization | Implemented (sentences, words, offsets, word rules); 11 Vitest tests pass; `npm run typecheck` clean | Ready |
| App code from `training/js` | `tsx` runs `src/` modules and resolves wink from the root `node_modules` | Ready |
| Sentences dropped by `preprocess()` | dev 1 / 2,001; train 1 / 12,544 | Ready |
| Contraction mismatches | Gone (were 478 on train) | Ready |
| URL, e-mail, symbol-run rules | Implemented; 4 more Vitest tests (26 total) | Ready |
| Agreement (metric above) | **dev 99.59%, train 99.77%, test 99.61%** (all words, nothing excluded: dev 97.76%, train 98.24%, test 97.86%) | **Met** |
| wink sentence split | Splits 50 dev / 306 train / 55 test UD sentences (was 95 / 489 before the URL rule) | Handled by decision |

Mismatches on train (UD words), final word rules:

| Type | Count | Examples | Handled by |
|------|-------|----------|------------|
| Hyphenated word kept whole | 2,171 | `15-year`, `Al-Zaman` | Merge rule (not counted) |
| UD splits inside one written token | 962 | `others` (UD `other` + `s`), `5pm`, `2/3`, `in.` | Merge rule (not counted) |
| Runtime splits a UD word (apostrophes, mixed symbols, file names) | 419 | `'72`, `50's`, `?!?!?`, `UnleadedStocks.pdf` | Split rule |
| Other merges across a space-free boundary with apostrophes | 38 | `Q1'02`, `I'ma` | Merge rule |

Known weakness (no rule; for Phase 7 error analysis): wink treats some sentence-final words as abbreviations and keeps the period (`in.`, `No.`, `s.`); 102 train sentences end in a glued period, mostly real abbreviations (`etc.`, `p.m.`, `Inc.`).

**Phase 3 can start:** gates met; decisions recorded; agreement target met with the final word rules (the remaining Phase 3 work is the alignment script, mapping rules, head remapping, and `reports/alignment.md`).

**Deliverables:** alignment script, mismatch report (`reports/alignment.md`), mapping rules for labels and heads.
**Exit criterion:** agreement metric (*Decisions*) ≥ 99.5% on each split; remaining mismatches documented; every remapped sentence is a valid tree.

**Outcome (2026-11-18): exit criterion met.**

- `js/align_tokens.mjs` (`npm run align` in `training/js`, ~2 s) writes `data/processed/aligned/{train,dev,test}.jsonl`: one record per UD sentence with `doc_id`, `sent_id`, clean `text`, and runtime words (`form`, `start`, `end`, `upos`, `chunk`, `head`, `deprel`, `reviewed`, `wink_sent`, `ud`, `rule`). Every word's offsets slice back to its form; every chunk sequence is valid BIO.
- Agreement: **train 99.76%, dev 99.56%, test 99.56%** (all-word agreement 98.24% / 97.75% / 97.86%). Full counts and examples: `reports/alignment.md`.
- Trees: every written sentence is a valid tree (0 invalid, 0 alignment errors). Head remapping: 310 train merges had more than one outside arc (mostly `in.`, `its`); only the head word's arc is kept.
- Dropped: 1 sentence per split (preprocessing removed text).
- Runtime sentence split: 306 train UD sentences span more than one wink sentence; 719 train arcs cross wink sentences (attach to the sentence root at runtime; Phase 7 measures it).
- Tests: 16 `node:test` tests for `js/lib/` (`npm test` in `training/js`).


### Phase 4 — Dataset building

**Tasks**
1. `prepare_data.py`: combine UPOS and chunk tags into `UPOS|CHUNK` labels (group A); build the label map; drop label combinations seen < 5 times in train and map them to the nearest valid label.
   - Group B: encode each word's head and base relation as `<offset>@<head UPOS>|<relation>` (see *Nested phrase structure*). Labels seen < 5 times in train are merged the same way. Report how many training heads cannot be encoded after merging; target < 0.5% of words.
2. Build windows: consecutive sentences from the same document (`# newdoc id`) packed up to 256 subword tokens (same window size as the runtime), with sentence boundaries kept. Long single sentences are split at 256 with 32-token overlap.
3. Subword alignment: label the first subword of each word; set the rest to `-100`.
4. **Partial labels:** each input word has a `reviewed` flag (`true` for all EWT words).
   - Unreviewed words get `-100` on every subword, in both label groups; they still appear in the input as context.
   - Label counts (task 1) use reviewed words only. Windows with no reviewed word are dropped.
   - Chunk F1 is computed only on sentences where every word is reviewed; UPOS accuracy uses all reviewed words.
   - Unit tests in `tests/test_prepare_data.py` cover fully, partly, and un-reviewed windows.
5. Keep the official EWT train/dev/test splits. Test is used only in Phase 7 final evaluation.
6. Optional augmentation (train split only, ≤ 15% of windows): lowercase sentence starts, drop final punctuation, common learner typos. Evaluate the effect in Phase 7; keep only if dev F1 does not drop.
7. Save processed datasets with `datasets` to `training/data/processed/`.
8. Write `labels.json` following the schema below (schema version 1).

**`labels.json` schema (version 1)**

Single contract between training and the app. Later phases fill their fields; they do not add or rename fields.

| Field | Type | Written by (phase) | Meaning |
|-------|------|--------------------|---------|
| `schema_version` | int | `prepare_data.py` (4) | `1`. Bumped on any breaking change (rename, removal, type change). |
| `labels` | string[] | `prepare_data.py` (4) | Group A labels (`UPOS\|CHUNK`), then group B labels (`<offset>@<UPOS>\|<relation>`); array index = class id. Must equal the model's `config.json` `id2label` order. |
| `groups` | object | `prepare_data.py` (4) | Slice of `labels` and logits per group: `{"chunk": {"start": 0, "end": nA}, "dep": {"start": nA, "end": nA+nB}}`. Softmax is applied per slice. |
| `dep_encoding` | string | `prepare_data.py` (4) | Head encoding id, `rel_pos_v1` (see *Nested phrase structure*). |
| `tokenizer_input` | string | `prepare_data.py` (4) | `pre_split_words`: the runtime words are fed to the tokenizer as a pre-split list, so each word is tokenized as if preceded by a space (`I'm` → `I` `'m`). The app must do the same. |
| `upos` | string[] | `prepare_data.py` (4) | The 17 UPOS tags, fixed order (for marginalizing). |
| `chunk_tags` | string[] | `prepare_data.py` (4) | `B-`/`I-` × NP, VP, PP, ADJP, ADVP, plus `O`. |
| `label_merges` | object | `prepare_data.py` (4) | Rare combinations mapped to their replacement (`from` → `to`). Informational; the app ignores it. |
| `window.max_subword_tokens` | int | `prepare_data.py` (4) | `256`; the app uses it for runtime windows. |
| `window.max_subwords_per_word` | int | `prepare_data.py` (4) | `16`; a word keeps only its first 16 subword tokens (long URLs, symbol runs). The app must do the same. |
| `versions.base_model` | string | `prepare_data.py` (4) | Hugging Face id of the base model (tokenizer source). |
| `versions.data` | object | `prepare_data.py` (4) | UD release tag and commit; list of feedback batch ids (empty until Phase 12). |
| `versions.wink` | object | `prepare_data.py` (4) | `wink-nlp` and `wink-eng-lite-web-model` versions from `training/js/package-lock.json`. The app warns if its versions differ. |
| `calibration.temperature` | number \| null | `calibrate.py` (8) | Softmax temperature for group A. |
| `calibration.dep_temperature` | number \| null | `calibrate.py` (8) | Softmax temperature for group B. |
| `ambiguity.margin` | number \| null | `calibrate.py` (8) | Top-two probability margin for alternatives. |
| `ambiguity.attachment_margin` | number \| null | `calibrate.py` (8) | Top-two head-label margin for attachment alternatives. |
| `model_version` | string \| null | `export_onnx.py` (11) | Semantic version matching the release tag (e.g., `1.0.0`). |

- Fields are `null` until their phase writes them. The app throws `ParserLoadError` if a field it needs is `null`.
- Adding an optional field does not change `schema_version`; anything else does.
- `src/modules/parser/types.ts` → `LabelConfig` mirrors this table (Phase 4 exit gate).

**Deliverables:** processed datasets, `labels.json` (schema v1, Phase 4 fields filled), dataset statistics report.
**Exit criterion:** dataset loads; label and window statistics reviewed; `labels.json` validates against schema v1, and `LabelConfig` matches it.

**Outcome (2026-11-18): exit criterion met.**

- `scripts/prepare_data.py` (~15 s for all four candidates) writes `data/processed/dataset/<model>/`: a `DatasetDict` (`train`, `dev`, `test`) plus that model's `labels.json`. Windows depend on the tokenizer, so there is one dataset per candidate (Phase 6 compares them). Columns: `input_ids`, `attention_mask`, `labels_chunk` and `labels_dep` (group-local class ids, `-100` = ignored), `token_word`, and word-level gold fields (`words`, `word_sent`, `word_index`, `word_context`, `word_reviewed`, `gold_upos`, `gold_chunk`, `gold_head`, `gold_deprel`) for evaluation.
- Labels (train, reviewed words): group A 78 of 94 labels kept (99.985% of words); group B 632 of 1,202 kept (99.50%). 772 words (0.38%) keep their head with a changed relation; **242 words (0.119%) cannot be encoded** (target < 0.5%) and get `-100` in group B. 710 classes in total. Details: `reports/dataset.md`.
- Windows: about 10 train sentences per window (mean 190 tokens, max 256 for every model); no sentence needed splitting.
- Checks: head encoding round-trips on all 203,271 train words; for every labeled word, group A matches gold except the 41 merged rare labels, and group B decodes to the gold head; `labels.json` validates for all four models; a TypeScript check confirms `LabelConfig` matches the generated files (keys both ways, types).
- Tests: 25 new pytest tests (`tests/test_prepare_data.py`); 73 in total.
- Dev details (no owner decision needed):
  - Rare group A labels map to the most frequent kept label with the same chunk tag.
  - Rare group B labels keep their head (relation changes) or are ignored.
  - A word keeps at most 16 subword tokens; the cap is in `labels.json` and the app must apply it.
  - Augmentation (`lowercase_sentence_start`, `drop_final_punct`) is implemented but disabled; Phase 7 decides. `learner_typos` needs a typo list (TODO).

### Phase 5 — Baseline evaluation

Sets the bar the model must beat.

**Tasks**
1. `evaluate_baselines.mjs`: run wink-nlp + `chunkPatterns.ts` and compromise on the EWT dev and test splits using the Phase 3 word segmentation.
2. Map each baseline's tags to UPOS and chunk tags; report UPOS accuracy and chunk F1 (overall and per type).
3. No baseline exists for the structure output (wink-nlp and compromise have no dependency parser); record it as not applicable.

**Deliverables:** `reports/baselines.md`.
**Exit criterion:** baseline numbers recorded.

### Phase 6 — Base model selection

**Tasks**
1. Short training run (3 epochs, default hyperparameters) for each candidate on the same data and seed.
2. Record on dev: UPOS accuracy, chunk F1, UAS/LAS, training time, and approximate int8 size.
3. Quick ONNX export and Transformers.js timing for each (see Phase 10 method) to confirm the size and speed budgets.
4. Pick the model with the best dev chunk F1 and LAS that meets the size cap and speed budget. If the two metrics disagree, prefer chunk F1 unless LAS misses its threshold.

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
| Loss | Group A loss + λ × group B loss; λ = 1.0 (sweep 0.5, 1.0, 2.0) (proposed) |

**Tasks**
1. `train.py` with configs from `configs/train_<model>.yaml`; log to TensorBoard. `Trainer` subclass with per-group `compute_loss`; the model class stays `AutoModelForTokenClassification`.
2. Learning-rate sweep; then the final run with 3 seeds; keep the best checkpoint by dev chunk F1.
3. Optional experiments, kept only if they improve dev F1 or LAS: augmentation (Phase 4, task 6); biaffine head for group B if LAS misses its threshold (needs custom export).
4. Final evaluation on the test split, run once: UPOS accuracy, chunk F1 overall and per type, comparison with Phase 5 baselines; UAS, LAS, and nested-phrase F1 (predicted vs gold-tree brackets, both built by `src/modules/parser/treeDecoder.ts` run via `tsx`, so training and the app share one implementation), and the share of sentences that needed tree repair.
5. Error analysis: 100 test errors grouped by type (e.g., noun/verb homographs, PP chunks, coordination, PP attachment) in `reports/errors.md`.

**Deliverables:** best checkpoint, `reports/training.md`, `reports/errors.md`.
**Exit criterion:** test metrics meet the acceptance thresholds and beat both baselines. UAS ≥ 97% and LAS ≥ 94% decide whether the nested view ships; missing them does not block Phase 7 exit (the app ships without the nested view).

### Phase 8 — Calibration and ambiguity threshold

Alternatives at runtime are built from label probabilities, so the probabilities must be reliable.

**Tasks**
1. `calibrate.py`: fit a single temperature on dev logits; report expected calibration error before and after.
2. Tune the ambiguity margin (proposed 0.2): for each margin, measure on dev how often the correct label is in the alternatives versus the average number of alternatives per sentence.
3. Pick the margin that best balances coverage and a cap of 5 alternatives per sentence.
4. Fit a separate temperature for group B and tune the attachment margin: how often the correct head is among the top-two head labels for `obl`/`nmod` words with a `case` dependent (PP attachment).
5. Store temperatures and margins in `labels.json` (`calibration.temperature`, `calibration.dep_temperature`, `ambiguity.margin`, `ambiguity.attachment_margin`; see the Phase 4 schema).

**Deliverables:** calibration report; updated `labels.json`.
**Exit criterion:** calibration error reduced; margin chosen and recorded in `architecture.md`.

### Phase 9 — ONNX export and quantization

**Tasks**
1. `export_onnx.py`: export with Optimum (`token-classification` task) in the folder layout Transformers.js expects (`config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model.onnx`).
2. Produce variants: int8 dynamic quantization (`onnx/model_quantized.onnx`, for WASM) and fp16 (`onnx/model_fp16.onnx`, for WebGPU).
3. Parity check (`benchmark.mjs` + `evaluate.py`):
   - fp32 ONNX vs PyTorch: ≥ 99.9% label agreement on dev.
   - int8 and fp16: chunk F1 and LAS drop ≤ 0.3 points each vs fp32.
4. If int8 fails parity, try excluding sensitive layers (e.g., embeddings, classifier) from quantization.

**Deliverables:** ONNX files; parity report.
**Exit criterion:** both variants pass parity.

### Phase 10 — Browser benchmarking

**Tasks**
1. Build the minimal Vite test page in `training/js/bench-page/` that loads the model with Transformers.js in a Web Worker and parses a fixed 5,000-character sample.
2. Measure in Chrome, Safari, and Firefox, with WebGPU (where available) and WASM:
   - First load time (download + initialization), cached load time.
   - Parse time for 5,000 characters, including tree decoding (median of 10 runs).
   - Peak memory.
3. Test on at least one lower-end device (e.g., older laptop or recent phone) to set fallback-mode rules.

**Deliverables:** `reports/benchmark.md`.
**Exit criterion:** ≤ 5 s per 5,000 characters on a typical laptop with WASM; fallback rules defined for devices that miss it.

### Phase 11 — Packaging and release

**Tasks**
1. Copy the exported files to `public/models/enparse-tagger/` (ONNX files tracked with Git LFS) with `labels.json`. Every schema field (Phase 4) is filled; `model_version` is set here. `transformerBackend.ts` feeds words as `tokenizer_input` says and applies `window.max_subwords_per_word`; the Phase 9 parity check covers this.
2. Write `MODEL_CARD.md`: base model, data and licenses, attribution text, metrics, known weaknesses, intended use.
3. Tag the release (e.g., `model-v1.0.0`); record config, seed, data version, and checksums for reproducibility.
4. Integration test in the app: `transformerBackend.ts` loads the model and matches Phase 9 outputs on 20 fixed sentences. The test also checks that `ParseResult` carries `model_version` from `labels.json` and wink character offsets for every word, and that every sentence has a valid tree and nested phrases.

**Deliverables:** shipped model files, model card, release tag.
**Exit criterion:** app integration test passes.

### Phase 12 — Maintenance (ongoing)

- Optional: collect misparsed sentences reported in the app (opt-in, stored locally until exported by the user) as a regression set and extra training data. Requires a new app feature; not yet planned. Already prepared for: feedback records can store words with wink offsets and the model version from `ParseResult`, and unreviewed words are handled as partial labels (Phase 4).
- Retrain when: a new UD release fixes relevant annotations, the regression set grows past ~200 sentences, or a better base model fits the budget.
- Every retrain repeats Phases 7–11 and must not regress on the test split or the regression set.

---

## Changelog

### 2026-11-17T02:03:03Z — Claude Opus 5.5, Created training plan

- Added: Document Maintaining Guide (same as `plan.md` and `architecture.md`).
- Added: Overview, key design decisions, and open questions.
- Added: Prerequisites (hardware, system software, Python and Node libraries, data, base model candidates).
- Added: `training/` directory layout.
- Added: Phases 0–12 with tasks, deliverables, and exit criteria.

### 2026-11-17T02:57:39Z — Claude Opus 5.5, Scaffolded training/ directory

- Added: `training/` scaffold matching the layout; every file has a header (description, phase, tasks, dependencies). No code yet.
- Added (proposed): `configs/eval.yaml` (post-training thresholds out of scripts), `scripts/check_env.py` (Phase 0 check), `tests/conftest.py`.
- Added: `training/README.md`, `training/.gitignore`, `reports/README.md`, `MODEL_CARD.md` skeleton; one `train_<model>.yaml` per candidate.
- Modified: *Training directory layout* lists the new files.

### 2026-11-17T03:31:22Z — Claude Opus 5.5, Unified window size; added dependencies

- Modified: Phase 4 states that training and runtime windows are both 256 subword tokens.
- Added: `pyyaml` and `ruff` to Python libraries; `tsx` and `js-yaml` to Node libraries (`tsx` runs TypeScript files in Node).

### 2026-11-17T04:00:45Z — Claude Opus 5.5, Pre-flight check (Phase pre-0)

- Added: *Phase pre-0 — Pre-flight check* with machine check results, tasks (git-lfs, Python 3.12, tool config, Unsloth support check), and gates for later phases.
- Added: open question on the Phase 10 browser benchmark page location.
- Modified: Phase 0 — tool installation moved to Phase pre-0; task 2 now also pins `training/js`; task 5 now includes `bert-base-cased` (exit criterion covers every candidate).
- Modified: git-lfs purpose and Phase 11 task 1 note that shipped ONNX files are tracked with Git LFS.
- Modified: `pyyaml`, `ruff`, `js-yaml` approved by owner; proposed marks removed.

### 2026-11-17T04:21:52Z — Claude Opus 5.5, Pre-0 progress; bench page and tool config

- Added: `training/pyproject.toml` (ruff and pytest settings, owner-approved), `training/.python-version` (3.12), `training/js/bench-page/` (`index.html`, `bench.worker.mjs` headers) to layout.
- Modified: Phase pre-0 machine check — Python 3.12 (3.12.15) ready; git-lfs 3.8.1 installed, repo hooks pending; tasks 2–3 done.
- Modified: Phase 10 task 1 uses `training/js/bench-page/` (owner decision).
- Removed: open question and gate row for the bench page location (decided); hosting-limit check from the Phase 6 gate (deferred by owner).

### 2026-11-17T22:00:00Z — Hankyung Lee, Pre-0 progress; marked all tasks as done

- Modified: Phase pre-0 tasks are now all marked done.

### 2026-11-17T22:14:22Z — Claude Opus 5.5, Phase 0 complete

- Added: Phase 0 *Outcome*: Trainer is used for all four candidates, each passes a dummy MPS run; Unsloth result; notes for later phases.
- Added: `sentencepiece`, `protobuf`, `optimum-onnx` to Python libraries.
- Modified: Overview training framework is now Hugging Face `Trainer`; pre-0 git-lfs row set to Ready; Phase 3 gate now says the root `package.json` mirrors the `training/js` versions.
- Removed: `unsloth` from Python libraries.

### 2026-11-17T22:20:06Z — Claude Opus 5.5, Heading hierarchy

- Added: H1 document title "Enparse Parser Training Plan".
- Modified: *Document Maintaining Guide* is now an H2 section (*Rules*, *Format template* are H3); changelog entries are H3 under *Changelog*, and the format template matches.

### 2026-11-17T22:43:29Z — Claude Opus 5.5, Partial labels, labels.json schema, traceable ParseResult

- Added: key design decisions for partial labels and traceable outputs.
- Added: Phase 4 task 4 (partial labels with a per-word `reviewed` flag) and task 8 with the `labels.json` schema v1 table; exit criterion requires the schema and a matching `LabelConfig`.
- Added: Phase 4 exit gate (`LabelConfig` matches schema v1); Phase 11 gate includes `ParseResult` model version and wink offsets.
- Modified: Phase 3 task 4 keeps wink character offsets per word; Phase 8 task 4 and Phase 11 task 1 refer to schema fields; Phase 11 integration test checks `ParseResult` traceability; Phase 12 notes what is already prepared for feedback data.
- Modified: Phase 4 tasks renumbered (old 4–6 are now 5–7).

### 2026-11-17T23:16:13Z — Claude Opus 5.5, Phase 1 data acquisition and license summary

- Added: Phase 1 *Outcome*: UD EWT r2.19 pinned (commit, checksums), corpus size, proposed license position, proposed GUM exclusion.
- Modified: *Open questions* (training data license, extra data) and *Data* table (GUM license) reflect Phase 1 findings.

### 2026-11-17T23:17:31Z — Claude Opus 5.5, Phase 1 complete

- Modified: Phase 1 *Outcome* — owner accepted the license position and GUM exclusion; exit criterion met.
- Modified: *Gates for later phases* → Phase 1 exit row marked done.
- Removed: *Open questions* → training data license (decided).

### 2026-11-17T23:31:07Z — Claude Opus 5.5, Phase 2 chunk derivation

- Added: Phase 2 *Rule details* (proposed) — refinements found in the dev review; Phase 2 *Outcome*.
- Added: `derive_chunks.py`, `tests/test_derive_chunks.py`, `tests/conftest.py` fixtures, `reports/chunks.md`, `reports/chunk_review.md`; `configs/data.yaml` → `paths.chunked`, `chunks`.

### 2026-11-17T23:33:33Z — Claude Opus 5.5, Phase 2 complete

- Modified: Phase 2 *Rule details* and agent-run review accepted by owner; proposed mark removed; *Outcome* marks the exit criterion met.

### 2026-11-18T04:09:21Z — Claude Opus 5.5, Nested phrase structure output

- Added: *Nested phrase structure* (proposed) — group B structure output (relative-POS head encoding), `treeDecoder` decoding, bracketing convention, fallback behavior, expected accuracy.
- Modified: Overview goal; *Key design decisions* — combined label head replaced by two label groups packed in one classifier (Transformers.js keeps only `logits`, checked in 4.3.2); no rule-based nesting.
- Modified: Phase 2 note (heads kept); Phase 3 task 5 and exit criterion (head remapping, valid trees); Phase 4 group B labels and schema v1 fields `groups`, `dep_encoding`, `calibration.dep_temperature`, `ambiguity.attachment_margin`; Phases 5–11 metrics, loss, calibration, parity, and tests for the structure output.
- Removed: two-head model as an optional Phase 7 experiment (replaced by packed groups; biaffine head is the fallback). Phase 7 optional experiments no longer list GUM (excluded in Phase 1).
- Added: open questions on nested view thresholds and nesting convention.
- Added: *Gates for later phases* — Phase 7 gate for `treeDecoder.ts`; Phase 7 exit gate includes nested view thresholds.

### 2026-11-18T05:05:27Z — Claude Opus 5.5, Phase 3 pre-flight; extra data dropped

- Added: Phase 3 *Pre-flight check*: environment, raw wink/UD agreement (dev 98.10%, train 98.61%), sentence-split mismatch, blocked gates (`winkBackend.ts`, root `package.json`, `textInput.ts`), mismatch types.
- Modified: *Open questions* → *Extra data*: no extra treebanks for now (owner decision).

### 2026-11-18T05:30:29Z — Claude Opus 5.5, Phase 3 decisions and pre-flight 2; nested view confirmed

- Added: Phase 3 *Decisions* (owner): one implementation via `tsx`, contractions always split, hyphenated words one word, merged-word labels, dropped sentences, sentence boundaries, agreement metric. Tasks 1–3 updated.
- Added: Phase 3 *Pre-flight check 2* (app code in place; agreement 97.95% train / 98.97% excluding hyphen-rule words; open items for URLs and symbol runs).
- Modified: *Nested phrase structure* confirmed by owner (proposed marks removed); thresholds UAS ≥ 97%, LAS ≥ 94%; app ships without the nested view if missed. Phase 7 exit criterion updated accordingly.
- Modified: gates — Phase 3 and Phase 10 marked done; Phase 7 exit row records nested thresholds.
- Removed: open questions on nested view thresholds and nesting convention (decided).

### 2026-11-18T05:38:31Z — Claude Opus 5.5, Phase 3 pre-flight complete

- Added: Phase 3 *Decisions* rows for URLs/e-mail addresses and symbol runs; agreement metric defined (literal by-design exclusions, every split ≥ 99.5%) (owner).
- Modified: *Pre-flight check 2* — final results (dev 99.59%, train 99.77%, test 99.61%; target met); mismatch table; known weakness (glued sentence-final periods); Phase 3 can start. Exit criterion updated.
- Modified: Phase 0 note — unshipped weak-copyleft dependencies accepted by owner.

### 2026-11-18T06:27:44Z — Claude Opus 5.5, Phase 3 complete

- Added: Phase 3 *Outcome* (agreement 99.76% / 99.56% / 99.56%; all trees valid; output format); *Decisions* dev details for the main piece of a split and chunk prefixes.
- Added: `js/lib/` (CoNLL-U reader, alignment logic), `js/tests/` (node:test), `js/package.json` scripts to the directory layout; `configs/data.yaml` → `paths.aligned`, `alignment`.

### 2026-11-18T06:38:56Z — Claude Opus 5.5, Phase 4 complete

- Added: Phase 4 *Outcome* (datasets per candidate, label and window statistics, checks, dev details).
- Added: `labels.json` schema v1 fields `tokenizer_input` and `window.max_subwords_per_word` (optional additions written in Phase 4; schema version unchanged).
- Modified: Phase 4 exit gate marked done; Phase 11 task 1 notes the tokenizer contract.
