# Enparse Architecture

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

## Project overview

- **Goal:** Build a browser-based English grammar and vocabulary study tool for Korean speakers.
- **Purpose:** Parse English text and produce annotated output to support grammar and vocabulary learning.
- **Userbase:** Korean native speakers at beginner-to-intermediate English proficiency.
- **Architecture:** Fully client-side (static web app, no server-side computation).

### Core features

- **Sentence structure breakdown:** Syntactic parsing that splits complex sentences into noun phrases (NPs) and verb phrases (VPs). Ambiguous sentences display multiple valid parses.
- **Automatic dictionary lookup:** Highlighting a word shows its English and Korean definitions and example usages. Dictionary data is compiled into a static local database (hosted via raw content URLs), avoiding live API calls.
- **Subword parsing:** Frequently occurring prefixes, bases, and suffixes (e.g., *un-*, *-ism*) are parsed and treated as vocabulary items.
- **Vocabulary list export:** Users create custom vocab lists within the app and can export/import them in a portable file format.

### Design principles

- **Modularity:** Every submodule must be independent. New features must be addable without impacting existing modules.
- **Extensibility:** Architecture must support future feature additions with minimal refactoring.

---

## Technology stack

| Technology   | Role                                           |
|--------------|-------------------------------------------------|
| React 19.3.1 + react-dom 19.3.1 | UI library with hooks and functional components (MIT; owner, 2026-11-21, T13) |
| react-router 8.5.2 | Hash-based routing (`createHashRouter`); no server dependency (MIT; T13) |
| TypeScript 7.0.2 | Type safety across all layers (`strict`)     |
| Vite 8.3.8   | Build tool (static server, bundler); same version as `training/js` |
| CSS Modules  | Scoped, maintainable styling per component       |
| Transformers.js 4.3.2 (`@huggingface/transformers`) | Runs the in-house ONNX tagger in the browser (WebGPU/WASM) (Apache 2.0) |
| wink-nlp 2.4.0 + wink-eng-lite-web-model 1.8.1 | Sentence split, word tokenization, and lemmas (MIT). Not used for tagging or chunking. |
| jszip        | Archive export format (optional)                 |
| csv-stringify + csv-parse | CSV import/export (optional)        |

**Tool stack (approved 2026-11-18):** npm (lockfile committed), Node.js 20+, TypeScript 7.0.2, Vite 8.3.8, Vitest 5.1.0 (unit tests). **Added 2026-11-21 (owner, T13):** `@vitejs/plugin-react` 6.3.0; oxlint 1.94.0 (lint) + Prettier 3.10.1 (format, `printWidth` 120); React Testing Library 16.3.3 + jsdom 31.0.1 (component tests); fake-indexeddb 6.2.8 (storage tests; T29); Playwright 1.65.1 (end-to-end); GitHub Actions CI (`.github/workflows/ci.yml`, checkout without LFS). ESLint + typescript-eslint was not chosen: typescript-eslint supports TypeScript < 6.1 only. See `agents.md` → *Tooling and commands*.

**Bundle size (measured 2026-11-18):** wink-nlp + model ≈ 1.0 MB gzipped (3.5 MB minified), in the parser worker chunk. Transformers.js ≈ 125 KB gzipped JS, plus the ONNX Runtime WASM binary (≈ 3.6 MB gzipped), fetched when the model loads. React and the model file are not included.

**Development only (not shipped):** Python, Hugging Face Transformers, and Optimum for model training and ONNX export (see *Parsing engine*). Supporting tools:

| Tool | Role |
|------|------|
| tsx | Runs the app's TypeScript (e.g., `winkBackend.ts`, `treeDecoder.ts`) from Node scripts in `training/js/` (MIT) |
| js-yaml | Reads `training/configs/*.yaml` from Node scripts (MIT) |
| pyyaml | Reads `training/configs/*.yaml` from Python scripts (MIT) |
| ruff | Python format and lint for `training/` (MIT) |
| Git LFS | Stores shipped model files in `public/models/` (see *Model training* → *Artifacts*) |

- **Version sync:** root `package.json` and `training/js/package.json` pin the same `wink-nlp` 2.4.0, `wink-eng-lite-web-model` 1.8.1, `@huggingface/transformers` 4.3.2, and `vite` 8.3.8. Change them together.
- **Training tools import app code:** `training/js` scripts run app module files directly through `tsx` (`input/index.ts`, `parser/winkBackend.ts`, `parser/treeDecoder.ts`), so training and runtime share one implementation.

No separate state-management library. Shared state lives in services and is exposed through hooks (see *Layer communication*).

---

## Layers

The app has four layers. Each layer may only depend on the layer(s) below it.

| Layer          | Responsibility                                                                    | May depend on              |
|----------------|-----------------------------------------------------------------------------------|----------------------------|
| `components/`  | React UI only: rendering, user events, layout. No business logic.                 | `hooks/`, other components |
| `hooks/`       | Bridge services to React; manage component-level state and subscriptions.         | `services/`                |
| `services/`    | Async APIs for the UI. Compose logic modules into workflows; hold shared app state. | `modules/`, `core/`        |
| `modules/`     | Pure TypeScript logic. No React, no DOM, no rendering.                            | `core/`, `utils/`          |
| `core/`, `utils/` | Infrastructure shared by all modules.                                          | Nothing internal           |
| `i18n/`        | UI message catalogs (`en.ts` reference key set, `ko.ts` default) and lookup (`i18n.ts`); T68. Pure data and functions. | Nothing internal (components, hooks, and services may import it) |
| `pwa/`         | Service worker source (`sw.ts`) and its pure rules (`swRules.ts`); built separately into `dist/sw.js`; T69. Runs in the worker scope, not in the page. | Nothing internal |

- **Modules never import other modules.** Any combination of modules (e.g., normalize input → parse → build annotations) happens in a service.
- **Services never import other services.** When a feature needs several services, a hook or component combines them.

---

## Logic modules

**Module decisions (owner, 2026-11-21):**

| Module | Decision |
|--------|----------|
| modelLibrary (T22) | Recommend, among models not blocked and without memory warnings, the highest chunk F1 that parses 5,000 characters within 5 s on this device; ties → smaller download (DeBERTa-v3-xsmall today). Model cards lead with a label ("가장 정확함 / Most accurate", "가장 빠름 / Fastest on this device") and keep numbers (accuracy, size, expected speed here) behind a "details" toggle. |
| modelLibrary (T23) | `catalog.json` gains the nested-view metrics (UAS without punctuation, multi-word bracket F1, shown-bracket precision and coverage, role precision) and makes `variants.int8` / `variants.fp16` each optional. No multi-file ONNX. |
| preflight (T24) | All proposed checks plus WebGPU `shader-f16`. Low memory → warn. Storage: block a download that cannot fit the quota, warn when tight, call `storage.persist()` after the first download. No `shader-f16` → int8 on WASM. Integrity failure → delete, re-download once, then fail. Diagnostics always reachable from a header status badge. |
| dictionary (T25) | Definitions: Open English WordNet (CC BY 4.0); Korean translations: Wiktionary translation sections via kaikki.org extracts (CC BY-SA); examples: Tatoeba English–Korean pairs (CC BY 2.0 FR); ~10–20k headwords from a learner list (NGSL) plus frequent EWT words; phrasal verbs only; all senses, the predicted part of speech first; click/tap a word → popup → "more" opens `DictionaryPage`. Licenses to be re-checked before release. Served same-origin from R2. |
| dictionary (T42) | **Format:** static JSON: a small index (headwords and the inflection map) loaded on first lookup, plus ~64–256 entry shards grouped by a hash of the lookup key, and a manifest with each file's size and SHA-256. **Loading:** shards fetched on demand and kept in a versioned Cache Storage cache (`enparse-dict-v<N>`); an opt-in "Make dictionary available offline" download fetches all shards with progress and integrity checks (T38 functions); nothing large downloads without the user. **Pipeline:** Python in `training/dictionary/` (sources, extraction, sharding) plus a `training/js` step that runs the app's `winkBackend` lemmatizer and `lookupKey` through `tsx`, so headwords match runtime words. **Lemmas:** a build-time inflection index (Wiktionary forms + WordNet exceptions, checked against wink) maps every form to its headword(s), so DictionaryPage resolves *ran* → *run* without wink; parse clicks use the token's wink lemma first (T71). **Keys:** `utils/helpers.ts` → `lookupKey` everywhere; phrasal verbs keyed as "verb particle". No new dependency. |
| subword (T26) | Own curated affix list (~80–120, ordered by Bauer & Nation 1993 levels) with our own Korean glosses and 1–2 examples each; a compressed known-word list (NGSL + lemma forms) bundled in `subword/`. |
| vocab (T27) | Entry: `id`, `word`, `lemma`, `upos`, `definitionEn`, `definitionKo`, `example`, `sourceSentence`, `notes`, `tags[]`, `addedAt`, `schemaVersion`. Export: versioned JSON (canonical) + CSV via a small hand-written codec (no new dependency). Import: merge by `id`; same word with another `id` kept and flagged; ask only on list-name collisions. Lists in IndexedDB, settings in LocalStorage (`core/storage.ts`); periodic "export a backup" reminder. |

