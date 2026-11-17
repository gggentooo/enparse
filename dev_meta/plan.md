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

## Undecided

Open details and decisions required before development can proceed. Remove items as they are resolved and record the decision in the relevant section.

### Architecture

- **Module interfaces:** data types for parse results, dictionary entries, subword segments, and vocab items are undefined.

### Parser

- **Parsing engine:** no backend chosen (rule-based chunker, JS NLP library, or WASM/ONNX model). Determines accuracy, bundle size, and ambiguity support.
- **Output granularity:** NP/VP chunks only, or full constituency tree (PP, ADJP, clauses)? Plan says chunks; annotator mentions parse-tree visualization.
- **Ambiguity handling:** how ambiguous parses are detected, ranked, and how many are shown.
- **Input limits:** max text length, sentence segmentation, handling of non-English or mixed Korean input.
- **Performance budget:** acceptable parse latency and model size; whether parsing runs in a Web Worker.

### Dictionary

- **Data sources and licensing:** sources for English definitions, Korean translations, and example sentences; redistribution license compatibility.
- **Coverage:** target headword count (e.g., top N frequency words).
- **Storage format:** JSON vs SQLite-WASM (both listed).
- **Hosting:** which raw content URL host (e.g., GitHub raw, CDN); sharding and lazy-loading strategy; offline caching.
- **Build pipeline:** scripts/location for compiling source data into the static DB (not in skeleton).
- **Lemmatization:** mapping inflected forms to headwords (e.g., *ran* → *run*).
- **Multiword expressions:** whether phrasal verbs and idioms are supported.
- **Sense selection:** show all senses, or pick by context/POS.
- **Lookup trigger:** text selection, hover, click, or tap; popup tooltip vs separate `DictionaryPage`.

### Subword parsing

- **Affix inventory:** source and size of prefix/root/suffix list; definition of "frequently occurring".
- **Segmentation method:** rule-based list matching vs algorithmic; handling of false positives (e.g., *under* ≠ *un-* + *der*).
- **Scope:** derivational affixes only, or inflections too.
- **Affix content:** whether affixes have Korean glosses and examples, and their data source.

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
- **Accessibility:** required standard (e.g., WCAG 2.1 AA).

### Project and process

- **MVP scope:** which features ship first and milestone order.
- **Deployment target:** static host (e.g., GitHub Pages, Netlify, Cloudflare Pages).
- **Offline/PWA:** whether the app should work offline.
- **Tooling:** package manager, Node version, linting/formatting, test framework, CI.
- **Project license.**
- **Analytics/privacy:** whether any usage tracking is collected.

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

## Architecture

See [architecture.md](architecture.md) for the technology stack, layers, module definitions, and project skeleton. That document is the single source of truth for architecture.

---

## Changelog

## 2026-11-17T00:32:01Z — Switched to direct-edit model with Changelog

- Modified: Document Maintaining Guide — replaced append-only rule with direct-edit rule; added requirement for a Changelog section at the bottom.
- Modified: Changelog format — entries now record added/modified/removed items with timestamp.
- Removed: All timestamped section headers from existing content (consolidated into single document body).
- Removed: Duplicate entries (frontend proposal was appended twice; consolidated into one).

## 2026-11-17T00:43:18Z — Claude Opus 5.5, Added Undecided section

- Added: 'Undecided' section above 'Project overview', listing open decisions across architecture, parser, dictionary, subword parsing, vocabulary lists, UI/UX, and project process.

## 2026-11-17T00:54:54Z — Claude Opus 5.5, Removed duplicate architecture; React final

- Added: 'Architecture' section pointing to `architecture.md` as the single source of truth.
- Modified: Format template now includes the [Author] field required by rule 2 (matches `architecture.md`).
- Modified: 'Undecided' → 'Architecture' reduced to module interfaces; other items resolved in `architecture.md` (React final, React Router, service subscriptions instead of event bus, `main.tsx` entry, logic-only modules).
- Removed: 'Enparse architectural proposal' and 'Frontend architecture proposal' sections (duplicated and conflicted with `architecture.md`).
