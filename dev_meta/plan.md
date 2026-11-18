# Enparse Project Plan

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

## Undecided

Open details and decisions required before development can proceed. Remove items as they are resolved and record the decision in the relevant section.

### Architecture

- **Module interfaces:** data types for parse results, dictionary entries, subword segments, and vocab items are undefined.

### Parser

Engine selected: in-house transformer tagger via Transformers.js, with wink-nlp for sentence split, words, and lemmas; no rule-based fallback, so the app parses only once the model is loaded (see *Parsing engine* → *Model readiness* in `architecture.md`). Accuracy before speed; up to ~5 s per 5,000 characters is acceptable. Remaining:

- **Acceptance thresholds:** minimum UPOS accuracy and chunk F1 a model needs to be offered in the model library (e.g., ≥ 97% / ≥ 94%), applied per model.
- **Ambiguity threshold:** probability margin for flagging alternatives (proposed 0.2); how alternatives are displayed.
- **Limit defaults:** confirm proposed defaults (5,000 characters, 5 alternatives per sentence).


### Model library

Decided (owner, 2026-11-18): every base model is trained; models that meet the acceptance thresholds are offered and the user chooses; nothing is downloaded before a choice; any number of models may stay cached (user deletes). Design: `architecture.md` → *Model library*. Open:

- **Hosting and storage limits:** all four models are ~0.4 GB at int8 plus ~0.8 GB at fp16. Check the static host's per-file and total-size limits and the Git LFS storage and bandwidth quota (e.g., GitHub's free LFS quota is small). Options: ship fp16 only for some models, split large ONNX files (external data), or host model files elsewhere on the same origin. Tied to *Deployment target*; needed before `plan-training.md` Phase 11.
- **Recommendation rule:** proposed: among models not blocked on this device and without memory warnings, the highest chunk F1 whose measured parse time meets the 5 s budget; ties → smaller download.
- **Presentation:** which facts each model card shows (proposed: description, download size, UPOS / chunk F1, nested view yes/no, expected speed on this device, size on disk) and how accuracy is phrased for learners (numbers vs. labels like "most accurate").
- **Descriptions:** display names and texts in `training/configs/catalog.yaml` (proposed English drafts); language follows *Interface language*.

### Pre-flight checks

Client-side checks before and after the model loads (`architecture.md` → *Model readiness* → *Pre-flight checks*; source headers in `src/modules/preflight/`, `src/core/environment.ts`). Open:

- **Scope:** confirm the proposed checks (workers, WebAssembly SIMD/threads, WebGPU, Cache Storage, memory hint, `labels.json` schema, wink versions, storage quota, cached-file integrity).
- **Memory policy:** low device memory warns (proposed) or blocks. Browsers expose memory only roughly (Chromium) or not at all (Safari, Firefox), so blocking would turn some capable devices away.
- **Thresholds:** minimum device memory hint, free-storage margin, minimum WebGPU buffer size. Placeholders until `plan-training.md` Phase 10 measures peak memory and load times.
- **Storage policy:** warn (proposed) or block when free quota is below the model size; whether to request persistent storage (`navigator.storage.persist()`; Firefox asks the user).
- **Integrity failures:** delete bad cached files and re-download once (proposed), then fail.
- **Multi-threaded WASM:** needs COOP/COEP headers from the static host (depends on *Deployment target*); whether single-threaded WASM (warning only) is acceptable for the 5 s budget.
- **Diagnostics display:** how much detail `DiagnosticsPanel` shows, and whether it is reachable when nothing failed (proposed: from the Header status badge).

### Dictionary

- **Data sources and licensing:** sources for English definitions, Korean translations, and example sentences; redistribution license compatibility.
- **Coverage:** target headword count (e.g., top N frequency words).
- **Storage format:** JSON vs SQLite-WASM (both listed).
- **Hosting:** which raw content URL host (e.g., GitHub raw, CDN); sharding and lazy-loading strategy; offline caching.
- **Build pipeline:** scripts/location for compiling source data into the static DB (not in skeleton).
- **Lemmatization:** wink-nlp provides lemmas (*ran* → *run*); confirm dictionary headwords match wink's lemma forms.
- **Multiword expressions:** whether phrasal verbs and idioms are supported.
- **Sense selection:** show all senses, or pick by context/POS.
- **Lookup trigger:** text selection, hover, click, or tap; popup tooltip vs separate `DictionaryPage`.

