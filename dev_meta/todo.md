# Enparse Tasks

## Document Maintaining Guide

This guide applies to all contributors (human and AI) editing this file.

### Rules

1. **Direct edits.** Edits are made directly on the document. Existing content may be modified, reordered, or removed as needed.
2. **Changelog at bottom.** A 'Changelog' section must always exist at the bottom of the document. All changes made with each update are appended to the bottom of the changelog with a summary and timestamp. The [Author] field must be filled in with the username in the case of human contributors, and the model name in the case that an agent makes the update.
3. **Concise language.** Write in brief, clear English. Avoid unnecessary verbosity.
4. **Changelog format.** Each changelog entry must begin with a datetime stamp in ISO 8601 format (e.g., `2026-11-17T10:30:00Z`), followed by a bulleted list of what was added, modified, or removed.
5. **Task format.** Each task is an H4 heading that begins with an area tag, then the title, the task id, and its type: `#### [Area] Title · T00 · Decision|Build`. Below it: **Files** (all relevant source files), **Task** (brief description), and **Needs** (ids of tasks that must be finished first, or `—`).
   - **Area tags** name the project part: e.g. `[Training]`, `[Modules/parser]`, `[Core]`, `[Services/parser]`, `[Components/Pages]`, `[UI]`, `[Project]`.
   - **Decision** tasks are made by the owner. Agents may suggest a default marked **(proposed)** but must not decide.
   - **Build** tasks are implementation work.
6. **Ordered by dependency.** Tasks are grouped into stages. *Stage 0* tasks can start now. A task's stage is one higher than the highest stage among its *Needs*, so every task appears below everything it depends on. When a task is added or its *Needs* change, move it to the right stage.
7. **Stable ids.** Ids are never reused or renumbered. New tasks take the next free id.
8. **Done.** A finished task moves to *Done* (above the changelog) with its completion date and where its outcome is recorded (decisions go in `plan.md`, `architecture.md`, or `plan-training.md`). Tasks that listed it under *Needs* move up a stage if possible.
9. **New open questions** found during work become tasks here (this file replaces the former `plan.md` → *Undecided* list).

### Format template

```md
#### [Area] Title · T00 · Build

- **Files:** `path/a.ts`, `path/b.ts`
- **Task:** What needs to be done.
- **Needs:** T00, T00

## Changelog

### YYYY-MM-DDTHH:MM:SSZ — [Author], [Brief title]

- Added: ...
- Modified: ...
- Removed: ...
```

---

## Stage 0 — Ready now

#### [Modules/parser] How alternatives are displayed · T11 · Decision

- **Files:** `src/modules/parser/ambiguity.ts`, `src/modules/output/annotator.ts`, `src/components/Pages/OutputPage.tsx`
- **Task:** Decide how alternative parses are shown. The ambiguity margin itself (proposed 0.2) is set from Phase 8 (T58).
- **Needs:** —

#### [Project] Deployment target and asset hosting · T12 · Decision

