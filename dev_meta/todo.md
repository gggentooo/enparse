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

#### [Project] Plan the beta feedback feature · T44 · Decision

- **Files:** `dev_meta/architecture.md`, `dev_meta/plan-training.md` (Phase 12), `dev_meta/dev_agent_questions.md` (2026-11-18 feedback entry)
- **Task:** Decide whether and when to plan the feedback module, export format, annotation guidelines, and `ingest_feedback.py` described in the Q&A (sections a–d are not in the plan).
- **Needs:** T14

#### [Modules/parser] ONNX Runtime Web files for offline use · T94 · Build

- **Files:** `src/modules/parser/transformerBackend.ts`, `src/modules/modelLibrary/downloads.ts`, `src/pwa/sw.ts`
- **Task:** The worker loads `/models/_ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` (26.9 MB) from the network on every model load; only the browser's HTTP cache (one day) keeps it, so a fully downloaded model may not load offline after that. Check offline loading in Chrome and Safari; if it fails, store both files in Cache Storage with the model download (verified like model files) and make the backend read them from there. Found in T66 (the build no longer ships its own copy: over Pages' 25 MiB limit).
- **Needs:** —

#### [Modules/modelLibrary] Update path when a release changes model files · T95 · Build

- **Files:** `src/modules/modelLibrary/downloads.ts`, `src/modules/preflight/checks.ts`, `src/services/parserService.ts`
- **Task:** A visitor who downloaded model-v1.0.0 keeps its files in Cache Storage after a new release changes them at the same URLs. The library decides "downloaded" from file sizes only. Check what happens (old model keeps loading, integrity failure, or re-download), then make it explicit: compare the cached `labels.json` → `model_version` with the catalog and offer an update on the model card. Until then, `PUBLISHING.md` → *Update* tells colleagues to delete and re-download. Found in T66.
- **Needs:** —

---

## Done

#### [Modules/parser] Safari: "The parser model is not ready" in the production build · T97 · Build

- **Done:** 2026-11-23 (owner report from the deployed site; Safari only). Cause: the production build's Transformers.js chunk imports two shared helpers back from the worker's entry file (`import … from "./parser.worker-<hash>.js"`); Safari evaluates a worker's entry module a second time when it is imported (Chrome reuses the running module), so a second message handler without a model answered every parse with `ParserNotReadyError`, ahead of the real result. The dev server does not bundle, so it never happened locally. Fix: `parser.worker.ts` → `registerWorker` marks the worker scope and registers the handler once. Reproduced and confirmed fixed in Safari 27 on the production build served locally (each parse now gets one answer). Test: `parser.worker.test.ts`. The entry module is still evaluated twice in Safari (harmless; a thin entry file would avoid it). Recorded in `architecture.md` → *Model readiness*.

#### [Modules/preflight] Mobile guard · T96 · Build

- **Done:** 2026-11-23 (owner request: an iPhone 12 mini reloaded the page with "a problem occurred" whenever a downloaded model loaded, which made the site unusable).
  - **Crash guard (any device):** the model id is stored while the worker loads it (`modelLibrary/selection.ts` → `markLoading`, `clearLoading`, `interruptedLoad`). If the mark is still there at the next start, the saved model is not loaded again by itself: status `failed` with the new reason `crashed`, a message that points to a smaller model, and the model drops out of the recommendation. Retry still works.
  - **Phones and tablets:** new probe `mobile` (`core/environment.ts` → `isMobileDevice`: iOS, iPadOS including desktop mode, Android). A mobile device that does not report ≥ 8 GB of memory uses int8 on WASM only; the new fitness check `mobile-memory` blocks a model whose int8 file is over 128 MiB (Large) and warns for smaller ones (Compact). Thresholds in `preflight/requirements.ts` (**proposed**; owner may change them).
  - Checked with an emulated iPhone 12 mini in Chrome (Large "not supported on this device", Compact recommended with the warning). Not yet checked on the real phone: whether Compact int8 fits in its memory is unknown; if it does not, the crash guard stops the reload loop. Tests: `checks.test.ts`, `environment.test.ts`, `parserService.test.ts`. Recorded in `architecture.md` → *Pre-flight checks*, *Model readiness*.

#### [Training] Phase 11 packaging and release · T66 · Build

