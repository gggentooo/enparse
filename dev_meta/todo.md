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

#### [Training] Model display names and descriptions · T43 · Decision

- **Files:** `training/configs/catalog.yaml`, `src/components/Pages/ModelsPage.tsx`
- **Task:** Final display names and description texts (currently **(proposed)** English drafts), in the interface language.
- **Needs:** T18, T22

#### [Project] Plan the beta feedback feature · T44 · Decision

- **Files:** `dev_meta/architecture.md`, `dev_meta/plan-training.md` (Phase 12), `dev_meta/dev_agent_questions.md` (2026-11-18 feedback entry)
- **Task:** Decide whether and when to plan the feedback module, export format, annotation guidelines, and `ingest_feedback.py` described in the Q&A (sections a–d are not in the plan).
- **Needs:** T14

#### [Modules/preflight] Thresholds and multi-threaded WASM · T65 · Decision

- **Files:** `src/modules/preflight/requirements.ts`, `training/reports/benchmark.md`
- **Task:** Set memory hint, storage margin, and WebGPU buffer thresholds from Phase 10; decide whether single-threaded WASM (warning only) meets the 5 s budget, given the host's COOP/COEP support. Phase 10 inputs (`reports/benchmark.md`): ModernBERT int8 exceeds 5 s on 2 cores (5.2 s) yet fits in 4 GB, so its limit is speed (cores / fp16 WebGPU), not memory; the proposed `min_device_memory_gb` (DeBERTa 4, ModernBERT 8) should be revisited with this.
- **Needs:** T12, T36, T64, T67

#### [Training] Dictionary build pipeline · T70 · Build

- **Files:** `training/dictionary/` (Python: fetch, extract, merge, inflections, shard), `training/configs/dictionary.yaml`, `training/js/dict_lemmas.mjs` (tsx step), `training/tests/`, a dictionary data card (sources, versions, licenses, attribution), `functions/` (a `/dict/*` route), `dev_meta/plan-training.md`
- **Task:** Per T25/T42: pin and checksum the sources (Open English WordNet, kaikki.org Wiktionary English extract, Tatoeba EN–KO pairs, NGSL) and re-check their licenses; select ~10–20k headwords (NGSL + frequent EWT words) and phrasal verbs; build entries (senses by part of speech, Korean translations, examples); build the inflection index (Wiktionary forms + WordNet exceptions), verifying forms and headwords with the app's wink lemmatizer and `lookupKey`; write the index, ~64–256 hash shards, and a manifest (version, sizes, SHA-256, sources, licenses); report coverage (share of EWT test words and wink lemmas that resolve, entry counts, sizes). Serve from R2 under a versioned same-origin path (proposed `/dict/v<N>/`) with a Pages Function route like `/models/*`. Attribution text goes to the About page.
- **Needs:** T71

---

## Stage 1

#### [Modules/dictionary] Dictionary module and service · T46 · Build

- **Files:** `src/modules/dictionary/*` (`staticDb.ts`, `dictionary.ts`, `types.ts`, `index.ts`), `src/services/dictionaryService.ts`, tests
- **Task:** Per T42: load the manifest and index on first lookup; fetch entry shards on demand into the `enparse-dict-v<N>` cache with size and SHA-256 checks (`core/environment.ts` T38 functions), small in-memory LRU of shards; `lookup()`: `lookupKey` exact match, then the inflection index, and for parse clicks the token's wink lemma first; senses ordered with the predicted part of speech first; `DictionaryLoadError`; `downloadAll(onProgress, signal)` and `deleteAll()` for the offline option; service with `subscribe()` / `getSnapshot()` (offline state, progress).
- **Needs:** T70

#### [Training] Phase 11 packaging and release · T66 · Build

- **Files:** `training/scripts/package_models.py`, `public/models/`, `public/models/catalog.json`, `training/MODEL_CARD.md`
- **Task:** Package every offered model with filled `labels.json` and `catalog.json`, model card, release tag, and the in-app integration test per model. Add the base model's license to `catalog.json` so the About page can read its model credits from the catalog (`TODO(T66)` in `AboutPage.tsx`).
- **Needs:** T12, T23, T43, T50, T52, T63, T64, T65

---

## Stage 2

#### [Components/Pages] DictionaryPage and useDictionary · T53 · Build

- **Files:** `src/hooks/useDictionary.ts`, `src/components/Pages/DictionaryPage.tsx`, `src/components/Pages/DictionaryPage.module.css`, tests
- **Task:** Direct lookup UI and the hook; lookup trigger per T25. Typed inflected forms resolve through the inflection index (T42: *ran* → *run*; ambiguous forms list every headword).
- **Needs:** T25, T39, T46

#### [Components/Pages] Offline dictionary control · T72 · Build