### Subword parsing

Method selected: rule-based affix stripping with base validation; inflections via wink lemmas (see `architecture.md`). Remaining:

- **Affix inventory:** source and size of prefix/root/suffix list; definition of "frequently occurring".
- **Affix content:** whether affixes have Korean glosses and examples, and their data source.
- **Base validation word list:** `subwordParser` accepts a split only if the base is a known word, but modules cannot import `dictionary/`. Source of the known-word list (dictionary headwords via `subwordService`, or a bundled list in `subword/`) is open.

### Vocabulary lists

- **Entry schema:** fields per item (word, definitions, Korean, example, source sentence, notes, tags, date added).
- **Export format:** canonical format among JSON, CSV, and zip; schema versioning.
- **Third-party compatibility:** whether export should target Anki or similar tools.
- **Import conflicts:** merge, overwrite, or duplicate behavior.
- **Storage limits:** LocalStorage vs IndexedDB threshold; backup or data-loss warnings.

### UI/UX

- **Interface language:** Korean, English, or bilingual (i18n needed?).
- **Grammar labels:** whether chunk/phrase labels and explanations are shown in Korean (e.g., 명사구).
- **Target devices and browsers:** desktop only or mobile/responsive; minimum browser versions.
- **Visual design:** branding, color palette, and parse-display style (tree, brackets, color-coded chunks).
- **Attribution display:** where the app shows required data and model attribution (e.g., UD EWT, CC BY-SA 4.0); no page for it exists in the skeleton. Needed before model release (`plan-training.md` Phase 11).
- **Accessibility:** required standard (e.g., WCAG 2.1 AA).

### Project and process

- **MVP scope:** which features ship first and milestone order.
- **Deployment target:** static host (e.g., GitHub Pages, Netlify, Cloudflare Pages).
- **Offline/PWA:** whether the app should work offline.
- **Tooling:** confirm remaining proposals in `agents.md` → *Tooling and commands* (ESLint + Prettier, React Testing Library, Playwright); choose CI. (npm, Node 20+, TypeScript, Vite, Vitest approved.)
- **Project license.**
- **Analytics/privacy:** whether any usage tracking is collected.

---

## Project overview

- **Goal:** Build a browser-based English grammar and vocabulary study tool for Korean speakers.
- **Purpose:** Parse English text and produce annotated output to support grammar and vocabulary learning.
- **Userbase:** Korean native speakers at beginner-to-intermediate English proficiency.
- **Architecture:** Fully client-side (static web app, no server-side computation).

### Core features

- **Model choice:** a model library offers up to four parser models (different size, speed, and accuracy); the user chooses and downloads one before parsing, and can switch or delete models later.
- **Sentence structure breakdown:** Syntactic parsing that splits complex sentences into noun phrases (NPs) and verb phrases (VPs). Two views: flat phrases and nested phrases grouped by level (e.g., `[[The [red [dog]]] [rarely [[barks] loudly]]]`). Ambiguous sentences display multiple valid parses.
- **Automatic dictionary lookup:** Highlighting a word shows its English and Korean definitions and example usages. Dictionary data is compiled into a static local database (hosted via raw content URLs), avoiding live API calls.
- **Subword parsing:** Frequently occurring prefixes, bases, and suffixes (e.g., *un-*, *-ism*) are parsed and treated as vocabulary items.
- **Vocabulary list export:** Users create custom vocab lists within the app and can export/import them in a portable file format.

### Design principles

- **Modularity:** Every submodule must be independent. New features must be addable without impacting existing modules.
- **Extensibility:** Architecture must support future feature additions with minimal refactoring.

---

## Architecture

See [architecture.md](architecture.md) for the technology stack, layers, module definitions, and project skeleton. That document is the single source of truth for architecture.

---

## Changelog

### 2026-11-17T00:32:01Z — Switched to direct-edit model with Changelog