- **Done:** 2026-11-23. Release **model-v1.0.0** (`training/configs/catalog.yaml` → `release.version`; the owner creates the git tag when committing).
  - **Packaging:** `training/scripts/package_models.py` offers the models that meet `eval.yaml` → `acceptance`. That is Large (ModernBERT) and Compact (DeBERTa-v3-xsmall), in catalog order. DistilBERT (UPOS 96.82) and BERT (96.995) are reported as not offered.
    - Copies the shipped files to `public/models/<id>/` (unchanged files are skipped).
    - Writes `labels.json` with `model_version` 1.0.0 and the files' sizes and SHA-256 (validated, no needed field null).
    - Writes `catalog.json` (schema v1, measured metrics, Phase 10 speed tiers, new optional `base_model_url` and `base_model_license`).
    - Writes the release record `training/reports/release.md` (runs, seeds, config hashes, data version, checksums) and the per-model integration references (`training/data/release/integration/`).
    - `--check` compares `public/models/` with the exports. Tests: `training/tests/test_package_models.py`.
  - **Model card:** `training/MODEL_CARD.md` completed (summary, base models and licenses, metrics, calibration, export and parity, performance, known weaknesses, intended use, reproducibility).
  - **Integration tests:**
    - `src/modules/parser/packagedModels.test.ts`, per packaged model in Node: files vs catalog and `labels.json`; Phase 9 int8 outputs reproduced exactly on 20 test sentences; a `ParseResult` with `model_version`, wink offsets, valid trees, and phrases.
    - `e2e/release.spec.ts` (`npm run test:e2e:release`): the production build behind the real Pages Functions with the release files (`vite.release.ts`). Each model downloads, verifies, loads (WebGPU here), and parses, and switching models replaces the loaded one.
    - All pass.
  - **About page:** model credits come from the catalog (static list until it loads); `TODO(T66)` removed.
  - **Deployment:**
    - `scripts/r2.ts` (`npm run r2 -- list | upload <bucket> | verify <site>`) maps the release files to R2 keys and uploads with Wrangler via npx (not a dependency).
    - `PUBLISHING.md`: step-by-step publishing for the closed preview (R2, Pages Direct Upload, `MODELS` binding, verification, Cloudflare Access with email codes, sharing, updates, costs, Git LFS and tag).
  - **Fixes found on the way:**
    - The build shipped ONNX Runtime's 26.9 MB `.wasm` (over Pages' 25 MiB limit, and precached by the service worker). `skipModelFiles` now drops it, and the build fails on any file over 25 MiB.
    - Model files are downloaded with `cache: "no-store"`.
    - The Function makes `labels.json` revalidate like `catalog.json`.
    - The manifest is fetched with credentials (Access).
    - The Korean description in `catalog.yaml` was invalid YAML; it is now quoted.
  - **Follow-ups:** T94, T95. Recorded in `architecture.md` → *Deployment*, `plan-training.md` → Phase 11.

#### [Project] End-to-end tests and CI · T62 · Build

- **Done:** 2026-11-23 (owner decisions the same day: a fake model in CI plus the real models locally; the system Chrome). `e2e/app.spec.ts` covers the main flow: choose a model (download, integrity and model checks, load) → paste and parse → structure view (subject and predicate) → phrase view (NP / VP chunks) → select a word (part of speech, dictionary summary with 달리다 for "runs" → run) → add it to a new list → the dictionary page ("runs" → base form: run) → the vocabulary page → export JSON (file name and content checked). `npm run test:e2e` starts `vite --mode e2e`: `vite.e2e.ts` resolves the parser worker's `./transformerBackend` to `e2e/fakeBackend.ts` (a deterministic word-list tagger with the `ParserBackend` contract; the decoder, labeler, annotator, services, and UI are the real ones), serves an e2e catalog with one small model (real sizes and SHA-256) and the unit tests' dictionary; never in builds. `npm run test:e2e:models` runs the same test against the real Compact model and the built dictionary (`vite --mode local-models`; local only). `playwright.config.ts`: system Chrome (`channel: "chrome"`), one worker, traces kept on failure. CI (`.github/workflows/ci.yml`) runs `npm run test:e2e` after the build and uploads traces on failure. Both targets pass on this machine (1.9 s fake, 3.9 s real). Recorded in `agents.md` → *Testing guide* and *Tooling and commands*, README, `architecture.md`.

#### [Modules/parser] Shared preposition before a coordination · T93 · Build