- **Files:** `src/components/Pages/ModelsPage.tsx` (or the settings location chosen in T54), `src/hooks/useDictionary.ts`, tests
- **Task:** "Make dictionary available offline" with size, byte progress, cancel, delete, and a pre-flight storage check (T24: block if it cannot fit), next to the model downloads (T15 full PWA; T42 opt-in offline download).
- **Needs:** T46, T54

---

## Stage 3

#### [Project] End-to-end tests and CI · T62 · Build

- **Files:** `package.json` (`test:e2e`), Playwright config, CI config
- **Task:** Paste text → see chunks → look up a word → add to vocab → export; run lint, typecheck, unit, and e2e tests in CI.
- **Needs:** T13, T48, T53, T56, T57

---

## Done

#### [Components/Pages] ModelsPage · T54 · Build

- **Done:** 2026-11-21. `ModelsPage` + `ModelCard`: labels (recommended, most accurate, fastest here, in use), device fit with reasons and hints, download state with byte progress, use / download only / cancel / delete (confirmed; warns when active), "Details" with accuracy, size, expected speed, structure view, license, base model (T22, T21); first-visit notice; catalog descriptions shown as English drafts until T43. Download size per device variant comes from `parserService`. Tests: `ModelsPage.test.tsx`.

#### [Components/Shared] DiagnosticsPanel · T55 · Build

- **Done:** 2026-11-21. `DiagnosticsPanel` (device and model stages, failures first, status as text with marks, hints per check, measured / required with units), `ModelStatus` (status line with progress, retry, details dialog), Header status badge opening the panel (T24). Tests: `DiagnosticsPanel.test.tsx` (includes the Header badge).

#### [Components/Pages] InputPage · T56 · Build

- **Done:** 2026-11-21. Textarea kept as the `parserService` draft (survives page changes and model loading), live count in code points vs 5,000, too-long error, `.txt` drag-and-drop, Parse only when ready (`ModelStatus` explains why), parse errors, navigation to the output. Removed-text notice is on `OutputPage`. Tests: `InputPage.test.tsx`.

#### [Modules/output, Components/Pages] Annotator and OutputPage · T57 · Build

- **Done:** 2026-11-21. `modules/output` (`annotate`, structural input type checked against `ParseResult`), wired into `parserService.parseText`. `OutputPage` with `SentenceView` ("Other readings (n)" radio group; T11), `FlatReading` (chunk highlights with type tags; T20), `NestedReading` (category · role boxes, head marks, dashed badges for uncertain roles; T59), `OutputWord`, `WordDetails` (base form, part of speech in the shown reading, word parts via `useSubword`, add to list via `useVocab`). Dictionary lookup in the panel follows with T53. Fixed on the way: `winkBackend.tokenize` made paragraph breaks a word. Checked end to end in Chrome with the trained DeBERTa export served locally (download, verify, load 1.8 s; parse; both views; a real alternative reading; word details; keyboard selection; narrow and dark). Tests: `annotator.test.ts`, `OutputPage.test.tsx`, `winkBackend.test.ts`.

#### [Components/Pages] VocabPage and useVocab · T48 · Build

- **Done:** 2026-11-21. `useVocab` (snapshot via `useSyncExternalStore`, loads on first use, service actions). `VocabPage` with page parts `VocabLists` (select, create), `VocabListDetail` (rename, delete with confirmation, add a word by hand: word, Korean meaning, notes, tags), `VocabItemRow` (edit, move, remove with confirmation; duplicate badge), `VocabTransfer` (JSON/CSV download, import with a merge / new list / skip dialog on name conflicts, summary); backup reminder and action errors shown from the snapshot; Korean and English strings. Checked in Chrome (wide, narrow, dark; keyboard: dialog focus and return). Tests: `useVocab.test.ts`, `VocabPage.test.tsx` (real service, fake-indexeddb).

#### [Hooks] useSubword · T49 · Build

- **Done:** 2026-11-21. `useSubword` (`segment(word, lemma)`, `clear()`; loading and error state; stale responses ignored). T26 bundles the known-word list in `subword/`, so no dictionary headwords are combined. Tests: `useSubword.test.ts`.

#### [Services/parser] parserService and parser hooks · T52 · Build

- **Done:** 2026-11-21. `parserService` (`createParserService(deps)` with injected modules and worker): `start()` (device checks → catalog, states, fitness, recommendation, badges → saved choice loaded only if fully cached), `chooseModel` (download with throttled progress, `persist()` after the first download, model checks with one re-download of corrupt files, worker load → `ready`, saved choice), `downloadModel`, `cancelDownload`, `deleteModel` (unloads the active model, clears its saved choice), `retryLoad`, `parseText` (`ParserNotReadyError` guard without a worker call, preprocess, `ParseSupersededError` for stale parses). New `failed` reason `storage`; `ModelUnavailableError` for unknown or blocked models. Hooks `useParser` and `useModelLibrary` (optional service argument for tests). Started in `main.tsx`. Parse output is the raw `ParseResult` until the annotator (T57). Tests: `parserService.test.ts`, `useParser.test.ts`, `useModelLibrary.test.ts`.

