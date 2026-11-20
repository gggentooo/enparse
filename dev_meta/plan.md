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

## Open items and tasks

Open decisions and tasks are tracked in [todo.md](todo.md), ordered by dependency. (This section replaced the former *Undecided* list on 2026-11-19.)

---

## Project overview

- **Goal:** Build a browser-based English grammar and vocabulary study tool for Korean speakers.
- **Purpose:** Parse English text and produce annotated output to support grammar and vocabulary learning.
- **Userbase:** Korean native speakers at beginner-to-intermediate English proficiency.
- **Architecture:** Fully client-side (static web app, no server-side computation).

### Core features

- **Model choice:** a model library offers up to four parser models (different size, speed, and accuracy); the user chooses and downloads one before parsing, and can switch or delete models later.
- **Sentence structure breakdown:** Syntactic parsing that splits complex sentences into noun phrases (NPs) and verb phrases (VPs). Two views: flat phrases and nested phrases grouped by level (e.g., `[[The [red [dog]]] [rarely [[barks] loudly]]]`). **(proposed)** Nested phrases also carry grammatical roles and head-of-parent markers (e.g., `[The red dog]` as `NP(Subject)`, `[rarely barks loudly]` as `VP(Predicate)`, and `[red dog]` as `NP` head of `[The red dog]`). Ambiguous sentences display multiple valid parses.
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

### 2026-11-18T22:18:20Z — Claude Opus 5.5, Acceptance thresholds decided

- Removed: 'Undecided' → 'Parser' → *Acceptance thresholds*. Decision (owner): a model is offered if test UPOS ≥ 97% and chunk F1 ≥ 94% (and it beats the Phase 5 baselines). Nested-view thresholds are under review (`plan-training.md` → Phase 7).

### 2026-11-19T04:47:11Z — Antigravity, Added phraseLabeler submodule and nested-labeling caveats

- Added: 'Undecided' → 'Parser' → *Nested phrase labeling (`parser/phraseLabeler.ts`)* with open decisions and caveats (role inventory, single-word head wrappers, discontinuous predicates, copula/coordination rules, stripped UD subtypes vs. biaffine relation classifier, UAS/LAS accuracy ceiling and confidence gating).
- Modified: *Core features* → *Sentence structure breakdown* notes nested phrase grammatical roles and head-of-parent marking.

### 2026-11-19T05:09:52Z — Claude Opus 5.5, Undecided moved to todo.md

- Removed: *Undecided* section. Every open item is now a task in `todo.md` (owner decision). Decided notes it held are already recorded elsewhere: parser engine and no fallback (`architecture.md` → *Parsing engine*), accuracy before speed (`plan-training.md` → *Overview*), model library decisions (`architecture.md` → *Model library*), subword method (`architecture.md` → *Subword segmentation*).
- Added: *Open items and tasks* pointer to `todo.md`.
- Modified: *Core features* → *Sentence structure breakdown*: restored the confirmed nested example; grammatical roles and head-of-parent markers (added 2026-11-19 by Antigravity) marked **(proposed)**.