| Module                       | Description                                                                                       |
|------------------------------|---------------------------------------------------------------------------------------------------|
| `core/storage.ts`            | Persistent state wrapper (LocalStorage for small data, IndexedDB for larger datasets).             |
| `core/environment.ts`        | Browser capability probes (workers, WebAssembly SIMD/threads, WebGPU limits, device memory, storage quota) and model-file cache access (list, download with progress, read, SHA-256, delete). Returns data only; no decisions. |
| `utils/helpers.ts`           | Shared utilities: string normalization, date formatting, debounce/throttle helpers.                |
| `input/textInput.ts`         | Preprocessor: cleanup, normalization, length limits (see *Parsing engine*). UI is in `InputPage`. |
| `parser/parser.ts`           | Parser adapter interface (`ParserBackend`). Accepts clean text, returns sentences, tokens, chunk parses, and (model mode) dependency trees with nested phrases. Pluggable backend. |
| `parser/transformerBackend.ts` | Primary `ParserBackend`: runs the ONNX model via Transformers.js (`model.forward()`, both outputs); splits `logits` into label groups (`labels.json` → `groups`: UPOS\|CHUNK, relation) and reads `arc_scores` per sentence; applies the calibration temperatures. Packs sentences into windows like training (`build_windows`), validates `labels.json`, and self-tests after loading; fp16 runs on WebGPU, int8 on WASM (the variant is chosen by pre-flight and `parserService`). |
| `parser/treeDecoder.ts`      | Decodes arc scores into a dependency tree (maximum spanning tree, one root), builds nested phrases by a fixed bracketing order, and collapses low-confidence brackets (Phase 8 threshold). No grammar rules. |
| `parser/phraseLabeler.ts` | Deterministic post-processor on `treeDecoder.ts` output: labels nested phrases with grammatical roles (e.g., `NP(Subject)`, `VP(Predicate)`), clause vs. predicate categories (`S` vs. `VP`), and head-of-parent markers (`isHead`) using the model's dependency tree. Never overrides attachments. Conventions approved by the owner (2026-11-20): see *Parsing engine* → *Role labeling*. |
| `preflight/preflight.ts`     | Runs pre-flight stages (device, model, post-load file verification) through `core/environment` and combines results into a `PreflightReport` with a verdict (`ok`, `warn`, `blocked`). |
| `preflight/checks.ts`        | One pure function per check (pass, warn, fail, skip); unit-testable without browser APIs. |
| `preflight/requirements.ts`  | Minimum requirements and check severity (which checks block); values from `plan-training.md` Phase 10. |
| `modelLibrary/catalog.ts`    | Loads and validates `public/models/catalog.json` (offered models); files per model and variant. |
| `modelLibrary/downloads.ts`  | Per-model download state; downloads with progress and verification into Cache Storage; cancel; delete. |
| `modelLibrary/selection.ts`  | Persisted user choice and a recommended model. |
| `parser/winkBackend.ts`      | wink-nlp support (not a `ParserBackend`): sentence split and runtime words (hyphenated words, URLs, e-mail addresses, and symbol runs kept whole; contractions always split; no sentence break inside a URL) and lemmas. |
| `parser/ambiguity.ts`        | Builds alternative parses from low-margin label probabilities and attachment patterns.            |
| `parser/parser.worker.ts`    | Web Worker entry: loads the model once, reports load status, and parses off the main thread only when the model is ready. Typed message protocol (`types.ts`: requests with ids; `status` broadcasts, `result`, `done`, `error`); `index.ts` → `createParserWorker()` is the typed client. |
| `output/annotator.ts`        | Converts parse results into an annotation model: sentences by paragraph, tokens (lemma, spacing, ambiguity mark), readings (primary + alternatives with share, reason, changed words) with flat segments and nested nodes (wrapper brackets collapsed). Input type is structural (matches `ParseResult`; checked by a test). Rendering is in `OutputPage` (T57). |
| `dictionary/dictionary.ts`   | Lookup interface: resolves a word to definitions and example usages. Display is in components.    |
| `dictionary/staticDb.ts`     | Local static dictionary database adapter. No live API calls.                                       |
| `subword/subwordParser.ts`   | Rule-based segmenter: splits a word (plus its lemma) into prefixes, base, suffixes, and inflection (e.g., *un-* + *happy* + *-ness*). |
| `subword/affixes.ts`         | Affix inventory data used by `subwordParser`.                                                      |
| `vocab/vocabManager.ts`      | CRUD for custom vocabulary lists. Export/import as JSON or CSV. Persists via `core/storage`.       |

---

## Parsing engine

**Priority:** accuracy before speed. Up to ~5 s per 5,000 characters on a typical laptop is acceptable.