#### [Modules/modelLibrary] Downloads · T47 · Build

- **Done:** 2026-11-21. `downloads.ts`: `getModelStates` (cached sizes vs. catalog, live progress while downloading, `corrupted` after a failed verification), `downloadModel` (missing files only, overall byte progress, `downloadToCache` size + SHA-256 check, a bad file deleted and fetched once more, `ModelDownloadError` with `integrity` / `cancelled` / `quota` / `network`), `cancelDownload` (abort, delete this run's files), `deleteModel` (all variants); `createDownloads(cache)` for injected tests. Failed or cancelled downloads delete only the files they stored, so shared files of another cached variant stay. `storage.persist()` after the first download is left to `parserService` (T52). Tests: `downloads.test.ts`.

#### [App shell] Offline / PWA · T69 · Build

- **Done:** 2026-11-21. Hand-written service worker (owner): `src/pwa/sw.ts` + tested `swRules.ts`, built into `dist/sw.js` by a Vite plugin with the precache list and version hash; never handles `/models/*` or `/dict/*`; offline page loads keep COOP/COEP; manifest and placeholder icons; `core/pwa.ts`, `appUpdateService`, `UpdateBanner`. Checked in Chrome: offline reload works and stays isolated, models not intercepted, update banner switches versions and deletes the old shell cache.

#### [Core/UI] i18n plumbing and Korean UI text · T68 · Build

- **Done:** 2026-11-21. `src/i18n/` (typed `en` reference catalog, `ko` default; grammar labels "명사구 (NP)", "주어 (Subject)"), `translate`, display dates; `languageService` (persisted, sets `<html lang>`), `useI18n`, header language menu (owner); every component uses catalog keys. Checked in Chrome (Korean default, switch, persists across reload).

#### [Modules/subword] Subword module and service · T41 · Build

- **Done:** 2026-11-21. Own affix list (85: 42 prefixes, 43 suffixes; Bauer & Nation levels; Korean glosses and examples), segmenter (inflection from the lemma, spelling restoration, every step through a known word, reviewed `NO_SPLIT` list from all NGSL headwords), known-word list generated from pinned NGSL 1.2 (CC BY-SA 4.0; `training/js/build_known_words.mjs`; loaded lazily), `subwordService`, About-page credit. Tests: `subwordParser.test.ts`, `subwordService.test.ts`.

#### [Modules/vocab] Vocab module and service · T40 · Build

- **Done:** 2026-11-21. `VocabManager` (lists and items in IndexedDB, duplicate flagging, schema migration, JSON + CSV export, import merging by id with a name-conflict callback, backup reminder after 7 days **(proposed)**), hand-written CSV codec, `vocabService` with snapshots. Tests with fake-indexeddb.

#### [Modules/modelLibrary] Catalog and selection · T37 · Build

- **Done:** 2026-11-21. Catalog types per T23 (optional variants, nested-view metrics, `labels.json` with size and SHA-256), `parseCatalog`/`loadCatalog`, `variantFor`, `modelFiles`, `downloadBytes`, `requirementsOf` (pre-flight input), saved choice, `recommendModel` (owner rule T22), `cardBadges`. Fixture `catalog.fixture.json` generated from the Phase 9 exports. Downloads remain T47.

#### [Modules/preflight] Pre-flight module · T36 · Build

- **Done:** 2026-11-21. `checks.ts` (pure checks incl. WebGPU `shader-f16` and buffer limits, storage: download that cannot fit → fail, tight → warn; memory hints warn), `requirements.ts` (owner T24 severities; thresholds **(proposed)** until T65), `preflight.ts` (`runDeviceChecks`, `assessModels`, `runModelChecks` deleting corrupt cached files), `types.ts`, `index.ts`. Tests: `checks.test.ts`, `preflight.test.ts` (incl. schema version = parser).

#### [Modules/parser] wink lemmas for runtime words · T71 · Build

- **Done:** 2026-11-21. `winkBackend.tokenize` gives every word a lemma (wink in context; contraction pieces split here via `CONTRACTION_LEMMAS`; merged words keep their form); `lemmaOf()` exported for the dictionary pipeline; `Token.lemma` filled. Tests in `winkBackend.test.ts`.

#### [Modules/dictionary] Storage format, build pipeline, and lemmatization · T42 · Decision

- **Done:** 2026-11-21 (owner chose the recommended option for all five parts). Sharded static JSON + index + manifest (no new dependency); shards on demand in a versioned Cache Storage cache with an opt-in offline download; pipeline in `training/dictionary/` (Python) plus a `training/js` wink step; build-time inflection index checked against wink, with wink lemmas for parse clicks; `lookupKey` for all keys. Builds: T71, T70, T46, T72. Recorded in `architecture.md` → *Module decisions* and `plan-training.md` → *Training directory layout*.

#### [Modules/vocab] Vocabulary list design · T27 · Decision

- **Done:** 2026-11-21 (owner). Full entry schema; versioned JSON + CSV (hand-written codec); merge by id, flag duplicates, ask on list-name collisions; lists in IndexedDB, settings in LocalStorage; backup reminder. Recorded in `architecture.md`.

#### [Modules/subword] Affix data and known-word list · T26 · Decision

- **Done:** 2026-11-21 (owner). Own curated affix list (~80–120, Bauer & Nation levels) with own Korean glosses and examples; known-word list bundled in `subword/`. Recorded in `architecture.md`.

#### [Modules/dictionary] Dictionary content · T25 · Decision

- **Done:** 2026-11-21 (owner). Open English WordNet definitions, Wiktionary (kaikki.org) Korean translations, Tatoeba EN–KO examples; ~10–20k headwords (NGSL + frequent EWT words); phrasal verbs only; all senses, predicted POS first; click/tap → popup → DictionaryPage. Licenses to re-check before release. Recorded in `architecture.md` and `plan.md`.

#### [Modules/preflight] Pre-flight policies · T24 · Decision

- **Done:** 2026-11-21 (owner). All checks plus WebGPU `shader-f16`; low memory warns; storage blocks a download that cannot fit, warns when tight, `persist()` after the first download; no `shader-f16` → int8; integrity → delete, re-download once, then fail; diagnostics via a header badge. Recorded in `architecture.md`.

#### [Modules/modelLibrary] catalog.json schema changes · T23 · Decision

- **Done:** 2026-11-21 (owner). Nested-view metrics added; int8/fp16 variants each optional; no multi-file ONNX. Recorded in `architecture.md` (*Module decisions*, `catalog.json` table).

#### [Modules/modelLibrary] Recommendation rule and model card presentation · T22 · Decision

- **Done:** 2026-11-21 (owner). Proposed rule confirmed (highest chunk F1 within 5 s on this device; ties → smaller download; DeBERTa today); cards lead with a label, numbers behind "details". Recorded in `architecture.md` → *Module decisions*.

#### [UI] Visual design · T20 · Decision

- **Done:** 2026-11-21 (owner). Color-coded chunk highlights with text labels (flat), nested boxes with role badges (nested), colorblind-safe palette. Recorded in `plan.md`.

#### [UI] Target devices, browsers, and accessibility · T19 · Decision

- **Done:** 2026-11-21 (owner). Desktop-first, responsive; last two versions of Chrome, Edge, Firefox; Safari 26+; WCAG 2.1 AA. Recorded in `plan.md`.

#### [UI] Interface language and grammar labels · T18 · Decision

- **Done:** 2026-11-21 (owner). Korean UI; grammar labels in Korean with the English term ("명사구 (NP)", "주어 (Subject)"); i18n plumbing so more languages (e.g. Japanese, Chinese) can be added (build: T68). Recorded in `plan.md` and `agents.md`.

#### [Project] Analytics and privacy · T17 · Decision

- **Done:** 2026-11-21 (owner). No tracking at all (confirms `agents.md`). Recorded in `plan.md` and `agents.md`.

#### [Project] Project license · T16 · Decision

- **Done:** 2026-11-21 (owner). PolyForm Noncommercial 1.0.0 for the app code, with `Required Notice: Copyright Hankyung Lee (https://github.com/gggentooo/enparse)` (owner asked for credit to the source and creator and no commercial use; Apache-2.0 could not forbid commercial use). Added `LICENSE.md` (official 1.0.0 text), `package.json` `license`, README and About page notices (tested identical). Recorded in `plan.md` and `agents.md`.

#### [Project] Offline / PWA · T15 · Decision

- **Done:** 2026-11-21 (owner). Full PWA in v1 (installable; app shell offline; models already in Cache Storage). Build: T69. Recorded in `plan.md`.

#### [Project] MVP scope and milestone order · T14 · Decision

- **Done:** 2026-11-21 (owner). M1: model library + parse + flat/nested views + alternatives + dictionary → M2: vocabulary + subword. Recorded in `plan.md` → *Product decisions*.

#### [Components/Shared] Attribution view · T50 · Build

- **Done:** 2026-11-21. `Pages/AboutPage.tsx` (`#/about`, sidebar link): app (license pending T16), offered models with base-model and trained-weights licenses, UD EWT attribution (identical to `training/MODEL_CARD.md`, enforced by `AboutPage.test.tsx`), runtime libraries with licenses, dictionary sources (none yet; T25). External links open in a new tab with `noopener noreferrer`. Models come from a static list until the catalog hook exists (`TODO(T54)`). Checked in Chrome.

#### [Core] environment.ts cache functions · T38 · Build

- **Done:** 2026-11-21. `MODEL_CACHE_NAME = "transformers-cache"`, `sameOriginUrl`, `listCached`, `downloadToCache` (streamed, byte progress, size and SHA-256 checked before anything is stored, abortable), `digestCachedFiles`, `deleteCachedFiles`, typed `AssetError` (origin, http, size, sha256, cache). Follows the T31 contract (absolute same-origin URL keys). Tests: `environment.test.ts`.

#### [Core] environment.ts probes · T30 · Build

- **Done:** 2026-11-21. `probeEnvironment()` (module workers, WASM SIMD and threads, cross-origin isolation, WebGPU limits and `shader-f16`, device memory, cores, Cache Storage, storage estimate, persisted; each probe reports "unknown" on failure, slow ones time out after `PROBE_TIMEOUT_MS`), `requestPersistentStorage()`, same-origin `fetchStaticJson()`. Checked in Chrome. Dev and preview servers now send COOP/COEP. Tests: `environment.test.ts`.

#### [Core] storage.ts · T29 · Build

- **Done:** 2026-11-21. `createStorage()` / `appStorage()`: async `get` / `set` / `remove` / `keys` over LocalStorage and IndexedDB, keys `enparse:v1:<key>`, values above `STORAGE_SIZE_THRESHOLD` (100,000 JSON characters, **(proposed)** until T27) go to IndexedDB, one copy per key, fallback when a backend is missing, typed `StorageUnavailableError` / `StorageQuotaError`. Tests with jsdom and fake-indexeddb (owner-approved dev dependency).

#### [Utils] helpers.ts · T28 · Build

- **Done:** 2026-11-21. `collapseWhitespace`, `foldCase` (NFKC + lower case), `lookupKey`, `formatIsoDate`, `formatIsoTimestamp` (UTC), typed `debounce` / `throttle` with `cancel`. On-screen date format waits for T18. Tests: `helpers.test.ts`.

#### [Training] Phase 10 on a lower-end device · T67 · Build

- **Done:** 2026-11-21 (owner's Windows 11 ARM VM in UTM: 4 GB RAM, 2 vCPUs, Chrome 158; no physical low-end device available). `bench_browsers.mjs --serve` + suite page + `bench-page/vm-sampler.ps1` over an SSH tunnel. DeBERTa int8: 1.34 s median parse, cold load 5.1 s; ModernBERT int8: 5.17 s (over budget); both ran in 4 GB without a crash (≤ 0.9 GB growth). fp16 failed: the VM's WebGPU adapter has no `shader-f16`. Caveat: VM cores are M5 Pro cores, so physical low-end devices will be slower. Recorded in `reports/benchmark.md` and `plan-training.md` → Phase 10.

#### [Training] Phase 10 browser benchmarking · T64 · Build

- **Done:** 2026-11-21 (development machine; lower-end device split out as T67). `js/bench_browsers.mjs` + `bench-page/` run the app's parser worker in Chrome 158 (Playwright, system Chrome) and Safari 27 (`open -a Safari`; WebDriver sessions timed out here), with COOP/COEP and `/models/*` emulating R2; `js/bench_report.mjs` writes `reports/benchmark.md`. All model × browser × variant parses of the 4,945-character sample are within 5 s (fastest: ModernBERT fp16 148 ms Chrome; slowest: ModernBERT int8 1.48 s; one WASM thread 4.9 s). Proposed `min_device_memory_gb`: DeBERTa 4, ModernBERT 8. Recorded in `plan-training.md` → Phase 10.

#### [Modules/parser] ambiguity.ts · T60 · Build

- **Done:** 2026-11-21. `buildAlternatives`: label alternatives (second-best group A label where the top-two gap < `ambiguity.margin`; subsets of up to 10 words, BIO-valid only) and PP-attachment alternatives (obl/nmod with a `case` dependent whose top-two head gap < `attachment_margin`; MST with the head fixed), ranked by probability relative to the primary parse, capped at 5; each carries `changes` (words to mark; T11), chunks, and the labeled nested view. Rules match Phase 8's counting. `parser/bio.ts` (BIO helpers) and `phraseLabeler.ts` → `labeledView` shared with `parser.ts`. Benchmark sample: 11 of 51 sentences get alternatives; textbook ambiguities ("saw the man with the telescope") get none because the calibrated model is confident (0.85 vs 0.09). Tests: `ambiguity.test.ts`.

#### [App shell] Frontend tooling and app shell · T39 · Build

- **Done:** 2026-11-21. Entry (`main.tsx`), hash routes (`routes.tsx`, `paths.ts`; index and unknown paths → `#/input`; `#/about` added), `App` with route error fallback, `Layout` (skip link, header, sidebar, content; narrow-screen layout), `Sidebar` (NavLink, `aria-current`), shared `Button`, `LoadingSpinner`, `Modal` (native `<dialog>`), `Tooltip`; placeholder design tokens (Okabe–Ito chunk colors, dark mode) and global CSS; placeholder pages until their tasks; README setup. Checked in Chrome (wide, narrow, dark; keyboard skip link). Tests: `routes.test.tsx`, `Shared.test.tsx` (jsdom). Bundle: 101 KB gzipped. English placeholder strings until T18.

#### [Core] Transformers.js cache and hashing spike · T31 · Build

- **Done:** 2026-11-21 (Chrome 158, Safari 27). Files stored by our own downloader in Cache Storage `transformers-cache` under `<origin>/models/<model>/<file>` are reused by Transformers.js 4.3.2: no model file is fetched again. Whole-file `crypto.subtle.digest` on 302 MB: ≤ 0.26 s, no streaming hash needed. Private windows may lack quota (`cache.put` failed for 302 MB). Found and fixed: Transformers.js loads ONNX Runtime's WASM from cdn.jsdelivr.net by default; the app now serves it from `/models/_ort/` (R2). Recorded in `architecture.md` → *Cache contract*, *Deployment*, and `reports/benchmark.md`.

#### [UI] Attribution display · T21 · Decision

- **Done:** 2026-11-21 (owner). An *About & licenses* page (`#/about`, sidebar link) lists app, models, training data (UD English EWT, CC BY-SA 4.0), runtime libraries, and dictionary sources with licenses; each model card shows its license and source. Built in T50. Recorded in `architecture.md` → *Routing*, component hierarchy, and skeleton.

#### [Project] Tooling and frontend dependencies · T13 · Decision

- **Done:** 2026-11-21 (owner). Installed (exact pins): react / react-dom 19.3.1, react-router 8.5.2, `@vitejs/plugin-react` 6.3.0 (enabled in `vite.config.ts`), `@types/react(-dom)` 19.3.0, oxlint 1.94.0 + Prettier 3.10.1 (`printWidth` 120; `npm run lint`, `npm run format`), React Testing Library 16.3.3 + `@testing-library/dom` 10.4.2 + jsdom 31.0.1, Playwright 1.65.1 (browsers installed with T62). CI: GitHub Actions without LFS checkout (`.github/workflows/ci.yml`). ESLint not used (typescript-eslint supports TypeScript < 6.1 only). License scan: only the accepted `sharp-libvips` and `lightningcss` exceptions. Recorded in `agents.md` → *Tooling and commands* and `architecture.md` → *Technology stack*.

#### [Project] Deployment target and asset hosting · T12 · Decision

- **Done:** 2026-11-21 (owner). Cloudflare Pages for the app; model files in R2, served on the same origin at `/models/*` by a Pages Function (`functions/models/[[path]].ts`, byte ranges, tests); COOP/COEP via `public/_headers`; `public/models/` (Git LFS, source of truth) is left out of `dist/` and uploaded to R2 in Phase 11. Dictionary data follows the same pattern (proposed; T42). Recorded in `architecture.md` → *Deployment* and `agents.md` → *Parser and worker code*. Open checks in T31: Range streaming into Cache Storage, Function quotas.

#### [Modules/parser] How alternatives are displayed · T11 · Decision

- **Done:** 2026-11-21 (owner). Primary parse shown with ambiguous words and phrases marked; each sentence with alternatives gets an "Other readings (n)" control that switches the whole sentence view (flat and nested); label and attachment alternatives share it. Recorded in `architecture.md` → *Ambiguity handling* item 6.

#### [Modules/parser] transformerBackend.ts · T63 · Build

- **Done:** 2026-11-21. Transformers.js backend: per-word encoding (`tokenizer_word_encoding`), windows packed like training (long sentences split with overlap; each word scored in the window where it is farthest from the edge), calibrated decoding (group A with summed UPOS/chunk probabilities, relations, arc rows), `labels.json` validation, typed load-failure reasons, structural self-test; fp16 → WebGPU, int8 → WASM. Integration test: the Phase 9 DeBERTa export (fp16, Node) reproduces PyTorch's labels and heads on the reference sentences, and the full `Parser` labels a clause end to end; ModernBERT int8 checked ad hoc. Open: expected-label self-test needs a `labels.json` field from Phase 11 (`TODO(self-test-expected)`), Cache Storage wiring waits for T31.

#### [Training] Phase 9 export and quantization · T61 · Build

- **Done:** 2026-11-21. DeBERTa-v3-xsmall and ModernBERT exported with two outputs; int8 and fp16 pass parity for both (chunk F1 / LAS within 0.13 points of fp32; fp32 agrees 100% with PyTorch), so both ship both variants. Word encoding `plain` for both. `evaluate.py --parity` implemented. Exports in `training/data/onnx/<model>/<run>/`. Recorded in `training/reports/parity.md` and `plan-training.md` → Phase 9.

#### [Modules/parser] Confidence gating and role suppression · T59 · Decision

- **Done:** 2026-11-21 (owner). Roles of collapsed brackets become badges on their head words (never moved to an inner bracket); roles are gated by relation × head probability at `nested.role_threshold`, fitted in Phase 8 for ≥ 95% dev role precision (0.4 for both offered models; test role precision 96.06% / 95.99%, 97% / 96% of roles shown). Built in `phraseLabeler.ts`, `treeDecoder.ts` (`relationProbs`), `js/lib/gating.mjs` (`roleCurve`), `calibrate.py`; labels.json v2 gains `nested.role_threshold`. Recorded in `architecture.md` → *Role labeling* and `plan-training.md` → Phase 8 task 5b.

#### [Modules/parser] Parser types, BIO grouping, and worker shell · T35 · Build

- **Done:** 2026-11-21. `types.ts`: `Token`, `Chunk`, `SentenceParse`, `ParseResult`, `Alternative`, `ModelRef` (+ `nestedView`), `ParserBackend` contract, worker protocol, `WorkerStatus`, typed errors with (de)serialization. `parser.ts`: `repairBio`, `groupChunks`, `buildSentenceParse`, `Parser`. `parser.worker.ts`: `createWorkerHandler` (one model at a time, ordered requests, retry, readiness guard). `index.ts`: `createParserWorker` / `createParserClient`. `transformerBackend.ts` is a placeholder until T63; alternatives wait for T60; lemmas for `TODO(lemma)`. Tests: `parser.test.ts`, `parser.worker.test.ts`, `index.test.ts`.

#### [Modules/parser] phraseLabeler.ts · T34 · Build

- **Done:** 2026-11-21. `labelPhrases` (roles from relations on maximal projections, `S` / `VP(Predicate)`, copula Complement, split predicates, coordination, single-word wrappers, `isHead`), matched to treeDecoder's bracketing levels so gated phrases label correctly. Tests: `phraseLabeler.test.ts` (12). Recorded in the `phraseLabeler.ts` header.

#### [Training] Phase 8 calibration · T58 · Build

- **Done:** 2026-11-21. `scripts/calibrate.py` for DeBERTa-v3-xsmall and ModernBERT; ECE reduced for all outputs (test arc ECE 5.19 → 0.41 and 5.33 → 1.67). Margins / attachment margins 0.4 / 0.3 and 0.3 / 0.3 (≤ 0.3 mean alternatives per sentence, owner); bracket thresholds 0.85 and 0.80 with test shown-bracket precision 95.71% for both, coverage 48.6% and 53.7%; nested view met for both. Bracket confidence includes the head's outer dependents (chosen on dev). Values in each checkpoint's `labels.json`; recorded in `training/reports/calibration.md`, `architecture.md` → *Ambiguity handling*, and `plan-training.md` → Phase 8.

#### [Training] Biaffine head and retrain of all four models · T51 · Build

- **Done:** 2026-11-20. `scripts/biaffine.py` (arc scorer, per-sentence masks), `prepare_data.py --encoding arc [--augment]`, `run_phase7.py --stage biaffine` (4.3 h after the resume; no failed runs). Test, dev-selected seed: DeBERTa-v3-xsmall UPOS 97.65, chunk F1 97.01, UAS excl. punct 94.51, multi-word bracket F1 89.75; ModernBERT 97.40 / 96.47 / 94.30 / 89.71 (both offered, nested view pending Phase 8); BERT 97.00 (96.995, not offered) / 96.13 / 93.80 / 87.82; DistilBERT 96.82 / 95.59 / 92.22 / 84.97 (not offered). Augmentation kept for BERT and ModernBERT only. Recorded in `training/reports/training_biaffine.md` and `plan-training.md` → Phase 7.

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

### 2026-11-20T22:07:16Z — Claude Opus 5.5, T51 and T58 done; restaged

- Modified: T51 (biaffine retrain finished) and T58 (Phase 8 calibration) moved to *Done* with outcomes.
- Modified: T61 moved to Stage 0; T59, T60, T63, T64 moved to Stage 1 (their remaining *Needs* are in Stage 0).

### 2026-11-20T22:29:17Z — Claude Opus 5.5, T34, T35, T59 done

- Modified: T34, T35, T59 moved to *Done* with outcomes (T59: owner chose head-word badges and a role gate).

### 2026-11-20T22:42:10Z — Claude Opus 5.5, T61 done; restaged

- Modified: T61 (Phase 9) moved to *Done* with outcome.
- Modified: T63 and T64 moved to Stage 0 (all *Needs* done).

### 2026-11-20T22:51:36Z — Claude Opus 5.5, T63 done

- Modified: T63 moved to *Done* with outcome.

### 2026-11-20T23:00:54Z — Claude Opus 5.5, T11, T12, T13, T21 decided; restaged

- Modified: T11, T12, T13, T21 moved to *Done* with the owner's choices.
- Modified: stages recomputed from *Needs*: T39 1→0, T60 1→0, T50 2→1, T65 4→2, T66 5→4.

### 2026-11-21T04:07:12Z — Claude Opus 5.5, T31, T39, T60, T64 done; T67 added; restaged

- Modified: T31, T39, T60, T64 moved to *Done* with outcomes.
- Added: T67 (Phase 10 on a lower-end device); T65 now also needs T67.
- Modified: stages recomputed from *Needs*: T38 1→0, T50 1→0, T67 None→0.

### 2026-11-21T04:30:46Z — Claude Opus 5.5, T67 done

- Modified: T67 moved to *Done* with the VM results.
- Modified: T36 (pre-flight checks `shader-f16`, storage quota) and T65 (ModernBERT limit is speed, not memory) task notes.

### 2026-11-21T04:48:09Z — Claude Opus 5.5, Stage 0 builds done (T28, T29, T30, T38, T50); restaged

- Modified: T28, T29, T30, T38, T50 moved to *Done* with outcomes.
- Modified: stages recomputed from *Needs*: none.

### 2026-11-21T04:57:32Z — Claude Opus 5.5, Stage 0 decisions T14–T20, T22–T27 done; T68, T69 added; restaged

- Modified: T14, T15, T16, T17, T18, T19, T20, T22, T23, T24, T25, T26, T27 moved to *Done* with the owner's decisions.
- Added: T68 (i18n plumbing and Korean UI text; from T18), T69 (offline / PWA; from T15).
- Modified: stages recomputed from *Needs*: T36 1→0, T37 1→0, T40 1→0, T41 1→0, T42 1→0, T43 1→0, T44 1→0, T46 2→1, T47 2→1, T48 2→1, T49 2→1, T65 2→1, T52 3→2, T53 3→2, T54 4→3, T55 4→3, T56 4→3, T57 4→3, T66 4→3, T62 5→4, T68 None→0, T69 None→0.

### 2026-11-21T05:19:02Z — Claude Opus 5.5, T42 decided; dictionary build tasks added; restaged

- Modified: T42 moved to *Done* (owner: option A for all five parts).
- Added: T71 (wink lemmas), T70 (dictionary build pipeline), T72 (offline dictionary control).
- Modified: T46 narrowed to the dictionary module and service (pipeline moved to T70; needs T70); T53 notes inflected-form lookup.
- Modified: stages recomputed from *Needs*: T46 1→2, T53 2→3, T71 None→0, T70 None→1, T72 None→4.

### 2026-11-21T05:44:11Z — Claude Opus 5.5, Stage 0 builds done (T71, T36, T37, T40, T41, T68, T69); restaged

- Modified: T71, T36, T37, T40, T41, T68, T69 moved to *Done* with outcomes (owner choices: hand-written service worker, header language menu, fake-indexeddb).
- Modified: stages recomputed from *Needs*: T47 1→0, T48 1→0, T49 1→0, T65 1→0, T70 1→0, T46 2→1, T52 2→1, T53 3→2, T54 3→2, T55 3→2, T56 3→2, T57 3→2, T66 3→2, T62 4→3, T72 4→3.

### 2026-11-21T06:00:49Z — Claude Opus 5.5, T47 done; restaged

- Modified: T47 moved to *Done* with the outcome.
- Modified: stages recomputed from *Needs*: T52 1→0, T54 2→1, T55 2→1, T56 2→1, T57 2→1, T66 2→1, T72 3→2.

### 2026-11-21T06:11:22Z — Claude Opus 5.5, T52 done; restaged

- Modified: T52 moved to *Done* with the outcome.
- Modified: stages recomputed from *Needs*: T54 1→0, T55 1→0, T56 1→0, T57 1→0.

### 2026-11-21T06:20:35Z — Claude Opus 5.5, T48 and T49 done

- Modified: T48 and T49 moved to *Done* with outcomes.
- Modified: stages recomputed from *Needs*: no change (T62 still waits on T53).

### 2026-11-21T06:41:53Z — Claude Opus 5.5, T54–T57 done

- Modified: T54, T55, T56, T57 moved to *Done* with outcomes.
- Modified: T66 notes the base-model license for `catalog.json` (About page credits).
- Modified: stages recomputed from *Needs*: no change (T66 waits on T43, T65; T72 on T46; T62 on T53).