- Modified: Document Maintaining Guide — replaced append-only rule with direct-edit rule; added requirement for a Changelog section at the bottom.
- Modified: Changelog format — entries now record added/modified/removed items with timestamp.
- Removed: All timestamped section headers from existing content (consolidated into single document body).
- Removed: Duplicate entries (frontend proposal was appended twice; consolidated into one).

### 2026-11-17T00:43:18Z — Claude Opus 5.5, Added Undecided section

- Added: 'Undecided' section above 'Project overview', listing open decisions across architecture, parser, dictionary, subword parsing, vocabulary lists, UI/UX, and project process.

### 2026-11-17T00:54:54Z — Claude Opus 5.5, Removed duplicate architecture; React final

- Added: 'Architecture' section pointing to `architecture.md` as the single source of truth.
- Modified: Format template now includes the [Author] field required by rule 2 (matches `architecture.md`).
- Modified: 'Undecided' → 'Architecture' reduced to module interfaces; other items resolved in `architecture.md` (React final, React Router, service subscriptions instead of event bus, `main.tsx` entry, logic-only modules).
- Removed: 'Enparse architectural proposal' and 'Frontend architecture proposal' sections (duplicated and conflicted with `architecture.md`).

### 2026-11-17T01:41:17Z — Claude Opus 5.5, Parsing engine selected

- Modified: 'Undecided' → 'Parser' — engine, granularity, ambiguity approach, input limits, and Web Worker resolved in `architecture.md`; remaining items are chunk patterns, ambiguity patterns, limit defaults, and latency target.
- Modified: 'Undecided' → 'Subword parsing' — segmentation method and scope resolved.
- Modified: 'Undecided' → 'Dictionary' — lemmatization item narrowed to matching wink lemma forms.

### 2026-11-17T01:56:15Z — Claude Opus 5.5, Primary parser switched to in-house transformer

- Added: 'Undecided' → 'Parser' items for base model, acceptance thresholds, training data licensing, chunk derivation, model hosting, training environment, and ambiguity threshold.
- Modified: 'Undecided' → 'Parser' — records accuracy-before-speed decision (~5 s per 5,000 characters acceptable) and new engine choice.
- Removed: 'Performance target' item (decided); 60-token sentence limit from limit defaults.

### 2026-11-17T02:03:03Z — Claude Opus 5.5, Linked training plan