**Primary engine:** an in-house transformer tagger, run in the browser with [Transformers.js](https://github.com/huggingface/transformers.js) (Apache 2.0).
**Support:** [wink-nlp](https://github.com/winkjs/wink-nlp) + [wink-eng-lite-web-model](https://github.com/winkjs/wink-eng-lite-web-model) (MIT).

| Criterion        | How it is met                                                                 |
|------------------|-------------------------------------------------------------------------------|
| License          | Runtime libraries are Apache 2.0 / MIT. The model is trained in-house on openly licensed data (see *Model training*). |
| Accuracy         | Neural taggers reach ~97–98% POS accuracy and mid-90s chunk F1 on standard benchmarks. Measured baselines on EWT test (`plan-training.md` Phase 5): wink-nlp 88.8% UPOS; compromise 82.4% UPOS, 69.7% chunk F1. Model figures come from `training/scripts/evaluate.py`. |
| Speed / size     | Up to four models (~65–150 MB int8 each); the user chooses one in the model library. Each is downloaded once on request and cached. Inference in a Web Worker via WebGPU, falling back to WASM. Speed per model measured in `plan-training.md` Phase 10 and shown to the user. |
| Client-side only | Model runs in the browser. Training is a one-time offline development step; no server is used at runtime. |
| NP/VP chunks     | Model predicts chunk labels (BIO tags for NP, VP, PP, ADJP, ADVP) for each word. |
| Nested phrases   | In the same pass, the model predicts each word's dependency head and relation; `treeDecoder.ts` turns them into nested phrases and `phraseLabeler.ts` deterministically attaches grammatical roles (e.g., `NP(Subject)`, `VP(Predicate)`), clause/predicate labels, and head-of-parent markers from the predicted tree (see `plan-training.md` → *Nested phrase structure*). Shown per model only if it meets the nested-view targets (UAS without punctuation ≥ 93, labeled bracket F1 ≥ 88, ≥ 95% precision of shown brackets); brackets below the confidence threshold collapse to flat words. A biaffine parser head (arc scores as a second ONNX output, MST decoding) replaces the head-position labels after Phase 7's extended stage. |
| Words / subwords | Words with POS from the model and lemma from wink-nlp; derivational affixes from `subword/subwordParser.ts`. |
| Ambiguity        | Context-selected primary parse plus probability-ranked alternatives (see *Ambiguity handling*). |

### Model

- **Architecture:** standard token classifier with two label groups packed into one `logits` output, plus a biaffine arc scorer (second output):
  - Group A: `UPOS|CHUNK` (e.g., `NOUN|B-NP`). UPOS and chunk probabilities are recovered by summing group-A probabilities.
  - Group B: the UD relation (base relation or one of ten kept subtypes).
  - Softmax is applied per group.
  - Heads come from a second output, `arc_scores` `[batch, T, T]` (biaffine scorer; token 0 = root). Transformers.js `model.forward()` returns both outputs (checked in the T05 spike, 2026-11-20). `treeDecoder.ts` reads the scores of each wink sentence's words and decodes a maximum spanning tree.
- **Models:** one model per base model: `distilbert-base-cased` (Apache 2.0), `deberta-v3-xsmall` (MIT), `bert-base-cased`, `ModernBERT-base` (Apache 2.0). Cased models only. Every model that meets the acceptance thresholds is offered; the user chooses in the model library (see *Model library*). No single model is selected.
- **Runtime:** Transformers.js tokenizer plus token-classification model for raw logits. `parser/transformerBackend.ts` splits logits by group, applies each group's calibration temperature, and decodes labels and probabilities. `parser/treeDecoder.ts` builds the tree and nested phrases, and `parser/phraseLabeler.ts` attaches grammatical roles, clause/predicate categories, and head-of-parent markers.
- **`labels.json`:** fixed, versioned schema defined in `plan-training.md` → Phase 4; `parser/types.ts` → `LabelConfig` mirrors it.
- **Tokenizer input:** words from `winkBackend.tokenize()` are fed to the tokenizer as a pre-split list (each word tokenized as if preceded by a space) and keep at most `window.max_subwords_per_word` subwords (`labels.json` → `tokenizer_input`, `window`). Training uses the same rules. Transformers.js has no pre-split option, so words are encoded one by one with a per-model strategy (`plain`, or `space` for byte-level BPE), found by `training/js/benchmark.mjs` and stored as `labels.json` → `tokenizer_word_encoding` in Phase 9 (`plain` for DeBERTa-v3-xsmall and ModernBERT: both strategies reproduce Python's ids on every dev window).
- **Traceability:** every `ParseResult` carries the model id and model version (from `labels.json`) and each word's wink character offsets, so parses and user feedback can be traced to the model and word split that produced them.
- **Quantization:** int8 (WASM) and fp16 (WebGPU) per model, each shipped only if it passes Phase 9 parity. Phase 9 (2026-11-21): both variants pass for DeBERTa-v3-xsmall (90 / 144 MB) and ModernBERT (156 / 302 MB); chunk F1 and LAS within 0.13 points of fp32 (`training/reports/parity.md`).
- **Context window:** whole wink sentences are packed into windows of up to 256 subword tokens without overlap, exactly like training windows (`plan-training.md` Phase 4 and *Biaffine design*), so context extends beyond the current sentence. Only a sentence longer than 256 subwords is split with a 32-token overlap; each word then takes its scores from the window where it is farthest from the edge.
- **Role labeling (`parser/phraseLabeler.ts`; owner, 2026-11-20):** roles Subject, Predicate, Object, Indirect Object, Complement, Modifier, plus Passive subject, Agent (*by* phrase), Relative clause, Possessive, and Particle from the kept subtypes. Subject + predicate are promoted to `S` (Clause) with an inner `VP(Predicate)`. Single-word head wrappers are collapsed for display. Discontinuous predicates keep one role label across their pieces with a split-predicate flag (no invented contiguous bracket). Copula + predicative word form `VP(Predicate)` with the adjective or noun as `Complement`. Coordinated phrases share the outer role; conjuncts are marked as coordinated. **Uncertain structure (owner, 2026-11-21; T59):** when gating collapses a bracket that carries a role, the role is shown as a badge on its head word ("phrase boundary uncertain"), never on an inner bracket. A role is shown only if its head word's relation × head probability is ≥ `labels.json` → `nested.role_threshold` (Phase 8: 0.4 for DeBERTa-v3-xsmall and ModernBERT; test role precision 96.1% and 96.0%, 97% and 96% of roles shown).
- **BIO repair:** a stray `I-X` (after `O` or another type) becomes `B-X` (owner, 2026-11-20). This is how seqeval's default mode already reads chunks for the reported chunk F1, so the app shows what was measured.

### Model training (offline, `training/`)

Full plan: [plan-training.md](plan-training.md).

- **Data:** Universal Dependencies English EWT (CC BY-SA 4.0), web text. Chunks are derived from its dependency trees. GUM is optional extra data.
- **Framework:** Hugging Face `Trainer` on Apple Silicon (MPS). Unsloth was ruled out in Phase 0. Optimum (`optimum-onnx`) handles ONNX export and quantization.
- **Evaluation:** UPOS accuracy, chunk F1, UAS/LAS, nested-phrase F1, calibration, and speed on the EWT test split. Flat outputs are compared with baselines: wink-nlp POS (UPOS only) and compromise (UPOS and chunks).
- **Artifacts:** per offered model, ONNX files (int8 for WASM, fp16 for WebGPU), tokenizer, and `labels.json` (label map, temperatures, margins, versions, file checksums) in `public/models/<model-id>/`, plus `public/models/catalog.json`, published as static files tracked with Git LFS (`.gitattributes`). `training/` is not shipped with the app.

### Pipeline

```
raw text
  └─► input/textInput.ts (preprocessor)
        └─► parser.worker.ts
              ├─► winkBackend: sentence split, lemmas
              ├─► transformerBackend: windows → UPOS + chunk + relation probabilities, arc scores
              ├─► treeDecoder.ts: arc scores → dependency tree (MST) → nested phrases (gated)
              ├─► phraseLabeler.ts: dependency tree + nested phrases → roles, clause/predicate, head flags
              └─► ambiguity.ts: alternative parses
        └─► output/annotator.ts → annotation model → OutputPage
```

- `parserService` runs this chain.
- Subword segmentation runs on demand: `subwordService` receives a word and its lemma from the parse result.

### Model library

The app ships up to four models (one per base model) and the user chooses which to use (owner decision, 2026-11-18). Only models that meet the acceptance thresholds are offered (`plan-training.md` → Phase 7).

**Layout**

| File | Layer | Role |
|------|-------|------|
| `public/models/catalog.json` | static asset | Offered models (schema v1), written by `training/scripts/package_models.py` (Phase 11). Served from R2 at `/models/catalog.json` (see *Deployment*). |
| `public/models/<model-id>/` | static asset | One model: `config.json`, tokenizer files, `labels.json`, `onnx/model_quantized.onnx` (int8), `onnx/model_fp16.onnx`. Source of truth in Git LFS; uploaded to R2 and served at `/models/<model-id>/…` (see *Deployment*). |
| `modules/modelLibrary/catalog.ts` | modules | Load and validate the catalog; files per model and variant. |
| `modules/modelLibrary/downloads.ts` | modules | Per-model state on this device; download with progress and verify (bytes, SHA-256) into Cache Storage; cancel; delete. |
| `modules/modelLibrary/selection.ts` | modules | Persisted user choice (`core/storage`); recommendation. |
| `modules/modelLibrary/types.ts`, `index.ts` | modules | `Catalog`, `CatalogEntry`, `ModelState`, errors; public API. |
| `modules/parser/parser.worker.ts` | modules | `load(model)` / `unload()`: one model in memory at a time. |
| `services/parserService.ts` | services | Owns the worker, library, and pre-flight; `start`, `chooseModel`, `downloadModel`, `cancelDownload`, `deleteModel`, `retryLoad`, `parseText`. |
| `hooks/useModelLibrary.ts` | hooks | Library state and actions for components. |
| `components/Pages/ModelsPage.tsx` | components | Model cards (`#/models`). |

**`catalog.json` (schema v1)** — one entry per offered model:

| Field | Meaning |
|-------|---------|
| `id`, `display_name`, `description` | Model id (`train_<id>.yaml` key) and texts from `training/configs/catalog.yaml` |
| `base_model`, `license`, `model_version` | Base model id and license; release version |
| `folder`, `labels` | Path of the model folder and its `labels.json` |
| `variants` | `int8` and `fp16`, each optional (T23): ONNX file and size in bytes |
| `shared_files` | Config and tokenizer files with sizes and SHA-256 |
| `metrics` | EWT test UPOS, chunk F1, UAS, LAS; nested view (T23): UAS without punctuation, multi-word bracket F1, shown-bracket precision and coverage, role precision |
| `nested_view` | `true` if the model meets the nested-view targets (*Parsing engine* → *Nested phrases*: UAS without punctuation ≥ 93, multi-word labeled bracket F1 ≥ 88, ≥ 95% precision of shown brackets) |
| `performance` | Phase 10: first-load time, parse time per backend, peak memory per backend |
| `requirements` | Phase 10: `min_device_memory_gb` |

Top level: `schema_version` (1), `generated_at`, `models`.

**Behavior**

- **First visit:** nothing is downloaded until the user chooses a model. The library highlights a recommended model based on this device's pre-flight fitness (rule in `selection.ts`; open in `todo.md` → `[Modules/modelLibrary]`).
- **Later visits:** the saved choice is loaded automatically if it is fully cached; otherwise the status is `no-model`.
- **Memory:** one model is loaded at a time; switching unloads the previous model first.
- **Storage:** any number of downloaded models stay cached; the library shows each model's size on disk with a delete button, and pre-flight warns when storage is low. Deleting the active model unloads it first.
- **Downloads:** started only by the user; byte progress; each file verified (size and SHA-256 from `labels.json` → `files`) as it arrives; a failed file is deleted and retried once. A second failure fails the download (`integrity`; state `corrupted`). Only missing files are fetched. A failed or cancelled download deletes only the files it stored, so shared files of another cached variant stay. `downloadModel` for a model already downloading returns the running download (same variant) or cancels it first (other variant). `parserService` calls `storage.persist()` after the first download (T24).
- **Cache contract (T31 spike, 2026-11-21):** verified files are stored in the Cache Storage cache `transformers-cache` under their absolute URL `<origin>/models/<model-id>/<file>`. Transformers.js 4.3.2 looks that key up before fetching, so loading a downloaded model makes no model-file requests (checked in Chrome 158 and Safari 27). Whole-file SHA-256 with `crypto.subtle.digest` is fast enough (302 MB in ≤ 0.26 s); no streaming hash or split files are needed. Private windows may not have the quota to store a model (Chrome's `cache.put` failed for 302 MB), so pre-flight must check `storage.estimate()` before a download (`training/reports/benchmark.md`).
- **Per-model features:** the nested view is available only for models with `nested_view: true`.
- `modules/modelLibrary` does not import `modules/parser` or `modules/preflight`; `parserService` passes plain data between them.

### Deployment (owner, 2026-11-21; T12)

The app is hosted on **Cloudflare Pages**; model files live in **Cloudflare R2** and are served on the app's own origin, so the same-origin asset rule (`agents.md` → *Parser and worker code*) is unchanged.

| Part | Where | Notes |
|------|-------|-------|
| App (`dist/`) | Cloudflare Pages | `npm run build`; `public/models/` is left out of `dist/` (`vite.config.ts` → `skipModelFiles`), since single ONNX files (90–302 MB) exceed Pages' 25 MiB per-file limit. |
| Model files (`/models/*`) | R2 bucket bound as `MODELS` | `functions/models/[[path]].ts` (Pages Function) serves GET/HEAD with single byte ranges, ETag, and cache headers (`catalog.json` always revalidates). Integrity is checked by the app (SHA-256 in `labels.json` → `files`). |
| ONNX Runtime Web (`/models/_ort/*`) | Same R2 bucket | `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` from the `onnxruntime-web` version Transformers.js pins (the `.wasm` is 26.9 MB, over Pages' limit). `transformerBackend.ts` sets `wasmPaths` here; by default Transformers.js would load them from cdn.jsdelivr.net (not allowed). |
| Response headers | `public/_headers` | COOP `same-origin` + COEP `require-corp` (cross-origin isolation for multi-threaded WASM), `nosniff`, `no-referrer`; `sw.js` is `no-cache` so updates are found. |
| Offline app shell (T69) | `dist/sw.js` (from `src/pwa/sw.ts`) | Precaches the built shell (list and version hash injected at build); page loads network-first with the cached shell offline (COOP/COEP re-applied); never handles `/models/*` or `/dict/*`; a new version waits for the user's "reload" in the update banner. |
| Source of truth | Git LFS (`public/models/`) | Uploaded to R2 by the Phase 11 packaging step (upload tool chosen there). |
| Dictionary data | R2, same origin | Sharded JSON (T42), under a versioned path (proposed: `/dict/v<N>/`, a Pages Function route like `/models/*`; T70). |

**Local model testing (2026-11-21):** `npm run dev:models` (`vite --mode local-models`) adds a dev-server-only Vite plugin, `vite.localModels.ts`, that emulates the `/models/*` route from the selected training exports (`training/data/onnx/<model>/<run>/`), with `catalog.json` built from the catalog fixture and file sizes and SHA-256 from disk, and `/models/_ort/*` from `node_modules/onnxruntime-web/dist`. Never in builds. The dev server pre-bundles the worker's dependencies (`optimizeDeps.include`), because discovering them at the first model load reloads the page and cancels the download.

Open checks (T31): Range requests and streaming through the Function into Cache Storage; Function request quotas for the expected traffic.

### Model readiness (no fallback)

The app parses only with the model. There is no rule-based fallback (owner decision, 2026-11-18).

| Status | Meaning | UI |
|--------|---------|----|
| `idle` | App started; nothing checked yet | Parse disabled |
| `checking` | Pre-flight checks running (see *Pre-flight checks*) | Parse disabled; "checking" shown |
| `no-model` | No model chosen yet, or the chosen one is not downloaded (nothing is downloaded without the user) | Parse disabled; link to the model library |
| `downloading` | The chosen model's files are downloading and being verified (byte progress) | Parse disabled; progress shown |
| `loading` | Initializing the chosen model (progress) | Parse disabled; progress shown |
| `ready` | Model fully loaded (see below); records model id, backend (`webgpu` or `wasm`), and `model_version` | Parse enabled |
| `failed` | Pre-flight blocked or loading failed; typed reason (`network`, `unsupported`, `out-of-memory`, `invalid-model`, and `storage` when a download does not fit; T52) | Parse disabled; reason and `DiagnosticsPanel` shown with a retry action |

- **Fully loaded** means: all model files downloaded, `labels.json` validated against `LabelConfig` (schema v2, no needed field `null`), the ONNX session created, and a self-test parse of a fixed sentence giving the expected labels.
- Parse requests are refused unless the status is `ready`: `parserService.parseText()` rejects with `ParserNotReadyError` without contacting the worker, and the worker also rejects parse messages before `ready`.
- **Service contract (T52):** `start()` runs once at app start (`main.tsx`) and only loads a saved choice that is fully cached. A newer `chooseModel` supersedes an older one (its download is cancelled). Cancelling the chosen model's download returns to the still-loaded model (`ready`) or `no-model`. Deleting the active model unloads it and clears the saved choice. `retryLoad()` reruns `start()` (no model id) or `chooseModel` for the failed model. A parse started later supersedes an earlier one (`ParseSupersededError`). Download progress updates the snapshot at most every 1% (`PROGRESS_NOTIFY_STEP`).
- Input entered while loading is kept; the user starts parsing once the model is ready.
- WebGPU → WASM is a device choice inside model loading, not a fallback parser: both run the same model.

### Pre-flight checks

Client-side checks that decide, before the ~70 MB download where possible, whether this browser and device can run the model, and whether the model files are complete and correct. Everything stays local (no telemetry). Open policies: `todo.md` → `[Modules/preflight]` tasks.

**Layout**

| File | Layer | Role |
|------|-------|------|
| `core/environment.ts` | core | Browser API probes and Cache Storage access (list, download, read, SHA-256, delete). No decisions. Shared with `modules/modelLibrary`. |
| `modules/preflight/checks.ts` | modules | Pure check functions. |
| `modules/preflight/requirements.ts` | modules | Thresholds and severity (fail = blocks, warn = allowed). |
| `modules/preflight/preflight.ts` | modules | Stage runners and verdict; calls `core/environment`. |
| `modules/preflight/types.ts`, `index.ts` | modules | `PreflightReport`, `CheckResult`, structural `ModelManifest`, `ModelRequirements`, `ModelFitness`; public API. |
| `services/parserService.ts` | services | Runs the stages in order; maps verdicts to model status; passes catalog data in (pre-flight does not import `modules/modelLibrary`). |
| `components/Shared/DiagnosticsPanel.tsx` | components | Shows the report; retry. |

- `modules/preflight` does not import `modules/parser`: it reads `labels.json` through its own structural `ModelManifest` type (same approach as `modules/output`). A test keeps its supported schema version equal to the parser's `LABEL_SCHEMA_VERSION`.

**Flow** (run by `parserService.start()`; `retryLoad()` repeats it)

```
checking ─► 1. device checks (once) ──blocked──► failed: unsupported (nothing downloaded)
        └─► 2. model fitness for every catalog model (size, memory, speed) → shown in the model library
no-model ─► user chooses a model (or the saved choice is fully cached)
downloading ─► 3. model library downloads and verifies the files ──error──► failed: network / invalid-model
        └─► 4. model checks for the chosen model (labels.json, cached-file integrity) ──blocked──► failed: invalid-model
loading ─► 5. worker loads the model + self-test ──error──► failed: <reason>
ready
```

**Checks** (severity proposed; `requirements.ts`)

| Stage | Check | Source | Severity |
|-------|-------|--------|----------|
| Device | `module-workers` | Module Web Workers | Fail |
| Device | `wasm`, `wasm-simd` | `WebAssembly`, `WebAssembly.validate` (ONNX Runtime Web ships SIMD builds only) | Fail |
| Device | `wasm-threads` | `crossOriginIsolated` + `SharedArrayBuffer` (needs COOP/COEP headers from the host) | Warn (slower) |
| Device | `webgpu` | `navigator.gpu.requestAdapter()`, buffer limits, and the `shader-f16` feature (the fp16 variant needs it; T67 found a WebGPU adapter without it) | Info (missing or no `shader-f16` → int8 on WASM) |
| Device | `cache-storage` | Cache API | Warn (re-download every visit) |
| Device | `memory-hint` | `navigator.deviceMemory` (Chromium only; skipped elsewhere) | Warn |
| Model | `manifest-schema` | `labels.json`: supported `schema_version`; needed fields not `null` | Fail |
| Model | `wink-versions` | `labels.json` → `versions.wink` vs the app's pinned versions | Warn |
| Model | `storage-quota`, `model-size` | `navigator.storage.estimate()` vs `labels.json` → `files` sizes | Warn |
| Model | `files-cached`, `files-integrity` | Cache Storage entries vs `labels.json` → `files` (bytes, SHA-256), before every load; skipped while `files` is `null`. Downloads are verified by the model library as they arrive. | Mismatch: delete and offer a re-download; then fail |
| Fitness (per model) | `model-memory`, `model-storage`, `model-speed` | `catalog.json` requirements and Phase 10 measurements vs this device | Warn (shown on the model card); blocked models cannot be chosen |

- Memory cannot be measured reliably in browsers, so low memory only warns; the real test is the model load and self-test (out-of-memory → `failed: out-of-memory`).
- Thresholds are placeholders until Phase 10 measures peak memory and load times (`TODO(preflight-thresholds)`).

### Preprocessor (`input/textInput.ts`)

- Unicode NFKC normalization; curly quotes → ASCII quotes; en dash and minus → `-`; em dash → `--`.
- Strips control characters, zero-width characters, and emoji.
- Hangul/CJK and other non-Latin text are removed; the UI shows a notice listing what was removed.
- Collapses repeated whitespace; a single line break becomes a space; two or more line breaks become one paragraph break.
- **Max length:** 5,000 characters (`MAX_INPUT_CHARS`; owner, 2026-11-20), counted in code points on the raw input. Longer input is rejected with a character count; it is not silently truncated.
- The same code normalizes training text (`plan-training.md` → Phase 3).

### Ambiguity handling

1. **Primary parse (context-selected):** the highest-probability label for each word, chosen by the model using surrounding context. Marked "most likely".
2. **Probability-based alternatives:** words whose top two labels are close (margin below a threshold, e.g. 0.2) are treated as ambiguous. `ambiguity.ts` builds alternative label sequences from them, keeps only valid ones (consistent BIO chunks), and ranks them by joint probability.
3. **Attachment alternatives:** flat chunks do not encode where a prepositional phrase attaches.
   The structure output does: when a PP's top-two heads (calibrated arc probabilities) are within the attachment margin (`labels.json` → `ambiguity.attachment_margin`), `ambiguity.ts` offers both attachments as alternative trees.
4. **Cap:** at most 5 alternatives per sentence (`MAX_ALTERNATIVES`; owner, 2026-11-20), label and attachment alternatives together. Margins per model come from Phase 8 (`labels.json` → `ambiguity`).
5. **Per-model values (Phase 8, 2026-11-21; `training/reports/calibration.md`):** chosen on dev as the most errors recovered with ≤ 0.3 alternatives per sentence on average (owner cap). Written to each model's `labels.json`.

   | Model | Margin | Attachment margin | Bracket threshold | Temperatures (A / relation / arc) |
   |---|---|---|---|---|
   | deberta_v3_xsmall | 0.4 | 0.3 | 0.85 | 1.78 / 1.99 / 5.57 |
   | modernbert_base | 0.3 | 0.3 | 0.80 | 2.05 / 2.28 / 9.39 |

6. **Display (owner, 2026-11-21; T11):** the primary parse is shown; ambiguous words and phrases are marked in it; each sentence with alternatives has an "Other readings (n)" control that switches that sentence's whole view (flat and nested) to the chosen alternative, and back. Label and attachment alternatives use the same control. Built in `ambiguity.ts` (T60), `output/annotator.ts`, and `OutputPage` (T57).

### Subword segmentation

- wink provides the inflectional split via lemma (*running* → *run* + *-ing*).
- `subwordParser.ts` strips derivational affixes from `affixes.ts`, longest match first.
- A split is accepted only if the remaining base is a known word or lemma, preventing false splits (*under* ≠ *un-* + *der*).

### Alternatives considered

| Option                         | Status                                                                                  |
|--------------------------------|-----------------------------------------------------------------------------------------|
| wink-nlp + `chunkPatterns.ts`  | Dropped (owner, 2026-11-18): no rule-based fallback; the app parses only with the model. wink-nlp stays for sentence split, words, and lemmas. |
| compromise (MIT, ~250 KB)      | Not used. No published tagging accuracy, and a second tagger can disagree with the primary one. Included in evaluation for comparison only. |
| Off-the-shelf chunking models  | Not used. Licenses are non-commercial (QCRI) or unstated (vblagoje, AdapterHub); CoNLL-2000 data has no clear license. |
| spaCy / Stanza via Pyodide     | Not used. spaCy in the browser is experimental only; Stanza needs PyTorch, which does not run in the browser. |
| Earley parser (e.g., nearley) + hand-written grammar | Not used. A broad English grammar is large to write, and parse counts can explode. |

---

## Dependency graph

```
components/  ──►  hooks/  ──►  services/  ──►  modules/  ──►  core/storage.ts, core/environment.ts
                                                         └──►  utils/helpers.ts

parserService      ──► preflight/preflight ──► core/environment                       (device and per-model checks)
                   ──► modelLibrary/catalog, downloads, selection ──► core/environment, core/storage
                   ──► input/textInput ─► parser/parser.worker ─► output/annotator   (called in sequence by the service)
                                           └─► parser/transformerBackend, winkBackend, treeDecoder, phraseLabeler, ambiguity
dictionaryService  ──► dictionary/dictionary ──► dictionary/staticDb
subwordService     ──► subword/subwordParser
vocabService       ──► vocab/vocabManager ──► core/storage
```

- Arrows point from dependent to dependency.
- Files inside the same module may import each other (e.g., `dictionary.ts` → `staticDb.ts`, `parser.worker.ts` → `transformerBackend.ts`). Imports across modules are not allowed.
- Modules may import external libraries listed in *Technology stack* (e.g., `parser/` uses Transformers.js and wink-nlp).

---

## Layer communication

```
Component ─► Hook ─► Service ─► Module(s)
    ▲                   │
    └──── subscribe ◄───┘   (service-held state changes)
```

- **Request/response:** components call hooks; hooks call async service methods (e.g., `parseText()`, `lookupWord()`, `getVocabList()`).
- **Shared state:** services that hold state (e.g., `vocabService` lists) expose `subscribe()` / `getSnapshot()`. Hooks read them with `useSyncExternalStore`, so every component using `useVocab` updates when a list changes.
- **No event bus.** Cross-component updates go through service subscriptions; parent/child data goes through props.

---

## Frontend structure

### Routing

- Routes are defined in `src/routes.tsx` with React Router's `createHashRouter` (`#/input`, `#/output`, `#/vocab`, `#/dictionary`, `#/models`, `#/about`).
- **Attribution (owner, 2026-11-21; T21):** `#/about` (*About & licenses*, linked from the sidebar) lists the app, models, training data (UD English EWT, CC BY-SA 4.0), runtime libraries, and dictionary sources with their licenses; each model card on `ModelsPage` also shows the model's license and source. Built in T50.
- `ContentArea` renders the active route via `<Outlet />`.

### Component hierarchy

```
main.tsx (entry: mounts <RouterProvider> into index.html)
  └── App.tsx (root)
      ├── Layout.tsx
      │   ├── Header.tsx (branding, language menu, parser status badge → DiagnosticsPanel dialog; T55)
      │   ├── Sidebar.tsx (page navigation)
      │   └── ContentArea.tsx (route outlet)
      │       ├── InputPage.tsx (text input kept as parserService draft; count, .txt drop, model status; T56)
      │       ├── OutputPage.tsx (view choice, color legend, removal notice, paragraphs; T57)
      │       │   ├── SentenceView.tsx (one sentence; "Other readings (n)" radio group switches the reading; T11)
      │       │   │   ├── FlatReading.tsx (chunk highlights with type tags)
      │       │   │   └── NestedReading.tsx (nested phrases as boxes or brackets, labels always or on hover per two OutputPage toggles; head marks)
      │       │   │       └── OutputWord.tsx (selectable word; ambiguity and change marks; used by both views)
      │       │   └── WordDetails.tsx (base form, part of speech, word parts, add to list; dictionary with T53)
      │       ├── VocabPage.tsx (custom vocab lists; T48)
      │       │   ├── VocabLists.tsx (list overview, create list)
      │       │   ├── VocabListDetail.tsx (rename, delete, add word, item table)
      │       │   │   └── VocabItemRow.tsx (edit, move, remove a word)
      │       │   └── VocabTransfer.tsx (JSON/CSV export, import with name-conflict dialog)
      │       ├── DictionaryPage.tsx (lookup results)
      │       ├── ModelsPage.tsx (model library: choose, download, delete models; T54)
      │       │   └── ModelCard.tsx (labels, device fit with reasons, download state, actions, details: metrics, license, base model)
      │       └── AboutPage.tsx (About & licenses: attribution for app, models, data, libraries, dictionary; T21)
      └── Shared/
          ├── Button.tsx
          ├── Modal.tsx
          ├── Tooltip.tsx
          ├── LoadingSpinner.tsx
          ├── ModelStatus.tsx (one-line model status with retry / details; InputPage, ModelsPage, DiagnosticsPanel)
          ├── checkText.ts (check names, hints, value units for DiagnosticsPanel and ModelCard)
          └── DiagnosticsPanel.tsx (pre-flight report by stage, failures first, hints; Header dialog, ModelStatus details; T55)
```

### Services and hooks

| Service                | Wraps                                              | Hook            |
|------------------------|----------------------------------------------------|-----------------|
| `parserService.ts`     | `preflight`, `modelLibrary`, `textInput`, `parser`, `annotator` | `useParser`, `useModelLibrary` |
| `dictionaryService.ts` | `dictionary`, `staticDb`                           | `useDictionary` |
| `subwordService.ts`    | `subwordParser`                                    | `useSubword`    |
| `vocabService.ts`      | `vocabManager`                                     | `useVocab`      |
| `languageService.ts`   | `core/storage`, `i18n` (UI language; T68)          | `useI18n`       |
| `appUpdateService.ts`  | `core/pwa` (service worker, update prompt; T69)    | `useAppUpdate`  |

---

## Styling strategy

- **CSS Modules** — Each component has a corresponding `.module.css` file next to it.
- Styles are scoped to the component; no global leakage.
- Global styles (reset, typography) live in `css/global.css`.
- Design tokens (colors, spacing, fonts) defined in `css/tokens.css`.
- Responsive breakpoints handled via CSS media queries.

---

## Complete project skeleton

```
enparse/
├── dev_meta/
│   ├── plan.md
│   ├── architecture.md
│   ├── plan-training.md
│   ├── agents.md
│   └── todo.md (tasks and open decisions)
├── src/
│   ├── index.html
│   ├── main.tsx (entry point)
│   ├── routes.tsx (route definitions)
│   ├── paths.ts (page paths shared by routes.tsx and Sidebar.tsx)
│   ├── i18n/ (T68)
│   │   ├── en.ts (reference catalog: every message key)
│   │   ├── ko.ts (Korean, default)
│   │   └── i18n.ts (LANGUAGES, translate, display dates)
│   ├── pwa/ (T69)
│   │   ├── sw.ts (service worker; built into dist/sw.js)
│   │   └── swRules.ts (what the worker may handle; tested)
│   ├── css/
│   │   ├── global.css (reset, typography)
│   │   └── tokens.css (design tokens)
│   ├── components/
│   │   ├── App.tsx
│   │   ├── App.module.css
│   │   ├── Layout/
│   │   │   ├── Layout.tsx + Layout.module.css
│   │   │   ├── Header.tsx + Header.module.css
│   │   │   ├── Sidebar.tsx + Sidebar.module.css
│   │   │   └── ContentArea.tsx + ContentArea.module.css
│   │   ├── Pages/
│   │   │   ├── InputPage.tsx + InputPage.module.css
│   │   │   ├── OutputPage.tsx + OutputPage.module.css
│   │   │   ├── SentenceView.tsx, FlatReading.tsx, NestedReading.tsx, OutputWord.tsx, WordDetails.tsx (+ .module.css each; OutputPage parts)
│   │   │   ├── VocabPage.tsx + VocabPage.module.css
│   │   │   ├── VocabLists.tsx, VocabListDetail.tsx, VocabItemRow.tsx, VocabTransfer.tsx (+ .module.css each; VocabPage parts)
│   │   │   ├── DictionaryPage.tsx + DictionaryPage.module.css
│   │   │   ├── ModelsPage.tsx + ModelsPage.module.css
│   │   │   ├── ModelCard.tsx + ModelCard.module.css (ModelsPage part)
│   │   │   └── AboutPage.tsx + AboutPage.module.css (About & licenses; T21)
│   │   └── Shared/
│   │       ├── Button.tsx + Button.module.css
│   │       ├── Modal.tsx + Modal.module.css
│   │       ├── Tooltip.tsx + Tooltip.module.css
│   │       ├── LoadingSpinner.tsx + LoadingSpinner.module.css
│   │       ├── UpdateBanner.tsx + UpdateBanner.module.css (new version prompt; T69)
│   │       ├── ModelStatus.tsx + ModelStatus.module.css
│   │       ├── checkText.ts
│   │       └── DiagnosticsPanel.tsx + DiagnosticsPanel.module.css
│   ├── hooks/
│   │   ├── useParser.ts
│   │   ├── useModelLibrary.ts
│   │   ├── useDictionary.ts
│   │   ├── useSubword.ts
│   │   ├── useVocab.ts
│   │   ├── useI18n.ts (T68)
│   │   └── useAppUpdate.ts (T69)
│   ├── services/
│   │   ├── parserService.ts
│   │   ├── dictionaryService.ts
│   │   ├── subwordService.ts
│   │   ├── vocabService.ts
│   │   ├── languageService.ts (T68)
│   │   └── appUpdateService.ts (T69)
│   ├── core/
│   │   ├── storage.ts
│   │   ├── environment.ts
│   │   └── pwa.ts (service worker registration; T69)
│   ├── modules/ (each module also has index.ts (public API) and types.ts)
│   │   ├── input/
│   │   │   └── textInput.ts
│   │   ├── modelLibrary/
│   │   │   ├── catalog.ts
│   │   │   ├── downloads.ts
│   │   │   ├── selection.ts
│   │   │   └── catalog.fixture.json (test fixture from the Phase 9 exports)
│   │   ├── preflight/
│   │   │   ├── preflight.ts
│   │   │   ├── checks.ts
│   │   │   ├── requirements.ts
│   │   │   └── testProbe.ts (test-only fixtures)
│   │   ├── parser/
│   │   │   ├── parser.ts
│   │   │   ├── transformerBackend.ts
│   │   │   ├── winkBackend.ts
│   │   │   ├── ambiguity.ts
│   │   │   ├── treeDecoder.ts
│   │   │   ├── phraseLabeler.ts
│   │   │   ├── parser.worker.ts
│   │   │   ├── bio.ts (BIO repair and chunk grouping)
│   │   │   └── testFixtures.ts (test-only: mocked backend for *.test.ts)
│   │   ├── output/
│   │   │   ├── annotator.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── dictionary/
│   │   │   ├── dictionary.ts
│   │   │   └── staticDb.ts
│   │   ├── subword/
│   │   │   ├── subwordParser.ts
│   │   │   ├── affixes.ts
│   │   │   └── knownWords.generated.ts (NGSL 1.2 known words, CC BY-SA 4.0; generated by training/js/build_known_words.mjs; loaded lazily)
│   │   └── vocab/
│   │       ├── vocabManager.ts
│   │       └── csv.ts (CSV codec; no dependency)
│   └── utils/
│       └── helpers.ts
├── functions/
│   └── models/[[path]].ts (Cloudflare Pages Function: /models/* from R2; T12)
├── public/
│   ├── _headers (Cloudflare Pages: COOP/COEP; sw.js no-cache; T12, T69)
│   ├── manifest.webmanifest (PWA; T69)
│   ├── icons/ (placeholder app icons until T20; T69)
│   └── models/ (built by training/ in Phase 11; Git LFS; uploaded to R2, not in dist/)
│       ├── catalog.json (offered models)
│       └── <model-id>/ (one per offered model: ONNX files, tokenizer, labels.json)
├── training/ (offline only; not shipped; layout in plan-training.md)
│   ├── configs/
│   ├── scripts/ (env check, fetch, derive chunks, prepare, train, calibrate, export, evaluate)
│   ├── dictionary/ (dictionary build pipeline: sources, extraction, inflection index, shards; T42/T70)
│   ├── js/ (tokenization alignment, JS baselines, Transformers.js benchmark, bench-page/ browser benchmark, dictionary lemma step)
│   ├── tests/
│   ├── reports/
│   └── MODEL_CARD.md
├── .github/workflows/ci.yml (typecheck, lint, test, build; T13)
├── .oxlintrc.json, .prettierrc.json, .prettierignore (lint and format; T13)
├── package.json
├── tsconfig.json (strict mode)
├── vite.config.ts (root: 'src'; publicDir: '../public')
└── README.md
```

- `src/` contains all app source files. `dist/` is generated by Vite and is git-ignored.
- `training/` holds the offline model pipeline. Its output in `public/models/` (Git LFS) is uploaded to R2 and served on the app's origin at `/models/*` (*Deployment*).
- Each logic module is a self-contained directory under `modules/`. Coding conventions and the step-by-step module guide are in `agents.md`.

### Adding a new feature

1. Logic module in `modules/<feature>/` (if new logic is needed).
2. Service in `services/` wrapping that module.
3. Hook in `hooks/` exposing the service.
4. Component(s) in `components/`, each with a `.module.css` file.
5. Route in `routes.tsx` and a link in `Sidebar.tsx` (if it is a new page).

---

## Changelog

### 2026-11-17T00:32:01Z — Switched to direct-edit model with Changelog

- Modified: Document Maintaining Guide — replaced append-only rule with direct-edit rule; added requirement for a Changelog section at the bottom.
- Modified: Changelog format — entries now record added/modified/removed items with timestamp.
- Removed: Timestamped section header from existing content (consolidated into single document body).

### 2026-11-17T00:54:54Z — Claude Opus 5.5, Resolved architectural conflicts (React final)

- Added: React Router (`createHashRouter`) to stack; `routes.tsx` and `main.tsx` entry point.
- Added: *Layers* section with explicit dependency rules; *Layer communication* section (service subscriptions via `useSyncExternalStore`).
- Added: `useSubword` hook; services/hooks mapping table; `.module.css` files in skeleton; *Adding a new feature* steps.
- Modified: `input/textInput.ts`, `output/annotator.ts`, `dictionary/dictionary.ts` redefined as logic-only; UI moved to `InputPage`, `OutputPage`, and components.
- Modified: Dependency graph redrawn to match layer rules; module chaining now done in `parserService`.
- Modified: "Backend modules" renamed "Logic modules" (app is fully client-side). Header/Sidebar roles split (branding vs navigation).
- Removed: `app.ts` (replaced by `main.tsx`), `core/router.ts` (replaced by React Router), `core/eventBus.ts` (replaced by service subscriptions), `useStorage` hook (no matching service).

### 2026-11-17T01:41:17Z — Claude Opus 5.5, Selected parsing engine

- Added: wink-nlp + wink-eng-lite-web-model to *Technology stack*.
- Added: *Parsing engine* section (criteria, pipeline, preprocessor rules, ambiguity handling, subword segmentation, alternatives considered).
- Added: `parser/winkBackend.ts`, `parser/chunkPatterns.ts`, `parser/ambiguity.ts`, `parser/parser.worker.ts`, `subword/affixes.ts` to modules table and skeleton.
- Modified: `input/textInput.ts` defined as the preprocessor; `parser/parser.ts` and `output/annotator.ts` outputs updated (tokens and alternatives; no parse-tree data).
- Modified: Dependency rules allow imports within a module and of listed external libraries.

### 2026-11-17T01:56:15Z — Claude Opus 5.5, Switched primary parser to in-house transformer

- Added: Transformers.js to *Technology stack*; development-only training stack note.
- Added: *Model*, *Model training*, and *Fallback mode* subsections; `parser/transformerBackend.ts`; `public/models/` and `training/` to skeleton.
- Modified: *Parsing engine* — accuracy before speed (~5 s per 5,000 characters acceptable); in-house transformer tagger is primary; wink-nlp handles sentence split, lemmas, and fallback.
- Modified: *Ambiguity handling* — alternatives now ranked by model probabilities; PP attachment kept as a rule.
- Modified: *Alternatives considered* — updated statuses; added off-the-shelf chunking models (license issues).
- Removed: 60-token max sentence length (overlapping context windows replace it).

### 2026-11-17T02:03:03Z — Claude Opus 5.5, Aligned with training plan

- Added: link to `plan-training.md` in *Model training*; `plan-training.md` to skeleton.
- Modified: *Model* — single combined `UPOS|CHUNK` label head replaces two heads; cased base-model candidates updated; calibration temperature applied at runtime.
- Modified: model size estimate to ~65–80 MB (proposed 80 MB cap); training framework (Unsloth on MPS, `Trainer` fallback); `training/` skeleton matches the training plan.

### 2026-11-17T02:24:51Z — Claude Opus 5.5, Linked agent guide

- Added: `agents.md` to skeleton; pointer to `agents.md` for coding conventions and module guide.

### 2026-11-17T02:57:39Z — Claude Opus 5.5, Training scaffold

- Modified: `training/scripts/` skeleton note includes the proposed environment check (`check_env.py`).

### 2026-11-17T03:31:22Z — Claude Opus 5.5, Unified window size

- Modified: *Model* → *Context window* reduced from 512 to 256 subword tokens to match training.

### 2026-11-17T03:36:56Z — Claude Opus 5.5, App scaffold and dev tools

- Added: *Technology stack* → development-only tools table (tsx; proposed js-yaml, pyyaml, ruff).
- Added: skeleton entries for `tsconfig.json`, per-module `index.ts` and `types.ts` (proposed), and a `README.md` placeholder in `public/models/enparse-tagger/`.
- Added: header-only files for the full skeleton (`src/`, root config, `public/`). No code yet.

### 2026-11-17T04:00:45Z — Claude Opus 5.5, Approved dev tools; Git LFS for models

- Modified: js-yaml, pyyaml, and ruff approved by owner; proposed marks removed.
- Added: Git LFS to development tools; *Artifacts* notes that `public/models/` files are tracked with Git LFS.
- Modified: *Parsing engine* → accuracy source path corrected to `training/scripts/evaluate.py`.

### 2026-11-17T04:21:52Z — Claude Opus 5.5, Bench page in skeleton

- Modified: `training/js/` skeleton note includes `bench-page/` (Phase 10 browser benchmark).

### 2026-11-17T22:14:22Z — Claude Opus 5.5, Training framework and JS versions

- Modified: *Model training* → framework is now Hugging Face `Trainer` (Unsloth ruled out in Phase 0); ONNX export uses `optimum-onnx`.
- Added: *Technology stack* → version-sync note for `wink-nlp` and `@huggingface/transformers` pinned in `training/js`.

### 2026-11-17T22:20:06Z — Claude Opus 5.5, Heading hierarchy

- Added: H1 document title "Enparse Architecture".
- Modified: *Document Maintaining Guide* is now an H2 section (*Rules*, *Format template* are H3); changelog entries are H3 under *Changelog*, and the format template matches.
- Modified: content sections raised one level (H3 → H2, H4 → H3); *Core features* and *Design principles* are H3 under *Project overview*, matching `plan.md`.

### 2026-11-17T22:43:29Z — Claude Opus 5.5, labels.json schema and ParseResult traceability

- Added: *Model* → `labels.json` schema reference (`plan-training.md` Phase 4) and `ParseResult` traceability (model version, wink offsets).

### 2026-11-18T04:09:46Z — Claude Opus 5.5, Nested phrase structure output

- Added: `parser/treeDecoder.ts` (proposed) to modules table, pipeline, and skeleton; *Nested phrases* row in *Parsing engine*.
- Modified: *Model* — two label groups (flat `UPOS|CHUNK`, structure head/relation) packed in one `logits` output; runtime splits logits per group.
- Modified: `parser.ts`, `transformerBackend.ts`, `annotator.ts` descriptions; evaluation metrics; fallback mode (no nested view); *Ambiguity handling* item 3 uses head probabilities in model mode.

### 2026-11-18T05:29:35Z — Claude Opus 5.5, Tool stack, pinned runtime versions, nested view confirmed

- Added: tool stack (npm, Node 20+, TypeScript 7.0.2, Vite 8.3.8, Vitest 5.1.0; owner-approved); measured bundle sizes; training tools importing app code via `tsx`.
- Modified: *Technology stack* pins runtime versions (wink-nlp 2.4.0, wink-eng-lite-web-model 1.8.1, Transformers.js 4.3.2; owner-approved); version sync covers root and `training/js`.
- Modified: nested phrase design confirmed by owner (proposed marks removed); ships only with UAS ≥ 97% and LAS ≥ 94%. Module public API (`index.ts`, `types.ts`) confirmed.
- Modified: `winkBackend.ts` word rules; *Preprocessor* dash mapping, line breaks, and length counting.

### 2026-11-18T05:38:31Z — Claude Opus 5.5, Word rules for URLs and symbol runs

- Modified: `winkBackend.ts` description — URLs, e-mail addresses, and symbol runs are one word; no sentence break inside a URL (owner decision).

### 2026-11-18T06:38:56Z — Claude Opus 5.5, Tokenizer input contract

- Added: *Model* → tokenizer input (pre-split words, per-word subword cap), set by Phase 4 `labels.json`.

### 2026-11-18T06:56:29Z — Claude Opus 5.5, No fallback mode

- Removed: rule-based fallback mode and `parser/chunkPatterns.ts` (owner decision): from the modules table, skeleton, dependency graph, stack, evaluation, and ambiguity handling (rule-based attachment alternatives).
- Added: *Model readiness (no fallback)* — status values, definition of "fully loaded" (files, `labels.json`, ONNX session, self-test), parse refused unless `ready` (`ParserNotReadyError`).
- Modified: `winkBackend.ts` is wink-nlp support only (sentence split, words, lemmas), not a `ParserBackend`; `parser.worker.ts` description; baselines are wink-nlp POS and compromise.

### 2026-11-18T07:06:28Z — Claude Opus 5.5, Pre-flight checker module planned

- Added: *Model readiness* → `checking` status and *Pre-flight checks* (layout, flow, checks with proposed severity, memory limits of browser APIs).
- Added: `core/environment.ts`, `modules/preflight/` (`preflight.ts`, `checks.ts`, `requirements.ts`, `types.ts`, `index.ts`), `components/Shared/DiagnosticsPanel.tsx` to the modules table, skeleton, component hierarchy, and dependency graph.
- Modified: `parserService` wraps `preflight`; `failed` status shows `DiagnosticsPanel`.

### 2026-11-18T07:14:39Z — Claude Opus 5.5, Measured baselines

- Modified: *Parsing engine* → *Accuracy* uses the Phase 5 measured baselines (wink-nlp 88.8% UPOS, not ~95%).

### 2026-11-18T07:50:53Z — Claude Opus 5.5, Model library

- Added: *Model library* section (owner decision: up to four models, user chooses; only models meeting the acceptance thresholds; no download before a choice; any number cached): layout, `catalog.json` schema v1, behavior.
- Added: `modules/modelLibrary/` (`catalog.ts`, `downloads.ts`, `selection.ts`, `types.ts`, `index.ts`), `hooks/useModelLibrary.ts`, `components/Pages/ModelsPage.tsx` (`#/models`) to the modules table, services table, component hierarchy, routes, dependency graph, and skeleton; `public/models/` layout (`catalog.json`, `<model-id>/`).
- Modified: *Model readiness* statuses (`no-model`, `downloading`); pre-flight flow (per-model fitness; downloads verified by the model library; cached-file integrity before load); *Model* (no single base model; traceability carries the model id); *Speed / size*; *Artifacts*.

### 2026-11-18T08:11:49Z — Claude Opus 5.5, treeDecoder implemented; word-encoding strategy

- Modified: `parser/treeDecoder.ts` is implemented (decoding with root and cycle repair; head-outward nested phrases; tests reproduce the documented examples).
- Added: *Model* → per-model word-encoding strategy for Transformers.js (`labels.json` → `tokenizer_word_encoding`, Phase 11).

### 2026-11-18T22:20:52Z — Claude Opus 5.5, Nested-view targets; planned biaffine head

- Modified: *Parsing engine* → *Nested phrases*: view-based acceptance targets, confidence-gated brackets, planned biaffine head (owner decisions).

### 2026-11-19T04:47:11Z — Antigravity, Added parser/phraseLabeler.ts submodule

- Added: `parser/phraseLabeler.ts` (header-only skeleton) to *Logic modules*, *Parsing engine* (*Nested phrases*, *Model* → *Runtime*, *Pipeline*), *Dependency graph*, and *Complete project skeleton*.

### 2026-11-19T05:09:52Z — Claude Opus 5.5, Stale thresholds, proposed marks, todo.md

- Modified: *Model library* → `catalog.json` → `nested_view` uses the nested-view targets (UAS without punctuation ≥ 93, bracket F1 ≥ 88, shown-bracket precision ≥ 95) instead of the superseded UAS ≥ 97 / LAS ≥ 94.
- Modified: `parser/phraseLabeler.ts` marked **(proposed)** in *Logic modules*, *Parsing engine* (*Nested phrases*, *Runtime*, *Pipeline*), *Dependency graph*, and the skeleton (added 2026-11-19 by Antigravity; not yet confirmed by the owner).
- Modified: open-item pointers now refer to `todo.md` (the *Undecided* list moved there).
- Added: `dev_meta/todo.md` to the skeleton.

### 2026-11-19T22:39:27Z — Claude Opus 5.5, Runtime windows and BIO repair decided

- Modified: *Parsing engine* → *Context window*: whole wink sentences packed into 256-subword windows without overlap, like training; only sentences over 256 subwords split with overlap (owner, T04/T08).
- Added: *Parsing engine* → *BIO repair*: stray `I-X` → `B-X` (owner, T08).

### 2026-11-20T22:07:16Z — Claude Opus 5.5, Phase 8 margins and bracket gating recorded

- Added: *Ambiguity handling* item 5: per-model margins, attachment margins, bracket thresholds, and temperatures (DeBERTa, ModernBERT) from Phase 8.
- Modified: bracket confidence (`treeDecoder.ts`) also multiplies the head probabilities of the bracket head's outer dependents (chosen on dev; `plan-training.md` → Phase 8).

### 2026-11-20T22:29:17Z — Claude Opus 5.5, Parser shell, phrase labeling, and role gating

- Added: *Parsing engine* → *Role labeling* → uncertain structure (owner, T59): head-word role badges for collapsed brackets; role confidence gate (`nested.role_threshold`).
- Modified: *Logic modules* → `parser.worker.ts`: message protocol and typed client (T35).
- Modified: *Model readiness* → fully loaded validates `labels.json` schema v2 (was v1).
- Added: skeleton → `parser/testFixtures.ts` (test-only).

### 2026-11-20T22:42:10Z — Claude Opus 5.5, Phase 9 export results

- Modified: *Model* → *Tokenizer input*: word encoding set in Phase 9 (`plain` for both offered models).
- Modified: *Model* → *Quantization*: int8 and fp16 shipped per model after parity; Phase 9 sizes and results.

### 2026-11-20T22:51:36Z — Claude Opus 5.5, transformerBackend implemented

- Modified: *Logic modules* → `parser/transformerBackend.ts`: windows like training, `labels.json` validation, self-test, variant → device (T63).

### 2026-11-20T23:00:00Z — Claude Opus 5.5, Owner decisions T11, T12, T13, T21

- Added: *Model library* → *Deployment* (T12): Cloudflare Pages + R2 served same-origin at `/models/*` by a Pages Function; COOP/COEP via `_headers`; model files left out of `dist/`.
- Added: *Ambiguity handling* item 6 (T11): per-sentence "Other readings (n)" switch with ambiguous words marked.
- Added: *Routing* → `#/about` and attribution (T21); `AboutPage.tsx` in the component hierarchy and skeleton.
- Modified: *Technology stack*: React 19.3.1, react-router 8.5.2; tool stack adds plugin-react, oxlint + Prettier, RTL + jsdom, Playwright, GitHub Actions (T13).
- Added: skeleton → `functions/models/[[path]].ts`, `public/_headers`, `.github/workflows/ci.yml`, lint/format configs.

### 2026-11-21T03:50:52Z — Claude Opus 5.5, Cache contract, self-hosted ONNX Runtime, app shell

- Added: *Model library* → *Cache contract* (T31): `transformers-cache`, absolute `/models/<model-id>/<file>` keys, whole-file SHA-256, private-window quota.
- Added: *Deployment* → ONNX Runtime Web served from `/models/_ort/` (R2), never from a CDN.
- Modified: app shell implemented (T39): `src/paths.ts` (page paths shared by routes and sidebar), placeholder pages; `parser/bio.ts` (BIO repair and grouping, shared by `parser.ts` and `ambiguity.ts`; T60).

### 2026-11-21T04:30:46Z — Claude Opus 5.5, WebGPU fp16 check

- Modified: *Pre-flight checks* → `webgpu` also requires the `shader-f16` feature for the fp16 variant (T67: a WebGPU adapter without it fails to load fp16).

### 2026-11-21T04:48:09Z — Claude Opus 5.5, Core and utils implemented; About page

- Modified: `core/storage.ts` (T29), `core/environment.ts` probes and model-cache functions (T30, T38; `shader-f16` in the WebGPU probe), `utils/helpers.ts` (T28), `Pages/AboutPage.tsx` (T50) implemented.
- Modified: *Technology stack* → fake-indexeddb (dev only).
- Modified: dev and preview servers send the production COOP/COEP headers (`vite.config.ts`).

### 2026-11-21T04:57:03Z — Claude Opus 5.5, Module decisions T22–T27

- Added: *Logic modules* → *Module decisions* (owner): recommendation rule and model cards (T22), `catalog.json` changes (T23), pre-flight policies with `shader-f16` and quota blocking (T24), dictionary sources and lookup (T25), affix and known-word data (T26), vocabulary schema, formats, and storage (T27).

### 2026-11-21T05:19:02Z — Claude Opus 5.5, Dictionary storage and pipeline decided (T42)

- Added: *Module decisions* → dictionary (T42): sharded JSON + index + manifest, on-demand shards with an opt-in offline download, pipeline in `training/dictionary/` with a wink step, build-time inflection index, `lookupKey`.
- Modified: *Deployment* → dictionary data row; skeleton → `training/dictionary/`.

### 2026-11-21T05:43:45Z — Claude Opus 5.5, i18n, PWA, and Stage 0 modules

- Added: *Layers* → `i18n/` (message catalogs and lookup; T68) and `pwa/` (service worker; T69).
- Added: *Services and hooks* → `languageService` / `useI18n`, `appUpdateService` / `useAppUpdate`.
- Added: *Deployment* → offline app shell (`sw.js`); `_headers` → `sw.js` no-cache.
- Modified: skeleton → i18n, pwa, `core/pwa.ts`, `UpdateBanner`, manifest and icons, `vocab/csv.ts`, `subword/knownWords.generated.ts`, test fixtures.

### 2026-11-21T06:00:49Z — Claude Opus 5.5, Model downloads (T47)

- Modified: *Model library* → *Behavior* → *Downloads*: retry limit, missing-files-only, cleanup scope on failure or cancel, concurrent calls, `persist()` owner.

### 2026-11-21T06:11:22Z — Claude Opus 5.5, parserService and parser hooks (T52)

- Added: *Model readiness* → *Service contract* (start, superseded choices and parses, cancel, delete, retry, progress throttle).
- Modified: `failed` status reasons gain `storage` (download did not fit); `parserService` row lists its actions.

### 2026-11-21T06:20:35Z — Claude Opus 5.5, VocabPage parts (T48)

- Added: component hierarchy and skeleton → `VocabLists`, `VocabListDetail`, `VocabItemRow`, `VocabTransfer` (page-specific parts of `VocabPage`; presentational, data via props from `useVocab`).

### 2026-11-21T06:41:53Z — Claude Opus 5.5, Model library, input, output, and diagnostics UI (T54–T57)

- Added: component hierarchy and skeleton → `ModelCard`, `SentenceView`, `FlatReading`, `NestedReading`, `OutputWord`, `WordDetails` (page parts), `Shared/ModelStatus`, `Shared/checkText.ts`; Header status badge opening `DiagnosticsPanel` (T24, T55).
- Modified: `output/annotator.ts` row and skeleton (`types.ts`, `index.ts`): the annotation model (T57).
- Modified: `parserService` keeps the input `draft` and stores the annotation (not the raw `ParseResult`); library snapshot carries each model's download size for this device.
- Modified: `parser/winkBackend.ts` no longer emits line breaks as words (paragraph breaks became a word at the start of the next sentence, which the model then parsed).

### 2026-11-21T07:18:46Z — Claude Opus 5.5, Local model testing; storage errors

- Added: *Deployment* → *Local model testing* (`npm run dev:models`, `vite.localModels.ts`, `optimizeDeps.include` for the worker's dependencies).
- Modified: `core/environment.ts` `downloadToCache`: a failing `cache.put` (quota, private windows) is an `AssetError("cache")`, so the model status says `storage`, not `network`.
- Changed: `NestedReading` shows phrase labels and word role badges only on hover or keyboard focus of the innermost box (2026-11-23T00:00:00Z, Claude Opus 5.5).
- Changed: `NestedReading` draws phrases as colored brackets at both ends instead of rounded boxes (no vertical padding per level) (2026-11-23T00:10:00Z, Claude Opus 5.5).
- Added: OutputPage nested-view toggles: labels always or on hover; phrases as boxes or brackets (`NestedLook`; defaults: brackets, on hover) (2026-11-23T00:20:00Z, Claude Opus 5.5).