- **Files:** `vite.config.ts`, `src/core/environment.ts`, `public/models/README.md`, `.gitattributes`, `dev_meta/agents.md` (*Parser and worker code*), `dev_meta/architecture.md` (*Model library*)
- **Task:** Choose the static host. Settle model hosting: all four models are ~0.4 GB int8 + ~0.8 GB fp16, beyond GitHub's free LFS quota and some per-file limits (options: fp16 only for some models, split ONNX external data, same-origin path to object storage). Decide whether assets may come from another origin (`agents.md` allows only the app's own host; changing that is an owner decision), whether the host can send COOP/COEP (multi-threaded WASM; GitHub Pages cannot), and where dictionary data is hosted. Needed before Phase 11. (Merges *Deployment target*, *Model library → Hosting*, `plan-training.md` → *Open questions* → *Hosting limits*, and Q&A 2026-11-19 conflict #1.)
- **Needs:** —

#### [Project] Tooling and frontend dependencies · T13 · Decision

- **Files:** `package.json`, `vite.config.ts`, `tsconfig.json`, `README.md`, `dev_meta/agents.md` (*Tooling and commands*)
- **Task:** Approve `react`, `react-dom`, `react-router-dom`, `@vitejs/plugin-react`; confirm the proposed ESLint + Prettier, React Testing Library, and Playwright; choose CI. First check that typescript-eslint and the React plugin support TypeScript 7.0.2 and Vite 8.3.8 without downgrades.
- **Needs:** —

#### [Project] MVP scope and milestone order · T14 · Decision

- **Files:** `dev_meta/plan.md`
- **Task:** Decide which features ship first (e.g., parser + model library before dictionary, subword, vocab) and the milestone order.
- **Needs:** —

#### [Project] Offline / PWA · T15 · Decision

- **Files:** `vite.config.ts`, `src/core/environment.ts`
- **Task:** Decide whether the app must work offline (would add a service worker / PWA plugin).
- **Needs:** —

#### [Project] Project license · T16 · Decision

- **Files:** `package.json`, `README.md`
- **Task:** Choose the app's license (models stay CC BY-SA 4.0 per Phase 1).
- **Needs:** —

#### [Project] Analytics and privacy · T17 · Decision

- **Files:** `dev_meta/agents.md`
- **Task:** Confirm that no usage tracking is collected (`agents.md` already forbids telemetry) or define what is allowed.
- **Needs:** —

#### [UI] Interface language and grammar labels · T18 · Decision

- **Files:** `src/index.html`, `src/components/**` (`strings` constants), `src/utils/helpers.ts`, `training/configs/catalog.yaml`
- **Task:** Korean, English, or bilingual (i18n needed?); whether chunk/phrase labels and roles are shown in Korean (e.g., 명사구, 주어).
- **Needs:** —

#### [UI] Target devices, browsers, and accessibility · T19 · Decision

- **Files:** `src/components/Layout/Layout.tsx`, `src/css/global.css`, `src/modules/preflight/requirements.ts`
- **Task:** Desktop only or responsive/mobile; minimum browser versions; accessibility standard (e.g., WCAG 2.1 AA).
- **Needs:** —

#### [UI] Visual design · T20 · Decision

- **Files:** `src/css/tokens.css`, `src/css/global.css`, `src/components/Layout/Header.tsx`, `src/components/Pages/OutputPage.module.css`
- **Task:** Branding, color palette, and parse-display style (tree, brackets, color-coded chunks).
- **Needs:** —

#### [UI] Attribution display · T21 · Decision

- **Files:** `src/components/` (new view), `src/routes.tsx`, `training/MODEL_CARD.md`, `dev_meta/architecture.md` (skeleton)
- **Task:** Decide where the app shows required attribution (UD EWT, CC BY-SA 4.0; model and data licenses). No page exists in the skeleton. Needed before Phase 11.
- **Needs:** —

#### [Modules/modelLibrary] Recommendation rule and model card presentation · T22 · Decision

- **Files:** `src/modules/modelLibrary/selection.ts`, `src/components/Pages/ModelsPage.tsx`
- **Task:** Confirm the **(proposed)** recommendation rule (among models not blocked and without memory warnings, highest chunk F1 that meets the 5 s budget; ties → smaller download). Decide which facts each model card shows and how accuracy is phrased for learners (numbers vs. labels like "most accurate").
- **Needs:** —

#### [Modules/modelLibrary] catalog.json schema changes · T23 · Decision

- **Files:** `src/modules/modelLibrary/types.ts`, `src/modules/preflight/checks.ts`, `training/scripts/package_models.py`, `dev_meta/architecture.md` (*Model library* → `catalog.json`)
- **Task:** Agent proposal (Q&A 2026-11-19 conflicts #6, #7): make `variants.int8` and `variants.fp16` each optional (ModernBERT may ship fp16 only; pre-flight blocks fp16-only models without WebGPU); allow multi-file ONNX (`.onnx` + `.onnx_data`); add nested-view metrics (UAS without punctuation, multi-word bracket F1, shown-bracket precision and coverage) to `metrics`.
- **Needs:** —

#### [Modules/preflight] Pre-flight policies · T24 · Decision

- **Files:** `src/modules/preflight/checks.ts`, `src/modules/preflight/requirements.ts`, `src/modules/preflight/preflight.ts`, `src/components/Shared/DiagnosticsPanel.tsx`
- **Task:** Confirm the proposed checks (workers, WASM SIMD/threads, WebGPU, Cache Storage, memory hint, `labels.json` schema, wink versions, storage quota, cached-file integrity). Decide: low memory warns (proposed) or blocks; low storage warns (proposed) or blocks, and whether to call `navigator.storage.persist()`; integrity failure → delete and re-download once, then fail (proposed); how much `DiagnosticsPanel` shows and whether it is reachable when nothing failed (proposed: Header status badge).
- **Needs:** —

#### [Modules/dictionary] Dictionary content · T25 · Decision

- **Files:** `src/modules/dictionary/types.ts`, `src/modules/dictionary/dictionary.ts`, `src/components/Pages/DictionaryPage.tsx`, `src/components/Shared/Tooltip.tsx`
- **Task:** Sources for English definitions, Korean translations, and examples, with redistribution licenses (permissive or compatible only); coverage (headword count); multiword expressions (phrasal verbs, idioms); sense selection (all senses or by context/POS); lookup trigger (selection, hover, click, tap; popup vs. `DictionaryPage`).
- **Needs:** —

#### [Modules/subword] Affix data and known-word list · T26 · Decision

- **Files:** `src/modules/subword/affixes.ts`, `src/modules/subword/subwordParser.ts`, `src/services/subwordService.ts`, `src/hooks/useSubword.ts`
- **Task:** Source, license, and size of the affix inventory (and what "frequently occurring" means); whether affixes have Korean glosses and examples. Source of the known-word list for base validation: a bundled list inside `subword/`, or dictionary headwords combined at the hook layer (services may import any module but not other services; Q&A 2026-11-19 conflict #4). If dictionary headwords are chosen, this waits on T25.
- **Needs:** —

#### [Modules/vocab] Vocabulary list design · T27 · Decision

- **Files:** `src/modules/vocab/types.ts`, `src/modules/vocab/vocabManager.ts`, `src/services/vocabService.ts`, `src/core/storage.ts`, `package.json`
- **Task:** Entry schema (word, definitions, Korean, example, source sentence, notes, tags, date added); canonical export format (JSON, CSV, zip) and schema versioning (`csv-stringify`, `csv-parse`, `jszip` need approval); Anki or other compatibility; import conflicts (merge, overwrite, duplicate); LocalStorage vs. IndexedDB threshold and backup/data-loss warnings.
- **Needs:** —

#### [Utils] helpers.ts · T28 · Build

- **Files:** `src/utils/helpers.ts`, `src/utils/helpers.test.ts`
- **Task:** String helpers (whitespace collapse, case folding), ISO date formatting, typed `debounce` / `throttle`, with tests. The on-screen date format waits on T18.
- **Needs:** —

#### [Core] storage.ts · T29 · Build

- **Files:** `src/core/storage.ts`, `src/core/storage.test.ts`
- **Task:** Async `get` / `set` / `remove` / `keys` over LocalStorage and IndexedDB, namespaced keys with a schema version, typed `StorageUnavailableError` / `StorageQuotaError`. `STORAGE_SIZE_THRESHOLD` is a **(proposed)** constant until T27.
- **Needs:** —

#### [Core] environment.ts probes · T30 · Build

- **Files:** `src/core/environment.ts`, `src/core/environment.test.ts`
- **Task:** `probeEnvironment()` (module workers, WASM SIMD/threads, WebGPU limits, device memory, Cache Storage, storage estimate, persisted), `requestPersistentStorage()`, and same-origin `fetchStaticJson()`, with stubbed-global tests. Cache functions are T38.
- **Needs:** —

#### [Core] Transformers.js cache and hashing spike · T31 · Build

- **Files:** `training/js/bench-page/`, `src/core/environment.ts`, `src/modules/modelLibrary/downloads.ts`
- **Task:** With a Vite worker and the Phase 7 smoke ONNX files, check that files written to Cache Storage by our own downloader are found by Transformers.js 4.3.2 (same cache name and URL keys; no duplicate download), and measure memory when hashing a ~300 MB file with `crypto.subtle.digest` (streaming hash or split files needed?). Q&A 2026-11-19 conflict #3.
- **Needs:** —

#### [Modules/parser] phraseLabeler.ts · T34 · Build

- **Files:** `src/modules/parser/phraseLabeler.ts`, `src/modules/parser/phraseLabeler.test.ts`, `src/modules/parser/types.ts`
- **Task:** Implement the approved conventions as a pure pass over `treeDecoder.ts` output (roles, `S` vs. `VP(Predicate)`, `isHead`, copula, coordination, `contiguous`). Confidence-gating behavior is T59.
- **Needs:** T10

#### [Modules/parser] Parser types, BIO grouping, and worker shell · T35 · Build

- **Files:** `src/modules/parser/types.ts`, `src/modules/parser/parser.ts`, `src/modules/parser/parser.worker.ts`, `src/modules/parser/index.ts`, tests
- **Task:** Finalize `ParseResult` / `SentenceParse` / `Token` (from *Module interfaces*), BIO grouping and repair, the worker message protocol, and the readiness guard (`ParserNotReadyError`), against a mocked `ParserBackend`. Adjust fields after T33 if needed.
- **Needs:** T08, T09, T10

#### [Training] Biaffine head and retrain of all four models · T51 · Build

- **Files:** `training/scripts/train.py`, `training/scripts/metrics.py`, `training/scripts/export_onnx.py`, `training/scripts/run_phase7.py`, `training/configs/train_*.yaml`, `training/reports/`
- **Status:** code done 2026-11-20 (`scripts/biaffine.py`; `train.py`/`evaluate.py`/`run_phase7.py --stage biaffine`; `prepare_data.py --encoding arc [--augment]`; tests `tests/test_biaffine.py`); run started 2026-11-19T23:14Z (`reports/training_biaffine.md`). **Paused 2026-11-20T00:15Z (owner; no AC power):** DistilBERT finished (test UPOS 96.82, chunk F1 95.59, UAS excl. punct 92.22, multi-word bracket F1 84.97; augmentation not used); DeBERTa's first run was stopped and its partial folder removed. Resume from `training/`: `sh scripts/run_phase7_overnight.sh --stage biaffine` (on AC power; finished runs are reused).
- **Task:** Replace group B head-position labels with a biaffine arc scorer plus relation classifier (keeping the ten-subtype allowlist from T03, set in `configs/`; current `rel_pos_v1` encoding and its tests unchanged), export arc scores as a second ONNX output, retrain all four (Phase 7 again), and evaluate against the nested-view targets. Design per `plan-training.md` → *Biaffine design* (T04, T06–T08): per-sentence arc masks, subword-level `[T, T]` arc scores, augmentation (`lowercase_sentence_start`, `drop_final_punct`) as an experiment kept only if dev does not drop, selection score and λ unchanged, learning-rate sweep adds 4e-4 and 5e-4 for DeBERTa-v3-xsmall and ModernBERT.
- **Needs:** T01, T04, T05, T06, T07, T08, T45

---

## Stage 1

#### [Modules/preflight] Pre-flight module · T36 · Build

- **Files:** `src/modules/preflight/checks.ts`, `src/modules/preflight/requirements.ts`, `src/modules/preflight/preflight.ts`, `src/modules/preflight/types.ts`, `src/modules/preflight/index.ts`, tests
- **Task:** Pure checks, severities, stage runners, and verdicts. Thresholds stay placeholders (`TODO(preflight-thresholds)`, T65). Keep `ModelManifest` ready for schema v2 (T33).
- **Needs:** T24, T30

#### [Modules/modelLibrary] Catalog and selection · T37 · Build

- **Files:** `src/modules/modelLibrary/types.ts`, `src/modules/modelLibrary/catalog.ts`, `src/modules/modelLibrary/selection.ts`, `src/modules/modelLibrary/index.ts`, fixture `catalog.json`, tests
- **Task:** Load and validate `catalog.json` against a fixture; persisted choice and recommendation.
- **Needs:** T22, T23, T29

#### [Core] environment.ts cache functions · T38 · Build

- **Files:** `src/core/environment.ts`, `src/core/environment.test.ts`
- **Task:** `MODEL_CACHE_NAME`, `listCached`, `downloadToCache` (progress, size and SHA-256, abort), `digestCachedFiles`, `deleteCachedFiles`, using what T31 found. Allowed asset origins follow T12.
- **Needs:** T12, T31

#### [App shell] Frontend tooling and app shell · T39 · Build

- **Files:** `package.json`, `vite.config.ts`, `README.md`, `src/main.tsx`, `src/routes.tsx`, `src/components/App.tsx`, `src/components/Layout/*`, `src/components/Shared/{Button,Modal,Tooltip,LoadingSpinner}.tsx`, `src/css/tokens.css`, `src/css/global.css`
- **Task:** Install the approved dependencies, enable the React plugin, add `npm run lint`, fill README setup; build the entry, hash routes, layout, and shared components with placeholder design tokens (refined after T20) and per-file `strings` constants.
- **Needs:** T13

#### [Modules/vocab] Vocab module and service · T40 · Build

- **Files:** `src/modules/vocab/types.ts`, `src/modules/vocab/vocabManager.ts`, `src/modules/vocab/index.ts`, `src/services/vocabService.ts`, tests
- **Task:** List and item CRUD, persistence with schema version and migration, export/import with conflict handling; service with `subscribe()` / `getSnapshot()`.
- **Needs:** T27, T29

#### [Modules/subword] Subword module and service · T41 · Build

- **Files:** `src/modules/subword/types.ts`, `src/modules/subword/affixes.ts`, `src/modules/subword/subwordParser.ts`, `src/modules/subword/index.ts`, `src/services/subwordService.ts`, tests
- **Task:** Affix inventory with recorded source and license; longest-match stripping with spelling rules; inflection from the wink lemma; injected `isKnownWord` predicate (false splits like *under* rejected).
- **Needs:** T26

#### [Modules/dictionary] Storage format, build pipeline, and lemmatization · T42 · Decision

- **Files:** `src/modules/dictionary/staticDb.ts`, `src/modules/dictionary/dictionary.ts`, `dev_meta/architecture.md` (skeleton; pipeline location not yet in it)
- **Task:** JSON vs. SQLite-WASM (new dependency needs approval); sharding, lazy loading, and offline caching; where the offline build scripts live; confirm headwords match wink lemma forms, and add an inflection → headword index so direct lookups on `DictionaryPage` (no wink on the main thread) resolve *ran* → *run* (Q&A 2026-11-19 conflict #5).
- **Needs:** T12, T25

#### [Training] Model display names and descriptions · T43 · Decision

- **Files:** `training/configs/catalog.yaml`, `src/components/Pages/ModelsPage.tsx`
- **Task:** Final display names and description texts (currently **(proposed)** English drafts), in the interface language.
- **Needs:** T18, T22

#### [Project] Plan the beta feedback feature · T44 · Decision

- **Files:** `dev_meta/architecture.md`, `dev_meta/plan-training.md` (Phase 12), `dev_meta/dev_agent_questions.md` (2026-11-18 feedback entry)
- **Task:** Decide whether and when to plan the feedback module, export format, annotation guidelines, and `ingest_feedback.py` described in the Q&A (sections a–d are not in the plan).
- **Needs:** T14

#### [Training] Phase 8 calibration · T58 · Build

- **Files:** `training/scripts/calibrate.py`, `training/configs/eval.yaml`, `labels.json` per model, `dev_meta/architecture.md` (margins per model)
- **Status:** code done 2026-11-20 (`scripts/calibrate.py`, `js/gating_eval.mjs`, `js/lib/gating.mjs`; tests `tests/test_calibrate.py`, `js/tests/gating.test.mjs`); runs when T51 finishes. Before running: add `calibration`/`ambiguity` settings to `configs/eval.yaml`, and compare the two bracket-confidence definitions (words in the bracket only, or also the head's outer dependents) on dev.
- **Task:** Arc and relation temperatures, ambiguity margin, attachment margin, and the bracket confidence threshold; report shown-bracket precision and coverage for the nested-view decision.
- **Needs:** T33, T51

---

## Stage 2

#### [Modules/dictionary] Dictionary build pipeline, module, and service · T46 · Build

- **Files:** dictionary build scripts (location from T42), `src/modules/dictionary/*`, `src/services/dictionaryService.ts`, tests
- **Task:** Compile source data into the static database; implement `staticDb.ts` and `lookup()` (lemma then surface form, POS ordering, LRU cache, `DictionaryLoadError`) and the service.
- **Needs:** T42

#### [Modules/modelLibrary] Downloads · T47 · Build

- **Files:** `src/modules/modelLibrary/downloads.ts`, tests
- **Task:** Per-model download state, progress, verification into Cache Storage, cancel, delete, retry once on a bad file.
- **Needs:** T37, T38

#### [Components/Pages] VocabPage and useVocab · T48 · Build

- **Files:** `src/hooks/useVocab.ts`, `src/components/Pages/VocabPage.tsx`, `src/components/Pages/VocabPage.module.css`, tests
- **Task:** Hook over `vocabService` with `useSyncExternalStore`; list management, export/import UI.
- **Needs:** T39, T40

#### [Hooks] useSubword · T49 · Build

- **Files:** `src/hooks/useSubword.ts`, tests
- **Task:** Expose `subwordService` to components (combine with dictionary headwords here if T26 chose that).
- **Needs:** T39, T41

#### [Components/Shared] Attribution view · T50 · Build

- **Files:** new component per T21, `src/routes.tsx`, `src/components/Layout/Sidebar.tsx`, `dev_meta/architecture.md`
- **Task:** Show data and model attribution and licenses; add it to the architecture skeleton.
- **Needs:** T21, T39

#### [Modules/parser] Confidence gating and role suppression · T59 · Decision

- **Files:** `src/modules/parser/treeDecoder.ts`, `src/modules/parser/phraseLabeler.ts`
- **Task:** Decide (and then build) how roles behave when low-confidence brackets collapse: drop, keep on the parent, or mark uncertain. Role accuracy is bounded by the model's UAS/LAS.
- **Needs:** T34, T58

#### [Modules/parser] ambiguity.ts · T60 · Build

- **Files:** `src/modules/parser/ambiguity.ts`, `src/modules/parser/ambiguity.test.ts`
- **Task:** Label alternatives from low-margin probabilities and attachment alternatives from biaffine arc-score margins / alternative trees, labeled through `phraseLabeler.ts`; cap at `MAX_ALTERNATIVES`.
- **Needs:** T11, T34, T45, T58

#### [Training] Phase 9 export and quantization · T61 · Build

- **Files:** `training/scripts/export_onnx.py`, `training/js/benchmark.mjs`, `training/scripts/evaluate.py`, `training/configs/eval.yaml`
- **Task:** Two-output export, int8 and fp16 variants, parity checks; ModernBERT may ship fp16 only.
- **Needs:** T58

---

## Stage 3

#### [Services/parser] parserService and parser hooks · T52 · Build

- **Files:** `src/services/parserService.ts`, `src/hooks/useParser.ts`, `src/hooks/useModelLibrary.ts`, tests
- **Task:** Status state machine (`idle` → … → `ready` / `failed`), pre-flight stages, model library actions, and the `ParserNotReadyError` guard, with a mocked backend.
- **Needs:** T35, T36, T37, T39, T47

#### [Components/Pages] DictionaryPage and useDictionary · T53 · Build

- **Files:** `src/hooks/useDictionary.ts`, `src/components/Pages/DictionaryPage.tsx`, `src/components/Pages/DictionaryPage.module.css`, tests
- **Task:** Direct lookup UI and the hook; lookup trigger per T25.
- **Needs:** T25, T39, T46

#### [Modules/parser] transformerBackend.ts · T63 · Build

- **Files:** `src/modules/parser/transformerBackend.ts`, `src/modules/parser/parser.worker.ts`, tests
- **Task:** Load the ONNX model with Transformers.js, per-word encoding (`tokenizer_word_encoding`), windows and merging (T04, T08), temperatures, label decoding, self-test parse.
- **Needs:** T08, T33, T35, T61

#### [Training] Phase 10 browser benchmarking · T64 · Build

- **Files:** `training/js/bench-page/`, `training/reports/benchmark.md`
- **Task:** Load and parse time, peak memory per model, browser, and backend; a lower-end device; per-model requirements for the catalog.
- **Needs:** T61

---

## Stage 4

#### [Components/Pages] ModelsPage · T54 · Build

- **Files:** `src/components/Pages/ModelsPage.tsx`, `src/components/Pages/ModelsPage.module.css`, tests
- **Task:** Model cards (facts per T22), recommendation, download progress, active model, delete.
- **Needs:** T22, T52

#### [Components/Shared] DiagnosticsPanel · T55 · Build

- **Files:** `src/components/Shared/DiagnosticsPanel.tsx`, `src/components/Shared/DiagnosticsPanel.module.css`, tests
- **Task:** Show the pre-flight report and model status with retry, at the detail level from T24.
- **Needs:** T24, T52

#### [Components/Pages] InputPage · T56 · Build

- **Files:** `src/components/Pages/InputPage.tsx`, `src/components/Pages/InputPage.module.css`, tests
- **Task:** Textarea with character count, drag-and-drop, too-long and removed-text notices; Parse enabled only when `useParser().canParse`, with the reason shown otherwise.
- **Needs:** T09, T52

#### [Modules/output, Components/Pages] Annotator and OutputPage · T57 · Build

- **Files:** `src/modules/output/types.ts`, `src/modules/output/annotator.ts`, `src/modules/output/index.ts`, `src/components/Pages/OutputPage.tsx`, `src/components/Pages/OutputPage.module.css`, tests
- **Task:** Annotation model and both views (flat chunks, nested phrases with roles), word selection, alternative switching, against mock `ParseResult` fixtures. Inline dictionary and subword lookup once T49 and T53 are done.
- **Needs:** T11, T34, T35, T39, T52

#### [Modules/preflight] Thresholds and multi-threaded WASM · T65 · Decision

- **Files:** `src/modules/preflight/requirements.ts`, `training/reports/benchmark.md`
- **Task:** Set memory hint, storage margin, and WebGPU buffer thresholds from Phase 10; decide whether single-threaded WASM (warning only) meets the 5 s budget, given the host's COOP/COEP support.
- **Needs:** T12, T36, T64

---

## Stage 5

#### [Project] End-to-end tests and CI · T62 · Build

- **Files:** `package.json` (`test:e2e`), Playwright config, CI config
- **Task:** Paste text → see chunks → look up a word → add to vocab → export; run lint, typecheck, unit, and e2e tests in CI.
- **Needs:** T13, T48, T53, T56, T57

#### [Training] Phase 11 packaging and release · T66 · Build

- **Files:** `training/scripts/package_models.py`, `public/models/`, `public/models/catalog.json`, `training/MODEL_CARD.md`
- **Task:** Package every offered model with filled `labels.json` and `catalog.json`, model card, release tag, and the in-app integration test per model.
- **Needs:** T12, T23, T43, T50, T52, T63, T64, T65

---

## Done

#### [Modules/parser] treeDecoder.ts MST decoding · T45 · Build

- **Done:** 2026-11-20. `decodeArcTree` (Chu-Liu-Edmonds, one root child; relation `root` iff head is root), `maxSpanningTree`, `headProbs` on `DecodedTree`, and Phase 8 gating (`bracketConfidence`, `gatePhrases`); the rel_pos_v1 `decodeTree` stays for reproducing Phase 7. Tests: brute-force optimality on random graphs (n ≤ 5), cycles, single root, relations, gating (`treeDecoder.test.ts`, 22 tests). Training: `js/lib/nested.mjs` → `decodeRecord` for both record types. Recorded in the `treeDecoder.ts` header and `architecture.md`.

#### [Training] labels.json schema v2 · T33 · Build

- **Done:** 2026-11-20. `prepare_data.py --encoding arc` writes `dataset_arc[_aug]/` with schema v2 (`groups.rel`, `dep_encoding: biaffine_v1`, `arc`, `relation_subtypes`, `tokenizer_word_encoding`, `window.long_sentence_overlap`, `calibration.{temperature, rel_temperature, arc_temperature}`, `nested.bracket_threshold`); `validate_labels_json` dispatches on version; `LabelConfig` and `LABEL_SCHEMA_VERSION = 2` updated; pre-flight headers name `SUPPORTED_SCHEMA_VERSION = 2` (the parity test comes with T36). Recorded in `plan-training.md` → Phase 4 schema v2.

#### [Modules/parser] Approve phraseLabeler.ts and its conventions · T10 · Decision

- **Done:** 2026-11-20 (owner approved the recommended options). Roles Subject, Predicate, Object, Indirect Object, Complement, Modifier plus Passive subject, Agent, Relative clause, Possessive, Particle; `S` promotion; single-word wrappers collapsed for display; discontinuous predicates labeled per piece with a split-predicate flag; copula → `VP(Predicate)` + `Complement`; coordination shares the outer role. Recorded in `architecture.md` → *Role labeling*, `plan-training.md`, and the `phraseLabeler.ts` header.

#### [Modules/parser] Input limit defaults · T09 · Decision

- **Done:** 2026-11-20 (owner). 5,000 characters (`MAX_INPUT_CHARS`) and 5 alternatives per sentence (`MAX_ALTERNATIVES`, labels and attachments together). Recorded in `architecture.md` → *Preprocessor* and *Ambiguity handling*, `textInput.ts`, `ambiguity.ts`.

#### [Training] Two-output ONNX spike (logits + arc_scores) · T05 · Build

- **Done:** 2026-11-20. Transformers.js 4.3.2 returns `logits` and `arc_scores` from `model.forward()`; all four smoke models export and pass fp32 parity exactly; int8 and fp16 pass for DistilBERT, DeBERTa, BERT; ModernBERT passes fp16 only (int8 confident agreement A 0.875 / arc 0.775). Fixes: head bias as multiply-and-sum; arc scorer kept fp32 in int8. Report `training/reports/smoke_test_biaffine.md`; recorded in `plan-training.md` → Phase 7.

#### [Training] Phase 7 error analysis · T32 · Build

- **Done:** 2026-11-20. `training/js/error_analysis.mjs` + `js/lib/errors.mjs` (tests in `js/tests/errors.test.mjs`; `npm run errors`) write `reports/errors.md` for the carried-forward checkpoints: all test errors by area and type, missed multi-word brackets by cause, repair-related and shared attachment errors, and a seeded sample of 100 errors per model with examples. Outcome in `plan-training.md` → Phase 7 (*Outcome, error analysis*).

#### [Modules/parser] BIO repair method and window merge rule · T08 · Decision

- **Done:** 2026-11-20 (owner). Rule repair: a stray `I-X` becomes `B-X` (matches seqeval's default mode used for reported chunk F1). Window merge: runtime packs whole sentences like training; only sentences over 256 subwords split, each word using the window where it is farthest from the edge. Recorded in `plan-training.md` → *Biaffine design* and `architecture.md` → *Parsing engine*.

#### [Training] Confirm proposed Phase 7 settings · T07 · Decision

- **Done:** 2026-11-20 (owner). Selection score (mean of dev chunk F1 and LAS) and λ fixed per model are confirmed; the retrain also sweeps learning rates 4e-4 and 5e-4 for DeBERTa-v3-xsmall and ModernBERT. Recorded in `plan-training.md` → Phase 7 hyperparameters and *Biaffine design*; `configs/eval.yaml` → `phase7.selection`.

#### [Training] Learner-style noise augmentation · T06 · Decision

- **Done:** 2026-11-20 (owner). `lowercase_sentence_start` and `drop_final_punct` run as an experiment in the biaffine retrain (T51), kept only if dev scores do not drop; `learner_typos` is out of v1. Recorded in `plan-training.md` → Phase 4 task 6 and *Biaffine design*.

#### [Training] Biaffine arc-score scope and window merging · T04 · Decision

- **Done:** 2026-11-20 (owner). Arcs only within the sentence plus root (UD sentence in training, wink sentence at runtime); subword-level `[T, T]` scores read at first subwords; runtime windows packed exactly like training. Recorded in `plan-training.md` → *Biaffine design*, `architecture.md` → *Context window*, `transformerBackend.ts` header.

#### [Training] Resume the Phase 7 extended run · T01 · Build

- **Done:** 2026-11-19 (owner resumed; finished 09:21Z, 0 failures). Results in `reports/training_extended.md`. Checkpoints carried forward (owner, 2026-11-20): extended for DeBERTa-v3-xsmall, BERT, ModernBERT; base for DistilBERT (`configs/eval.yaml` → `phase7_checkpoints`). Recorded in `plan-training.md` → Phase 7.

#### [Training] UD relation subtype allowlist for the biaffine relation classifier · T03 · Decision

- **Done:** 2026-11-19 (owner). The biaffine relation classifier keeps ten subtypes: `nsubj:pass`, `aux:pass`, `obl:agent`, `acl:relcl`, `nmod:poss`, `compound:prt`, `obl:unmarked`, `det:predet`, `advcl:relcl`, `cc:preconj`. `nmod:unmarked`, `nmod:desc`, `nsubj:outer`, `csubj:outer`, `csubj:pass` fold into their base relation. Recorded in `plan-training.md` → *Nested phrase structure* → *Head encoding*; the config entry is added with T51.

#### [Training] Fix superseded nested-view thresholds in training code · T02 · Build

- **Done:** 2026-11-19. `js/lib/nested.mjs` adds `tree_uas_no_punct` / `tree_las_no_punct` and `nested_multiword_f1` (labeled, ≥ 2 words); `run_phase7.py` judges the nested view by `acceptance.nested_view` (meeting both measurable targets → *pending Phase 8*, which measures shown-bracket precision), rescores cached nested files without the new metrics, and `--report-only` merges current nested scores into saved records. Superseded `acceptance.min_uas` / `min_las` removed from `configs/eval.yaml`. All 37 finished evaluations rescored; `reports/training.md` and `reports/training_extended.md` regenerated. Recorded in `plan-training.md` → Phase 7.

---

## Changelog

### 2026-11-19T05:09:52Z — Claude Opus 5.5, Created task list

- Added: Document Maintaining Guide (shared rules plus task format, dependency stages, stable ids, Done section).
- Added: tasks T01–T66. Sources: every item of the former `plan.md` → *Undecided* list (removed from `plan.md`), `plan-training.md` → *Open questions* (removed there), remaining training phases 7–11, the Tier A/B work and conflicts from `dev_agent_questions.md` (2026-11-19), and the stopped Phase 7 extended run.

### 2026-11-19T05:31:24Z — Claude Opus 5.5, T02 done; T01 cause; T03 proposal

- Modified: T01 — cause of the stop (machine moved off AC power) and owner resumes it.
- Modified: T03 — owner decided to keep learner-relevant subtypes; proposed allowlist from the 15 EWT subtypes awaits review.
- Modified: T02 moved to *Done* with outcome.

### 2026-11-19T06:59:42Z — Claude Opus 5.5, T03 done

- Modified: T03 moved to *Done* (owner kept the ten "Keep" and "Your call" subtypes; five folded into base). T51 notes the allowlist goes into `configs/` with the biaffine implementation.

### 2026-11-19T22:40:35Z — Claude Opus 5.5, Phase 7 closed; T01, T04, T06–T08, T32 done

- Modified: T01, T04, T06, T07, T08, T32 moved to *Done* with outcomes (owner decisions for T04, T06–T08; checkpoints carried forward per model).
- Modified: T51 task text adds the biaffine design decisions and the 4e-4 / 5e-4 learning rates for DeBERTa-v3-xsmall and ModernBERT.