- Modified: 'Undecided' → 'Parser' — base-model candidates updated (cased models) with link to `plan-training.md`; size cap item now proposes 80 MB.
- Removed: 'Training environment' item (decided: Unsloth on the owner's MacBook Pro M5 Pro; see `plan-training.md`).

### 2026-11-17T02:24:51Z — Claude Opus 5.5, Linked agent guide

- Modified: 'Undecided' → 'Tooling' now points to proposals in `agents.md`.
- Added: 'Undecided' → 'Module public API' item (proposed `index.ts` per module).

### 2026-11-17T02:57:39Z — Claude Opus 5.5, Training scaffold open questions

- Added: 'Undecided' → 'Parser' items for the baseline harness and training vs runtime window size.

### 2026-11-17T03:31:22Z — Claude Opus 5.5, Resolved window size and baseline harness

- Removed: 'Undecided' → 'Parser' items *Baseline harness* (deferred until `src/` exists; `tsx` chosen to run TypeScript in Node) and *Training vs runtime window* (decided: 256 tokens for both).

### 2026-11-17T03:36:56Z — Claude Opus 5.5, App scaffold open question

- Added: 'Undecided' → 'Subword parsing' → *Base validation word list*.

### 2026-11-17T04:00:45Z — Claude Opus 5.5, Model hosting decided; attribution item

- Modified: 'Undecided' → 'Parser' → *Model hosting and size cap* renamed *Model size cap*; hosting decided (`public/models/` with Git LFS).
- Added: 'Undecided' → 'UI/UX' → *Attribution display*.

### 2026-11-17T04:21:52Z — Claude Opus 5.5, Deferred hosting limits

- Removed: hosting per-file limit check from *Model size cap* (deferred by owner).

### 2026-11-17T22:14:22Z — Claude Opus 5.5, Dev-only dependency licenses

- Added: 'Undecided' → 'Project and process' item on weak-copyleft (LGPL/MPL) dev-only transitive dependencies found in Phase 0.

### 2026-11-17T22:20:06Z — Claude Opus 5.5, Heading hierarchy

- Added: H1 document title "Enparse Project Plan".
- Modified: *Document Maintaining Guide* is now an H2 section (*Rules*, *Format template* are H3); changelog entries are H3 under *Changelog*, and the format template matches.

### 2026-11-17T23:16:13Z — Claude Opus 5.5, Phase 1 licensing proposal

- Modified: 'Undecided' → 'Parser' → *Training data licensing* now points to the proposed position and GUM exclusion in `plan-training.md`.

### 2026-11-17T23:17:31Z — Claude Opus 5.5, Training data licensing decided

- Removed: 'Undecided' → 'Parser' → *Training data licensing*. Decision (owner): UD EWT only; weights shipped under CC BY-SA 4.0 with attribution, legal advice before commercial release; GUM excluded. Recorded in `plan-training.md` → Phase 1 *Outcome* and `training/MODEL_CARD.md`.

### 2026-11-17T23:31:07Z — Claude Opus 5.5, Chunk derivation implemented

- Modified: 'Undecided' → 'Parser' → *Chunk derivation rules* now asks the owner to confirm the proposed rule details and the agent-run review.

### 2026-11-17T23:33:33Z — Claude Opus 5.5, Chunk derivation rules decided

- Removed: 'Undecided' → 'Parser' → *Chunk derivation rules*. Decision (owner): rules and *Rule details* in `plan-training.md` → Phase 2 accepted, with the agent-run review.

### 2026-11-18T04:09:46Z — Claude Opus 5.5, Nested phrase view

- Modified: *Core features* → *Sentence structure breakdown* lists flat and nested views.
- Added: 'Undecided' → 'Parser' → *Nested phrase view* (design confirmation, UAS/LAS thresholds, convention).

### 2026-11-18T05:29:52Z — Claude Opus 5.5, Nested view, module API, and tooling decided

- Removed: 'Undecided' → *Nested phrase view* (owner: two-view design confirmed; ships only with UAS ≥ 97% and LAS ≥ 94%, otherwise the app ships without it; bracketing and labels as in `plan-training.md` → *Nested phrase structure*).
- Removed: 'Undecided' → *Module public API* (owner approved `index.ts` per module).
- Modified: 'Undecided' → *Tooling* — npm, Node 20+, TypeScript, Vite, Vitest approved; ESLint/Prettier, RTL, Playwright, CI remain.

### 2026-11-18T05:38:31Z — Claude Opus 5.5, Unshipped dependency licenses decided

- Removed: 'Undecided' → *Dev-only dependency licenses*. Decision (owner): weak-copyleft transitive dependencies that are never shipped in the app bundle are allowed — `sharp-libvips` (LGPL-3.0, Node-only part of Transformers.js) and `lightningcss` (MPL-2.0, Vite). Recorded in `agents.md` → *Dependency policy*.

### 2026-11-18T06:56:29Z — Claude Opus 5.5, No fallback mode

- Removed: 'Undecided' → 'Parser' → *Fallback chunk patterns*. Decision (owner): no rule-based fallback; the app refuses to parse until the model is fully loaded (`architecture.md` → *Model readiness*).

### 2026-11-18T07:06:28Z — Claude Opus 5.5, Pre-flight checks

- Added: 'Undecided' → *Pre-flight checks* (scope, memory and storage policies, thresholds, integrity failures, multi-threaded WASM, diagnostics display).

### 2026-11-18T07:51:11Z — Claude Opus 5.5, Model library

- Added: *Core features* → *Model choice*; 'Undecided' → *Model library* (hosting and storage limits, recommendation rule, presentation, descriptions), with the owner's decisions recorded.
- Removed: 'Undecided' → 'Parser' → *Base model* and *Model size cap* (decided: every model that meets the thresholds is offered; size is shown to the user instead of capped).
- Modified: *Acceptance thresholds* apply per model and decide which models are offered.