- **Done:** 2026-11-23 (owner request; corrects the owner's T92 example). A preposition before a coordination of nouns covers the whole coordination: "Water in these disks could be found as water vapor or ice." → `[Water [in these disks]] [could be found [as [[water vapor] or [ice]]]]` (what water could be found as is "water vapor or ice"); likewise `[lived [in [[the house] and [the garden]]]]`. UD attaches the preposition to the first conjunct, so `treeDecoder.ts` → `buildPhrases` regroups for display: the leading `case` dependents of the coordination's head form the outer bracket with an inner bracket around the conjuncts, when the head and every later conjunct are nouns and no later conjunct has its own preposition (`[put it [[in the box] or [on the shelf]]]` and `[came [[with friends] or [alone]]]` keep the preposition with the first conjunct). Every conjunct stays bracketed (T92). Re-measured on the stored predictions: multi-word bracket F1 89.04 (DeBERTa-v3-xsmall) / 89.14 (ModernBERT), still above the 88 target; Phase 8 refit leaves the thresholds unchanged (brackets 0.85 / 0.80, roles 0.3 / 0.4; test shown precision 95.72% / 95.64%). Catalog fixture metrics updated. Checked in Chrome with both models on the three sentences. Recorded in `plan-training.md` → *Nested phrase structure* and `architecture.md`.

#### [Modules/parser] Bracket every conjunct of a coordination · T92 · Build

- **Done:** 2026-11-23 (owner request). Every conjunct of a coordination is its own bracket, one-word conjuncts included, with conjunctions and commas between the brackets (replaces the T82 rule "one-word conjuncts stay plain words"): `[Water [in these disks]] [could be found [[as water vapor] or [ice]]]`, `[She] [bought [[apples] , [pears] and [oranges]]]`, `[He] [[sings] and [dances]]`. `treeDecoder.ts` → `buildPhrases` wraps a one-word first conjunct (the coordination's head) and every one-word later conjunct in a `conjunct` bracket; `phraseLabeler.ts` gives a later one-word conjunct bracket its attachment and the coordinated mark. Multi-word bracket F1 on the stored test predictions unchanged (DeBERTa 89.16, ModernBERT 89.19; one-word brackets are not scored or gated, so the Phase 8 thresholds stand). Checked in Chrome with both models on the owner's sentence and a three-item list. Recorded in `plan-training.md` → *Coordination* and `architecture.md`.

#### [Training] Model display names and descriptions · T43 · Decision

- **Done:** 2026-11-23 (owner). Names: **Large** (ModernBERT; was "Accurate") and **Compact** (DeBERTa-v3-xsmall), the same in Korean. Large is the default model, chosen by the owner from complex test sentences (e.g. nested parentheticals and subordinate clauses), and Compact is offered as its backup when Large does not run well on the device. Descriptions (English / Korean, in `training/configs/catalog.yaml` → `description`, `description_ko`; catalog.json gains the optional `description_ko`, shown when the interface is Korean): Large — "Larger download. The default model, with high accuracy and speed." / "다운로드 크기가 더 큽니다. 정확도와 속도가 높은 기본 모델입니다."; Compact — "Smaller download. Recommended when Large does not run well on your device (for example, without WebGPU)." / "다운로드 크기가 더 작습니다. 이 기기에서 Large가 잘 동작하지 않을 때(예: WebGPU를 지원하지 않는 경우) 추천합니다." Catalog order is the preference order (Large first). Recommendation (replaces the T22 chunk-F1 rule): the first model in catalog order that is not blocked, has a variant, parses within 5 s on this device, and has not failed to load here (parserService tracks failed loads; network failures do not count). Card badge "Most accurate" replaced by "Default" / "기본 모델" on the catalog's first model (owner: the test scores, shown on the card, rank Compact slightly higher). Built in `modelLibrary` (`selection.ts`, `types.ts`, `catalog.ts`), `parserService.ts`, `ModelCard.tsx`, i18n, the catalog fixture, tests.

#### [Components/Pages] Word panel position toggle and full-width output · T91 · Build

- **Done:** 2026-11-23 (owner request). (1) A single-choice group "단어창 위치" (Word Panel Position): 옆 (Side; default) / 아래 (Bottom). Bottom puts the word panel at the bottom of the screen (fixed, at most 40vh, own scroll; the T90 behaviour) even when it would fit beside the sentences, so the sentences get the whole width. The group is shown only in the desktop layout (hidden by the same container query that forces the bottom panel below 1048px). (2) The output page has no maximum width any more: the sentences, or the sentences and the panel, fill the content area to its right edge. Checked in Chrome at 1600px (side: sentences 1032px + panel; bottom: sentences 1344px) and 1100px (panel forced to the bottom, toggle hidden). Files: `OutputPage.tsx`, `OutputPage.module.css`, i18n, `OutputPage.test.tsx`.

#### [Components/Pages] Output page layout: wider sentence column, bottom word panel, title wrap · T90 · Build

- **Done:** 2026-11-23 (owner request). (1) The sentence column is at least 800px wide (was 648px, the remainder of the 60rem page beside the panel): the output page may grow to 800px + 18rem + gap, and the column is `minmax(800px, 1fr)`. (2) When the page is narrower than 800px beside the panel (container query on the page, 1048px), the layout is one column and the word panel is fixed to the bottom of the viewport whatever the scroll position (beside the sidebar; full width when the sidebar is a top bar), at most 40% of the viewport high with its own vertical scroll; the page keeps 40vh free below the sentences so the panel never hides the last one. (3) The panel title wraps after "Selected word:" (선택한 단어:) when the word is long, the word moves to the next line as a whole, and the Close button (닫기) never breaks. Checked in Chrome at 1500px (800px column, panel beside) and 1100px (panel at the bottom, stays while scrolling). Files: `OutputPage.module.css`, `WordDetails.tsx`, `WordDetails.module.css`.

#### [Components/Pages] Structure view: phrase label position toggle · T89 · Build

- **Done:** 2026-11-23 (owner request). A fourth single-choice group in the structure view, "Phrase Label Position" (구문 라벨 위치): **Top** (위; default) or **Side** (옆; the T88 rendering, a small tag before the phrase's words). Top: each phrase's label sits in a band at its top, one label row (0.95rem) per nesting level, so an outer phrase's label is above its inner phrases' labels; the band is vertical padding of the inline box, so the words of a sentence stay on one straight line (each sentence's height follows its deepest phrase). Works with blocks and brackets, and with labels always shown or on hover. A label wider than its phrase is cut with "…" and shown in full (with its tooltip) while the phrase is hovered or focused, so labels never overlap. Word role tags stay beside their words. Checked in Chrome in all combinations: one baseline per sentence, no clipping, no vertical scrollbar, no overlapping labels. Files: `NestedReading.tsx` (`NestedLook.labelPos`), `NestedReading.module.css`, `OutputPage.tsx`, i18n, `OutputPage.test.tsx`.

#### [Components/Pages] Structure view: blocks on one line, new defaults, two look toggles · T88 · Build

- **Done:** 2026-11-23 (owner request). (1) Blocks look: phrases are inline boxes on one text line, like the brackets look, so every word of a sentence sits on the same baseline whatever its nesting depth (before, each level's padding pushed inner words upwards). A box's vertical padding grows with its nesting height (`--nest`, set by `NestedReading.tsx` → `nestHeight`; 5 px per level), so outer boxes still enclose inner ones; the view reserves room for the deepest box (`--nest-max`). Labels shown in the layout are small raised tags, as in the brackets look. (2) Defaults: the output opens in the structure view (when the model has it), labels on hover, phrases as blocks. (3) The "Look" checkboxes are now two single-choice groups: "Labels: Show labels only on hover (default) / Always show labels" and "Phrases: Draw as blocks (default) / Draw as brackets" (Korean: 라벨: 가리킬 때만 표시 / 항상 표시; 구문: 블록으로 표시 / 괄호로 표시). The English flat-view option is renamed "Phrases (flat)" so it is not confused with the new "Phrases" group. Checked in Chrome: one baseline per sentence, no vertical scrollbar. Files: `NestedReading.tsx`, `NestedReading.module.css`, `OutputPage.tsx`, i18n, `OutputPage.test.tsx`.

#### [Modules/output, Modules/dictionary, Components/Pages] Phrasal verbs in the word panel · T87 · Build

- **Done:** 2026-11-23 (owner request; closes the gap noted in T53). (1) Marked by the parse: the annotator gives both words of a phrasal verb (relation `compound:prt`, e.g. "looked … up", "gave it up") `token.phrasal` (verb, particle, "look up", "looked up"); the word panel looks the phrasal verb up with "looked up" / "look up", and "More in the dictionary" opens it. (2) Not marked (UD analyses "ran out of milk" as a verb plus a preposition): a verb directly followed by a particle, or a particle right after a verb, is tried first as a phrasal verb (`DictionaryQuery.phrase`, match `phrase`; particles = the build's list, `PHRASAL_PARTICLES`); it is used only if it is a headword, and the panel then shows it together with the word's own entry. The parse is not changed. Checked in Chrome with both models: looked/up → look up, gave → give up, ran/out → run out (+ run / out), "looked at" → at. Files: `output/types.ts`, `output/annotator.ts`, `dictionary/dictionary.ts`, `dictionary/types.ts`, `WordDetails.tsx`, `OutputPage.tsx`, tests.

#### [Components/Pages] Offline dictionary control · T72 · Build

- **Done:** 2026-11-23. `DictionaryOffline.tsx` on the Models page under the model cards: what is stored (not stored / partly / all, with sizes), "Make dictionary available offline (size)", byte progress with cancel, delete with confirmation, errors by reason. Pre-flight storage check (T24): `dictionaryService` compares the rest of the download with `navigator.storage.estimate()` (`core/environment.ts` → `estimateStorage`): the button is disabled with "not enough storage" when it cannot fit, and a warning is shown with less than `STORAGE_MARGIN_BYTES` (256 MiB) left. `useDictionaryOffline` hook. Checked in Chrome (partly stored 1.2 of 11 MB after lookups → complete → deleted).

#### [Components/Pages] DictionaryPage and useDictionary · T53 · Build

- **Done:** 2026-11-23. `DictionaryPage` (#/dictionary): search form; the query lives in the URL (`?q=…&lemma=…&upos=…`); entries via `DictionaryEntry.tsx`: headword, "ran → base form: run" for inflected forms, every headword of an ambiguous form (saw → saw, see), per part of speech (the queried one first) the Korean words under Wiktionary's sense labels and the definitions with examples (five, then "show all"), Tatoeba examples linked to their sentences (attribution); word parts (useSubword); "Add to list" (useVocab, with English and Korean definitions); loading, not-found, and error states with a link to the offline option. Lookup trigger per T25: the word panel on the output page (`WordDetails`) shows a compact summary (Korean words and two definitions of the parse's part of speech, using its lemma first) with "More in the dictionary" opening the page. `useDictionary` hook (stale responses ignored). `uposKey` moved to `Shared/upos.ts`. Checked in Chrome with the built data. Not yet: a clicked verb of a phrasal verb ("looked" in "looked up") opens the verb, not the phrasal verb (the word panel has no head or relation of the token).

#### [Modules/dictionary] Dictionary module and service · T46 · Build

- **Done:** 2026-11-23. `src/modules/dictionary/` (`types.ts`, `staticDb.ts`, `dictionary.ts`, `index.ts`) and `src/services/dictionaryService.ts`. Data from `/dict/v1/` (T70): the manifest is fetched on first use and a copy kept for offline use; `index.json` and shards come from the versioned cache `enparse-dict-v1` or are downloaded into it with size and SHA-256 checks (one retry after an integrity failure); 16 shards kept in memory; other versions' caches are deleted. Lookup: the parse's lemma first, then the word as a headword, then the inflection index (all headwords of an ambiguous form); senses of the queried part of speech first. `DictionaryLoadError` (network, integrity, storage, format, cancelled). Offline option: `downloadAll(onProgress, signal)`, `deleteAll()`, `offlineState()`; the service exposes lookups, offline state, download progress, and errors via `subscribe()` / `getSnapshot()`. `core/environment.ts` cache functions take a cache name (`readCached`, `putCached`, `cacheNames`, `deleteCache` added). Tests: fake server and cache, plus the built v1 data; checked in Chrome (first lookup 29 ms with download and checks, then 3 ms; offline download 129 files / 11 MB). Recorded in `architecture.md` → *Logic modules* and *Services*.

#### [Modules/preflight] Thresholds and multi-threaded WASM · T65 · Decision

- **Done:** 2026-11-23 (owner chose 1C, 2A, 3A, 4A, 5A). (1) No per-model memory requirement: the `model-memory` check and `catalog.json` → `requirements.min_device_memory_gb` are dropped; only the device-wide memory hint (4 GB, warn) remains (both models ran in the 4 GB, 2-core VM). (2) Expected parse time per WASM speed tier: `catalog.json` → `performance.parse_5000_chars_s` gains `wasm_2core` and `wasm_1thread`; pre-flight picks one thread without cross-origin isolation, two cores when `hardwareConcurrency` ≤ 2, else many threads (`checks.ts` → `wasmTier`), so the recommendation and the "fastest here" badge prefer Compact on slow devices (ModernBERT int8: 1.48 / 5.17 / 4.91 s). (3) Single-threaded WASM stays a warning. (4) Storage margin stays 256 MiB. (5) The WebGPU check uses `maxStorageBufferBindingSize` ≥ 128 MiB (`MIN_WEBGPU_STORAGE_BINDING_BYTES`) instead of `maxBufferSize`. Built in `src/modules/preflight/` (`requirements.ts`, `checks.ts`, `types.ts`), `modelLibrary` (catalog types, `requirementsOf`, recommendation), the catalog fixture, `training/js/bench_report.mjs` (`data/bench/catalog_performance.json` for T66). Recorded in `architecture.md` → *Pre-flight checks* and *Model library*, `plan-training.md` → Phase 10.

#### [Training] Dictionary build pipeline · T70 · Build

- **Done:** 2026-11-23 (owner decisions the same day: keep a pinned Wiktionary subset; fill headwords with Korean-translated WordNet words; Korean translations per part of speech, not matched to WordNet senses; data CC BY-SA 4.0 at `/dict/v1/`). Sources pinned with SHA-256 in `training/configs/dictionary.yaml`: Open English WordNet 2025, the kaikki.org English Wiktionary extract (downloaded 2026-11-23; a reproducible 7.7 MB subset is kept), Tatoeba Korean–English (11,585 pairs), NGSL 1.2. Pipeline `training/dictionary/` (`fetch.py`, `extract.py`, `build.py`) with `training/js/dict_lemmas.mjs` (the app's `lookupKey` and wink `lemmaOf`). v1: 16,659 headwords (15,000 single words: NGSL ∪ EWT lemmas, then the most widely translated WordNet words with Korean; 1,659 phrasal verbs), 65.8% with Korean translations, 21.2% with Tatoeba examples, 30,457 inflected forms (Wiktionary, WordNet, NGSL form lists, wink), 10.9 MB JSON in 128 shards + 0.82 MB index + manifest; 99.1% of UD EWT test words resolve. Served by `functions/dict/[[path]].ts` (R2 bucket `MODELS`, key prefix `dict/`) and locally by `npm run dev:models`. Credits on the About page. Recorded in `training/dictionary/DATA_CARD.md`, `training/reports/dictionary.md`, `plan-training.md` → *Dictionary pipeline*, and `architecture.md` → *Module decisions* and *Deployment*. Upload to R2 is left to the owner (with T66).

#### [Components/Pages] Structure view: labels back inside, arrows under the sentence, thin scrollbar · T86 · Build

- **Done:** 2026-11-23 (owner request; partly reverts T85). (1) Phrase labels and word role tags are back inside the brackets and boxes as before T85 (the packed label rows under the sentence are removed); labels shown on hover now float **above** the phrase or word. (2) Arrows are drawn **under** the sentence: straight down from the modifier, across, and up into the target, with rounded corners, and the arrow's label under the line, so arrows and labels no longer meet. (3) The horizontal scrollbar is thin (`scrollbar-width: thin`; 6 px in Safari) and sits below the reserved arrow room (bottom padding 2.5rem), so it no longer covers the bottom-most words or arrows. The T85 fix for vertical scrollbars stays (`overflow-y: hidden` with room reserved above for hover labels and below for arrows). Checked in Chrome in both looks: no vertical scrollbar, nothing outside the view, arrow labels inside the view.

#### [Components/Pages] Structure view: labels under the sentence; no vertical scrollbar · T85 · Build

- **Done:** 2026-11-23 (owner request). (1) Phrase labels and word role tags no longer sit on or inside the brackets and boxes: they are in rows under the sentence, each starting under its phrase's first word with a short rule in the phrase's color and text in that color (tinted 30% towards the text color so small text stays readable). `NestedReading.tsx` packs the always-shown labels (Subject and Predicate; all labels in the "always" look) left to right into the first row where they do not overlap, and gives hover-only labels the row under them; the view reserves exactly those rows (`--label-rows`). Deep nesting no longer adds a label row per level inside the boxes, and the arrows (above the words) can no longer cover a label. (2) Vertical scrollbar cause: the view scrolls sideways (`overflow-x: auto`), which makes it scroll vertically too on any overflow; in the hover look each word's hidden role tag (opacity 0, but still laid out) hung 0.6 px below the view, so every sentence with a word role showed a vertical scrollbar (5 of 6 sentences in the check). Fix: `overflow-y: hidden`, and the label rows and arrow room are reserved as padding so nothing is clipped. Checked in Chrome on six sentences in both looks: no vertical overflow, no element outside the view. Recorded in `architecture.md` → component hierarchy.

#### [Components/Pages] Structure view: sentence headers, centered brackets, rounded arrows · T84 · Build

- **Done:** 2026-11-23 (owner request). (1) In the structure view each sentence starts with a "Sentence N" header (`output.sentence`; hidden from screen readers because the article already carries the name) and a 2 px rule below it. The phrase view is unchanged. (2) In the bracket look, the raised labels no longer use `vertical-align: super`, which made each line box taller above the words and skewed the sentence upwards; they are raised by `position: relative` with zero line height, so the words sit centered in their brackets. (3) Modifier arrows are drawn as the top of a rounded rectangle: straight up from the modifier, straight across, straight down onto the target, with rounded corners (radius 8 px, rise 18 px; `NestedReading.tsx`); fork arrows (T83) use the same shape and the label sits above the line. Checked in Chrome. Recorded in `architecture.md` → component hierarchy.

#### [Modules/parser, Modules/output, Components/Pages] Near-tie display and projective decoding · T83 · Build

- **Done:** 2026-11-23 (owner decisions the same day). (1) **Near-tie display:** a sentence whose top reading has a share below 60% (`NEAR_TIE_SHARE`) shows a note that the readings are about equally likely, opens the readings list from the start, and names the readings A, B, … instead of "most likely". In the nested view the disputed phrase is marked, and pointing at it draws a dashed arrow to each candidate word with its share. Every reading (near-tie or not) lists what it says in plain words from fixed templates written in Korean and English: which word a phrase goes with (noun, verb, adjective, other) or which part of speech a word is. Built in `ambiguity.ts` (`Alternative.attachment`), `output/types.ts` and `annotator.ts` (`nearTie`, `notes`, `forks`), `SentenceView`, `NestedReading`, i18n. (2) **Projective decoding** turned on for both models "for now" (owner; T82 measured it: dev UAS −0.04 DeBERTa-v3-xsmall, +0.06 ModernBERT). Re-measured with it: test UAS excl. punctuation 94.54 / 94.38, bracket F1 89.16 / 89.19; bracket thresholds 0.85 / 0.80, test shown precision 95.78% / 95.65%, 66.7% / 68.1% shown as certain; role thresholds 0.3 / 0.4, role precision 95.73% / 95.87%. Written to the checkpoints' and exports' `labels.json`, the reports, the catalog fixture, `plan-training.md`, and `architecture.md`.

#### [Modules/parser, Training, Components/Pages] Main-clause and coordination brackets; projective decoding check · T82 · Build

- **Done:** 2026-11-23 (owner decisions the same day). (1) The main clause, and clauses coordinated with it, have no bracket of their own: the subject bracket and the predicate bracket are the outermost brackets, always shown (also for one word) and drawn dashed when their span confidence is below the bracket threshold. Embedded clauses keep their bracket. (2) Coordination is shown side by side, `[[A] and [B]]`, with the conjunction between the brackets and the shared role on the outer bracket; one-word conjuncts stay plain. (3) Multi-word modifiers keep their own bracket (`[[deeply forked] tails]`; owner). (4) Projective decoding (no crossing attachments) was measured and **not adopted** under the owner's rule "only if accuracy does not drop": dev UAS 94.25 → 94.21 for DeBERTa-v3-xsmall (test 94.35 → 94.38) and 94.10 → 94.16 for ModernBERT (test 94.21 → 94.29); `projectiveTree` and `js/projective_eval.mjs` are kept for a later decision (e.g. per model). Refit from the stored predictions: test bracket F1 89.13 / 89.03; bracket thresholds 0.85 / 0.80, test precision of brackets shown as certain 95.83% / 95.64%, 66.7% / 68.2% of brackets shown as certain plus 4% dashed (86% / 85% of those correct); role thresholds 0.3 / 0.3, role precision 95.80% / 95.62%. Both models keep the nested view. Built in `treeDecoder.ts` (`headLayouts`, `buildPhrases`, `projectiveTree`), `phraseLabeler.ts` (`pinned`, `unsure`, level `conjunct`), `output/`, `NestedReading`, `training/js` (`lib/gating.mjs`, `projective_eval.mjs`); written to the checkpoints' and exports' `labels.json`, `reports/calibration.md`, `reports/training_biaffine.md`, the catalog fixture, `plan-training.md`, and `architecture.md`. Owner's example (*Mackerel typically have vertical stripes on their backs and deeply forked tails*): both models are unsure where *on their backs* and *tails* attach (0.42–0.64), so the primary view leaves that part flat and "Other readings" offers `[[vertical stripes on their backs] and [[deeply forked] tails]]`.

#### [Modules/parser, Components/Pages] Modifier arrows target a span · T81 · Build

- **Done:** 2026-11-23 (owner decisions the same day). A modifier before its head (`det`, `amod`, `nummod`, `compound`, `nmod`, `advmod`, quantifier) in the same bracket modifies everything from just after itself through the head word, in noun and verb phrases: *the big red dog* → the → *big red dog*, big → *red dog*, red → *dog*; *has often quietly slept* → often → *quietly slept*. The span stops at the head word (owner); other dependents keep a one-word target. Brackets, thresholds, and models are unchanged. Built in `phraseLabeler.ts` (`attachFrom`), `parser/types.ts`, `output/types.ts`, `output/annotator.ts`, `NestedReading.tsx` (span highlight, arrow to the span's middle, accessible name). Owner also decided to leave the rare model error of an adjective attached to a following adjective (Accurate: *big → red*, confidence 0.48; 2–4 wrong cases in about 1,200 test adjectives) without a correction rule. Recorded in `plan-training.md` → *Nested phrase structure* → *Attachments* and `architecture.md` → *Role labeling*.

#### [Components/Pages] Nested view: new brackets, arrows on hover, clause labels · T80 · Build

- **Done:** 2026-11-23. `NestedReading`: one bracket or box per phrase; in the bracket look phrases are inline and wrap like text; arrow with the role to the attached word on hover or focus (dashed when uncertain), also in the accessible names; Subject and Predicate labels always shown. Checked in Chrome with both models on the owner's *Mackerel* text (`npm run dev:models`).

#### [Modules/output] Annotation model: phrases with attachments · T79 · Build

- **Done:** 2026-11-23. `AnnotatedNode` carries `attachTo` (token index) and `uncertain`; wrapper collapsing removed.

#### [Training] Per-attachment gating and Phase 8 recalibration · T78 · Build

- **Done:** 2026-11-23. `spanConfidence` (per word, the probability that its head stays on its side of the bracket; `DecodedTree.headDist`) replaces the whole-bracket product; gating runs after labeling (`gateLabeled`, badges carry role and attachment). Refitted from the stored predictions: bracket thresholds 0.80 / 0.75, test shown precision 95.61% / 95.66%, 76.1% / 75.6% of brackets shown (was 48.6% / 53.7%); role thresholds 0.2 / 0.3, test role precision 95.51% / 95.71%. Both models keep the nested view. Written to the checkpoints' and exports' `labels.json`, `reports/calibration.md`, the catalog fixture, and `plan-training.md` → Phase 8.

#### [Modules/parser] Quantifier expressions ("a number of") · T77 · Build

- **Done:** 2026-11-23. `parser/quantifiers.ts` (`displayTree`; words: number, lot, lots, couple, plenty, deal (great/good), bit, amount, some); applied to predicted and gold trees in `training/js` (`lib/nested.mjs` → `phrasesOf`).

#### [Modules/parser] phraseLabeler.ts and ambiguity.ts on the new brackets · T76 · Build

- **Done:** 2026-11-23. `labelPhrases` rewritten on the levels (roles, one-word predicate / complement roles on the word, split predicate, coordination) and records `attachTo` / `uncertain` per dependent; `labeledView` takes the word texts; alternatives use it unchanged. `LabeledPhrase.wrapper` removed.

#### [Modules/parser] treeDecoder.ts phrase-per-head bracketing · T75 · Build

- **Done:** 2026-11-23. `buildPhrases` builds one bracket per phrase with levels (`phrase`, `complement`, `predicate`, `clause`; `headLayouts` shared with the labeler); punctuation in the innermost surrounding bracket. Test multi-word bracket F1 on the new brackets: DeBERTa-v3-xsmall 89.85, ModernBERT 89.98 (target ≥ 88; `reports/training_biaffine.md` re-rendered from the stored predictions).

#### [Modules/parser] Specify phrase-per-head bracketing, attachment gating, and arrows · T74 · Build

- **Done:** 2026-11-23. Rules written into `plan-training.md` (*Key design decisions* → quantifier exception; *Nested phrase structure* → *Decoding* 3–5, *Quantity expressions*, *Attachments*; Phase 8 task 5) and `architecture.md` (*Parsing engine*). Quantifier list confirmed by the owner with *some of* and *amount of* added.

#### [Modules/parser] Nested view: phrase-per-head brackets and attachment arrows · T73 · Decision

- **Done:** 2026-11-23 (owner). Replaces the 2026-11-18 bracketing order. (1) One bracket per phrase instead of one level per dependent; one-word modifiers stay flat inside their phrase; the clause splits into subject and predicate, a copular predicate is `[is [complement]]`: `[Mackerel] [is [a common name [given [to …]]]]`. (2) Prepositions bracket with their noun phrase and attach as a unit (`[given [to …]]`). (3) Quantity expressions such as *a number of* are shown as a quantifier of the following noun, by a closed-list display rule (an approved exception to *No rule-based nesting*; the models keep the UD analysis). (4) On hover, an arrow shows what each phrase attaches to, with the relation (modifies, complement, …). (5) Confidence is gated per attachment, not per whole bracket. (6) Subject and Predicate are always labeled. Both offered models already produce the needed trees (checked on the owner's *Mackerel* example); no retraining. To be recorded in `plan-training.md` → *Nested phrase structure* and `architecture.md` → *Parsing engine* by T74.

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

### 2026-11-22T23:45:24Z — Claude Fable 5.2, Nested-view rework tasks added (T73–T80)

- Added: T73 (owner decision, Done): phrase-per-head brackets, quantifier exception, `[given [to …]]`, attachment arrows, per-attachment gating.
- Added: T74 (spec in documents), T75 (treeDecoder bracketing), T76 (phraseLabeler and alternatives), T77 (quantifier rule), T78 (gating and recalibration), T79 (annotation model), T80 (nested view UI).
- Modified: T66 needs T78 (recalibrated `nested.*` thresholds are packaged); stages recomputed: T74 0, T75 1, T76 2, T77 3, T78 and T79 4, T80 5, T66 1→5.

### 2026-11-23T00:50:00Z — Claude Fable 5.2, T74–T80 done; restaged

- Modified: T74 lists the owner-confirmed quantifier list (*some of*, *amount of* added).
- Modified: T74–T80 moved to *Done* with outcomes (bracket F1 89.85 / 89.98; 76% of brackets shown at ≥ 95% precision).
- Modified: stages recomputed from *Needs*: T66 5→1 (waits on T43, T65); stages 4 and 5 removed.

### 2026-11-23T01:30:00Z — Claude Fable 5.2, T81 added and done

- Added: T81 (Done): modifier arrows target the span up to the head word; no correction rule for adjective-on-adjective model errors (owner).

### 2026-11-23T02:30:00Z — Claude Fable 5.2, T82 added and done

- Added: T82 (Done): main clause without an outer bracket, side-by-side coordination, refitted thresholds; projective decoding measured and not adopted (owner rule).

### 2026-11-23T03:30:00Z — Claude Fable 5.2, T83 added and done

- Added: T83 (Done): near-tie display (below 60%) with template explanations and fork arrows; projective decoding on for both models (owner).

### 2026-11-23T04:00:00Z — Claude Sonnet 5.5, T84 added and done

- Added: T84 (Done): sentence headers with a bottom rule, centered bracket lines, rounded-rectangle arrows in the structure view.

### 2026-11-23T04:30:00Z — Claude Opus 5.5, T85 added and done

- Added: T85 (Done): labels in packed rows under the sentence in the phrase's color; vertical scrollbar cause and fix.

### 2026-11-23T05:00:00Z — Claude Opus 5.5, T86 added and done

- Added: T86 (Done): labels back inside the phrases (reverts the T85 label rows), arrows under the sentence, thin scrollbar.

### 2026-11-23T06:30:00Z — Claude Opus 5.5, T70 done; restaged

- Modified: T70 moved to *Done* with outcomes (owner decisions: Wiktionary subset, headword fill, Korean per part of speech, CC BY-SA 4.0 at `/dict/v1/`).
- Modified: stages recomputed from *Needs*: T46 1→0, T53 2→1, T72 2→1, T62 3→2; empty stages removed.

### 2026-11-23T07:00:00Z — Claude Opus 5.5, T65 decided and built

- Modified: T65 moved to *Done* (owner: 1C, 2A, 3A, 4A, 5A).
- Modified: stages: T66 stays in Stage 1 (still waits on T43).

### 2026-11-23T08:00:00Z — Claude Opus 5.5, T46 done; restaged

- Modified: T46 moved to *Done*.
- Modified: stages recomputed from *Needs*: T53 1→0, T72 1→0, T62 2→1; empty stages removed.

### 2026-11-23T09:00:00Z — Claude Opus 5.5, T53 and T72 done; restaged

- Modified: T53 and T72 moved to *Done*.
- Modified: stages recomputed from *Needs*: T62 1→0.

### 2026-11-23T09:30:00Z — Claude Opus 5.5, T87 added and done

- Added: T87 (Done): phrasal verbs in the word panel (parse-marked `compound:prt`, and a verb + particle fallback when it is a dictionary headword).

### 2026-11-23T10:00:00Z — Claude Opus 5.5, T88 added and done

- Added: T88 (Done): blocks on one text line, structure view / hover labels / blocks by default, two single-choice look toggles.

### 2026-11-23T10:30:00Z — Claude Opus 5.5, T89 added and done

- Added: T89 (Done): phrase label position toggle (Top by default, Side), words still on one line.

### 2026-11-23T11:00:00Z — Claude Opus 5.5, T90 added and done

- Added: T90 (Done): 800px minimum sentence column, word panel fixed to the bottom of the viewport when it does not fit beside it (max 40vh, own scroll), selected-word title wraps after the colon.

### 2026-11-23T11:30:00Z — Claude Opus 5.5, T91 added and done

- Added: T91 (Done): word panel position toggle (side / bottom, desktop only); the output page fills the content width.

### 2026-11-23T12:00:00Z — Claude Opus 5.5, T43 decided and built

- Modified: T43 moved to *Done* (owner): Large (default) and Compact (backup), Korean and English descriptions, default-first recommendation, "Default" badge instead of "Most accurate".
- Modified: stages: T66 waits only on done tasks and moves to Stage 0.

### 2026-11-23T12:30:00Z — Claude Opus 5.5, T92 added

- Added: T92 (Stage 0): bracket every conjunct of a coordination, including one-word conjuncts (owner request; replaces the T82 one-word rule).

### 2026-11-23T13:00:00Z — Claude Opus 5.5, T92 done

- Modified: T92 moved to *Done*.

### 2026-11-23T13:30:00Z — Claude Opus 5.5, T93 added and done

- Added: T93 (Done): a shared preposition covers the coordination it precedes.

### 2026-11-23T14:00:00Z — Claude Opus 5.5, T62 done

- Modified: T62 moved to *Done* (end-to-end tests with a fake model backend in CI and the real models locally).

### 2026-11-23T14:30:00Z — Claude Opus 5.5, T66 done; T94, T95 added

- Modified: T66 moved to *Done* (release model-v1.0.0 packaged, integration tests, deployment tooling, `PUBLISHING.md`).
- Added: T94 (ONNX Runtime Web files for offline use), T95 (update path when a release changes model files), both Stage 0.

### 2026-11-23T16:30:00Z — Claude Fable 5.2, T96 and T97 added and done

- Added: T96 (Done): mobile guard (crash guard and phone/tablet rule). T97 (Done): Safari's duplicate worker handler in the production build.
