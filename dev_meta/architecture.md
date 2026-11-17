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

### Project overview

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

### Technology stack

| Technology   | Role                                           |
|--------------|-------------------------------------------------|
| React 18+    | UI library with hooks and functional components  |
| React Router | Hash-based routing (`createHashRouter`); no server dependency |
| TypeScript   | Type safety across all layers                    |
| Vite         | Build tool (static server, bundler)              |
| CSS Modules  | Scoped, maintainable styling per component       |
| Transformers.js | Runs the in-house ONNX tagger in the browser (WebGPU/WASM) (Apache 2.0) |
| wink-nlp + wink-eng-lite-web-model | Sentence split, lemmas, and fallback POS tagging/chunking (MIT) |
| jszip        | Archive export format (optional)                 |
| csv-stringify + csv-parse | CSV import/export (optional)        |

**Development only (not shipped):** Python, Hugging Face Transformers, and Optimum for model training and ONNX export (see *Parsing engine*). Supporting tools:

| Tool | Role |
|------|------|
| tsx | Runs the app's TypeScript (e.g., `chunkPatterns.ts`) from Node scripts in `training/js/` (MIT) |
| js-yaml | Reads `training/configs/*.yaml` from Node scripts (MIT) |
| pyyaml | Reads `training/configs/*.yaml` from Python scripts (MIT) |
| ruff | Python format and lint for `training/` (MIT) |
| Git LFS | Stores shipped model files in `public/models/` (see *Model training* → *Artifacts*) |

No separate state-management library. Shared state lives in services and is exposed through hooks (see *Layer communication*).

---

### Layers

The app has four layers. Each layer may only depend on the layer(s) below it.

| Layer          | Responsibility                                                                    | May depend on              |
|----------------|-----------------------------------------------------------------------------------|----------------------------|
| `components/`  | React UI only: rendering, user events, layout. No business logic.                 | `hooks/`, other components |
| `hooks/`       | Bridge services to React; manage component-level state and subscriptions.         | `services/`                |
| `services/`    | Async APIs for the UI. Compose logic modules into workflows; hold shared app state. | `modules/`, `core/`        |
| `modules/`     | Pure TypeScript logic. No React, no DOM, no rendering.                            | `core/`, `utils/`          |
| `core/`, `utils/` | Infrastructure shared by all modules.                                          | Nothing internal           |

- **Modules never import other modules.** Any combination of modules (e.g., normalize input → parse → build annotations) happens in a service.
- **Services never import other services.** When a feature needs several services, a hook or component combines them.

---

### Logic modules

| Module                       | Description                                                                                       |
|------------------------------|---------------------------------------------------------------------------------------------------|
| `core/storage.ts`            | Persistent state wrapper (LocalStorage for small data, IndexedDB for larger datasets).             |
| `utils/helpers.ts`           | Shared utilities: string normalization, date formatting, debounce/throttle helpers.                |
| `input/textInput.ts`         | Preprocessor: cleanup, normalization, length limits (see *Parsing engine*). UI is in `InputPage`. |
| `parser/parser.ts`           | Parser adapter interface (`ParserBackend`). Accepts clean text, returns sentences, tokens, and chunk parses. Pluggable backend. |
| `parser/transformerBackend.ts` | Primary `ParserBackend`: runs the ONNX tagger via Transformers.js; decodes UPOS and chunk labels with probabilities. |
| `parser/winkBackend.ts`      | Sentence split and lemmas; fallback `ParserBackend` (POS tags + `chunkPatterns`).                  |
| `parser/chunkPatterns.ts`    | Fallback POS patterns defining NP, VP, PP, and ADJP chunks.                                       |
| `parser/ambiguity.ts`        | Builds alternative parses from low-margin label probabilities and attachment patterns.            |
| `parser/parser.worker.ts`    | Web Worker entry: loads backends once, switches to fallback mode if needed, parses off the main thread. |
| `output/annotator.ts`        | Converts parse results into an annotation model (chunks, tokens, highlights, alternatives). Rendering is in `OutputPage`. |
| `dictionary/dictionary.ts`   | Lookup interface: resolves a word to definitions and example usages. Display is in components.    |
| `dictionary/staticDb.ts`     | Local static dictionary database adapter. No live API calls.                                       |
| `subword/subwordParser.ts`   | Rule-based segmenter: splits a word (plus its lemma) into prefixes, base, suffixes, and inflection (e.g., *un-* + *happy* + *-ness*). |
| `subword/affixes.ts`         | Affix inventory data used by `subwordParser`.                                                      |
| `vocab/vocabManager.ts`      | CRUD for custom vocabulary lists. Export/import as JSON or CSV. Persists via `core/storage`.       |

---

### Parsing engine

**Priority:** accuracy before speed. Up to ~5 s per 5,000 characters on a typical laptop is acceptable.

**Primary engine:** an in-house transformer tagger, run in the browser with [Transformers.js](https://github.com/huggingface/transformers.js) (Apache 2.0).
**Support / fallback:** [wink-nlp](https://github.com/winkjs/wink-nlp) + [wink-eng-lite-web-model](https://github.com/winkjs/wink-eng-lite-web-model) (MIT).

| Criterion        | How it is met                                                                 |
|------------------|-------------------------------------------------------------------------------|
| License          | Runtime libraries are Apache 2.0 / MIT. The model is trained in-house on openly licensed data (see *Model training*). |
| Accuracy         | Neural taggers reach ~97–98% POS accuracy and mid-90s chunk F1 on standard benchmarks, vs ~95% POS for wink-nlp. Actual figures come from `training/scripts/evaluate.py`. |
| Speed / size     | Quantized model ~65–80 MB (proposed cap 80 MB), downloaded once and cached. Inference in a Web Worker via WebGPU, falling back to WASM. Expected to fit the 5 s budget; to be confirmed by benchmark. |
| Client-side only | Model runs in the browser. Training is a one-time offline development step; no server is used at runtime. |
| NP/VP chunks     | Model predicts chunk labels (BIO tags for NP, VP, PP, ADJP, ADVP) for each word. |
| Words / subwords | Words with POS from the model and lemma from wink-nlp; derivational affixes from `subword/subwordParser.ts`. |
| Ambiguity        | Context-selected primary parse plus probability-ranked alternatives (see *Ambiguity handling*). |

#### Model

- **Architecture:** standard token classifier with one combined label per word, `UPOS|CHUNK` (e.g., `NOUN|B-NP`). UPOS and chunk probabilities are recovered by summing combined-label probabilities. A two-head variant is an optional training experiment.
- **Base model candidates:** `distilbert-base-cased` (Apache 2.0), `deberta-v3-xsmall` (MIT); `bert-base-cased` and `ModernBERT-base` (Apache 2.0) as accuracy references. Cased models only. The final pick is decided by benchmark.
- **Runtime:** Transformers.js tokenizer plus token-classification model for raw logits. `parser/transformerBackend.ts` applies the calibration temperature and decodes logits into labels and probabilities.
- **Quantization:** int8 by default; fp16 on WebGPU if int8 loses measurable accuracy.
- **Context window:** text is processed in overlapping windows of up to 256 subword tokens (same size as training windows; see `plan-training.md` Phase 4), so context extends beyond the current sentence.

#### Model training (offline, `training/`)

Full plan: [plan-training.md](plan-training.md).

- **Data:** Universal Dependencies English EWT (CC BY-SA 4.0), web text. Chunks are derived from its dependency trees. GUM is optional extra data.
- **Framework:** Unsloth on Apple Silicon (MPS), with Hugging Face `Trainer` as fallback; Optimum for ONNX export and quantization.
- **Evaluation:** UPOS accuracy, chunk F1, calibration, and speed on the EWT test split, compared with the wink-nlp fallback and compromise.
- **Artifacts:** ONNX model (int8 for WASM, fp16 for WebGPU), tokenizer, and `labels.json` (label map, temperature, ambiguity margin, versions) published as static files in `public/models/`, tracked with Git LFS (`.gitattributes`). `training/` is not shipped with the app.

#### Pipeline

```
raw text
  └─► input/textInput.ts (preprocessor)
        └─► parser.worker.ts
              ├─► winkBackend: sentence split, lemmas
              ├─► transformerBackend: windows → UPOS + chunk labels with probabilities
              └─► ambiguity.ts: alternative parses
        └─► output/annotator.ts → annotation model → OutputPage
```

- `parserService` runs this chain.
- Subword segmentation runs on demand: `subwordService` receives a word and its lemma from the parse result.

#### Fallback mode

- Used while the model downloads, if model loading fails, or on devices without enough memory.
- `winkBackend` provides POS tags, and `chunkPatterns.ts` builds chunks from them. Ambiguity uses rule-based patterns only.
- The UI shows that results come from basic mode and offers re-parsing once the model is ready.

#### Preprocessor (`input/textInput.ts`)

- Unicode NFKC normalization; curly quotes and dashes converted to ASCII equivalents.
- Strips control characters, zero-width characters, and emoji.
- Hangul/CJK and other non-Latin text are removed; the UI shows a notice listing what was removed.
- Collapses repeated whitespace; keeps paragraph breaks.
- **Max length:** 5,000 characters (configurable). Longer input is rejected with a character count; it is not silently truncated.

#### Ambiguity handling

1. **Primary parse (context-selected):** the highest-probability label for each word, chosen by the model using surrounding context. Marked "most likely".
2. **Probability-based alternatives:** words whose top two labels are close (margin below a threshold, e.g. 0.2) are treated as ambiguous. `ambiguity.ts` builds alternative label sequences from them, keeps only valid ones (consistent BIO chunks), and ranks them by joint probability.
3. **Attachment alternatives (rule-based):** flat chunks do not encode where a prepositional phrase attaches. `ambiguity.ts` flags `VP NP PP` sequences and offers both readings (PP modifies the verb or the noun).
4. **Cap:** at most 5 alternatives per sentence (configurable).

#### Subword segmentation

- wink provides the inflectional split via lemma (*running* → *run* + *-ing*).
- `subwordParser.ts` strips derivational affixes from `affixes.ts`, longest match first.
- A split is accepted only if the remaining base is a known word or lemma, preventing false splits (*under* ≠ *un-* + *der*).

#### Alternatives considered

| Option                         | Status                                                                                  |
|--------------------------------|-----------------------------------------------------------------------------------------|
| wink-nlp + `chunkPatterns.ts`  | Kept as fallback. Fast and tiny, but lower tagging accuracy and hand-written chunk rules. |
| compromise (MIT, ~250 KB)      | Not used. No published tagging accuracy, and a second tagger can disagree with the primary one. Included in evaluation for comparison only. |
| Off-the-shelf chunking models  | Not used. Licenses are non-commercial (QCRI) or unstated (vblagoje, AdapterHub); CoNLL-2000 data has no clear license. |
| spaCy / Stanza via Pyodide     | Not used. spaCy in the browser is experimental only; Stanza needs PyTorch, which does not run in the browser. |
| Earley parser (e.g., nearley) + hand-written grammar | Not used. A broad English grammar is large to write, and parse counts can explode. |

---

### Dependency graph

```
components/  ──►  hooks/  ──►  services/  ──►  modules/  ──►  core/storage.ts
                                                         └──►  utils/helpers.ts

parserService      ──► input/textInput ─► parser/parser.worker ─► output/annotator   (called in sequence by the service)
                                           └─► parser/transformerBackend, winkBackend, chunkPatterns, ambiguity
dictionaryService  ──► dictionary/dictionary ──► dictionary/staticDb
subwordService     ──► subword/subwordParser
vocabService       ──► vocab/vocabManager ──► core/storage
```

- Arrows point from dependent to dependency.
- Files inside the same module may import each other (e.g., `dictionary.ts` → `staticDb.ts`, `parser.worker.ts` → `transformerBackend.ts`). Imports across modules are not allowed.
- Modules may import external libraries listed in *Technology stack* (e.g., `parser/` uses Transformers.js and wink-nlp).

---

### Layer communication

```
Component ─► Hook ─► Service ─► Module(s)
    ▲                   │
    └──── subscribe ◄───┘   (service-held state changes)
```

- **Request/response:** components call hooks; hooks call async service methods (e.g., `parseText()`, `lookupWord()`, `getVocabList()`).
- **Shared state:** services that hold state (e.g., `vocabService` lists) expose `subscribe()` / `getSnapshot()`. Hooks read them with `useSyncExternalStore`, so every component using `useVocab` updates when a list changes.
- **No event bus.** Cross-component updates go through service subscriptions; parent/child data goes through props.

---

### Frontend structure

#### Routing

- Routes are defined in `src/routes.tsx` with React Router's `createHashRouter` (`#/input`, `#/output`, `#/vocab`, `#/dictionary`).
- `ContentArea` renders the active route via `<Outlet />`.

#### Component hierarchy

```
main.tsx (entry: mounts <RouterProvider> into index.html)
  └── App.tsx (root)
      ├── Layout.tsx
      │   ├── Header.tsx (branding, global actions)
      │   ├── Sidebar.tsx (page navigation)
      │   └── ContentArea.tsx (route outlet)
      │       ├── InputPage.tsx (raw text input: textarea, paste, drag-drop)
      │       ├── OutputPage.tsx (annotated results, word selection, inline lookup)
      │       ├── VocabPage.tsx (custom vocab lists)
      │       └── DictionaryPage.tsx (lookup results)
      └── Shared/
          ├── Button.tsx
          ├── Modal.tsx
          ├── Tooltip.tsx
          └── LoadingSpinner.tsx
```

#### Services and hooks

| Service                | Wraps                                              | Hook            |
|------------------------|----------------------------------------------------|-----------------|
| `parserService.ts`     | `textInput`, `parser`, `annotator`                 | `useParser`     |
| `dictionaryService.ts` | `dictionary`, `staticDb`                           | `useDictionary` |
| `subwordService.ts`    | `subwordParser`                                    | `useSubword`    |
| `vocabService.ts`      | `vocabManager`                                     | `useVocab`      |

---

### Styling strategy

- **CSS Modules** — Each component has a corresponding `.module.css` file next to it.
- Styles are scoped to the component; no global leakage.
- Global styles (reset, typography) live in `css/global.css`.
- Design tokens (colors, spacing, fonts) defined in `css/tokens.css`.
- Responsive breakpoints handled via CSS media queries.

---

### Complete project skeleton

```
enparse/
├── dev_meta/
│   ├── plan.md
│   ├── architecture.md
│   ├── plan-training.md
│   └── agents.md
├── src/
│   ├── index.html
│   ├── main.tsx (entry point)
│   ├── routes.tsx (route definitions)
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
│   │   │   ├── VocabPage.tsx + VocabPage.module.css
│   │   │   └── DictionaryPage.tsx + DictionaryPage.module.css
│   │   └── Shared/
│   │       ├── Button.tsx + Button.module.css
│   │       ├── Modal.tsx + Modal.module.css
│   │       ├── Tooltip.tsx + Tooltip.module.css
│   │       └── LoadingSpinner.tsx + LoadingSpinner.module.css
│   ├── hooks/
│   │   ├── useParser.ts
│   │   ├── useDictionary.ts
│   │   ├── useSubword.ts
│   │   └── useVocab.ts
│   ├── services/
│   │   ├── parserService.ts
│   │   ├── dictionaryService.ts
│   │   ├── subwordService.ts
│   │   └── vocabService.ts
│   ├── core/
│   │   └── storage.ts
│   ├── modules/ (each module also has index.ts (public API) and types.ts (proposed))
│   │   ├── input/
│   │   │   └── textInput.ts
│   │   ├── parser/
│   │   │   ├── parser.ts
│   │   │   ├── transformerBackend.ts
│   │   │   ├── winkBackend.ts
│   │   │   ├── chunkPatterns.ts
│   │   │   ├── ambiguity.ts
│   │   │   └── parser.worker.ts
│   │   ├── output/
│   │   │   └── annotator.ts
│   │   ├── dictionary/
│   │   │   ├── dictionary.ts
│   │   │   └── staticDb.ts
│   │   ├── subword/
│   │   │   ├── subwordParser.ts
│   │   │   └── affixes.ts
│   │   └── vocab/
│   │       └── vocabManager.ts
│   └── utils/
│       └── helpers.ts
├── public/
│   └── models/
│       └── enparse-tagger/ (ONNX model, tokenizer, label config; built by training/; README.md placeholder)
├── training/ (offline only; not shipped; layout in plan-training.md)
│   ├── configs/
│   ├── scripts/ (env check, fetch, derive chunks, prepare, train, calibrate, export, evaluate)
│   ├── js/ (tokenization alignment, JS baselines, Transformers.js benchmark, bench-page/ browser benchmark)
│   ├── tests/
│   ├── reports/
│   └── MODEL_CARD.md
├── package.json
├── tsconfig.json (strict mode)
├── vite.config.ts (root: 'src'; publicDir: '../public')
└── README.md
```

- `src/` contains all app source files. `dist/` is generated by Vite and is git-ignored.
- `training/` holds the offline model pipeline. Its output in `public/models/` is served as static files.
- Each logic module is a self-contained directory under `modules/`. Coding conventions and the step-by-step module guide are in `agents.md`.

#### Adding a new feature

1. Logic module in `modules/<feature>/` (if new logic is needed).
2. Service in `services/` wrapping that module.
3. Hook in `hooks/` exposing the service.
4. Component(s) in `components/`, each with a `.module.css` file.
5. Route in `routes.tsx` and a link in `Sidebar.tsx` (if it is a new page).

---

## Changelog

## 2026-11-17T00:32:01Z — Switched to direct-edit model with Changelog

- Modified: Document Maintaining Guide — replaced append-only rule with direct-edit rule; added requirement for a Changelog section at the bottom.
- Modified: Changelog format — entries now record added/modified/removed items with timestamp.
- Removed: Timestamped section header from existing content (consolidated into single document body).

## 2026-11-17T00:54:54Z — Claude Opus 5.5, Resolved architectural conflicts (React final)

- Added: React Router (`createHashRouter`) to stack; `routes.tsx` and `main.tsx` entry point.
- Added: *Layers* section with explicit dependency rules; *Layer communication* section (service subscriptions via `useSyncExternalStore`).
- Added: `useSubword` hook; services/hooks mapping table; `.module.css` files in skeleton; *Adding a new feature* steps.
- Modified: `input/textInput.ts`, `output/annotator.ts`, `dictionary/dictionary.ts` redefined as logic-only; UI moved to `InputPage`, `OutputPage`, and components.
- Modified: Dependency graph redrawn to match layer rules; module chaining now done in `parserService`.
- Modified: "Backend modules" renamed "Logic modules" (app is fully client-side). Header/Sidebar roles split (branding vs navigation).
- Removed: `app.ts` (replaced by `main.tsx`), `core/router.ts` (replaced by React Router), `core/eventBus.ts` (replaced by service subscriptions), `useStorage` hook (no matching service).

## 2026-11-17T01:41:17Z — Claude Opus 5.5, Selected parsing engine

- Added: wink-nlp + wink-eng-lite-web-model to *Technology stack*.
- Added: *Parsing engine* section (criteria, pipeline, preprocessor rules, ambiguity handling, subword segmentation, alternatives considered).
- Added: `parser/winkBackend.ts`, `parser/chunkPatterns.ts`, `parser/ambiguity.ts`, `parser/parser.worker.ts`, `subword/affixes.ts` to modules table and skeleton.
- Modified: `input/textInput.ts` defined as the preprocessor; `parser/parser.ts` and `output/annotator.ts` outputs updated (tokens and alternatives; no parse-tree data).
- Modified: Dependency rules allow imports within a module and of listed external libraries.

## 2026-11-17T01:56:15Z — Claude Opus 5.5, Switched primary parser to in-house transformer

- Added: Transformers.js to *Technology stack*; development-only training stack note.
- Added: *Model*, *Model training*, and *Fallback mode* subsections; `parser/transformerBackend.ts`; `public/models/` and `training/` to skeleton.
- Modified: *Parsing engine* — accuracy before speed (~5 s per 5,000 characters acceptable); in-house transformer tagger is primary; wink-nlp handles sentence split, lemmas, and fallback.
- Modified: *Ambiguity handling* — alternatives now ranked by model probabilities; PP attachment kept as a rule.
- Modified: *Alternatives considered* — updated statuses; added off-the-shelf chunking models (license issues).
- Removed: 60-token max sentence length (overlapping context windows replace it).

## 2026-11-17T02:03:03Z — Claude Opus 5.5, Aligned with training plan

- Added: link to `plan-training.md` in *Model training*; `plan-training.md` to skeleton.
- Modified: *Model* — single combined `UPOS|CHUNK` label head replaces two heads; cased base-model candidates updated; calibration temperature applied at runtime.
- Modified: model size estimate to ~65–80 MB (proposed 80 MB cap); training framework (Unsloth on MPS, `Trainer` fallback); `training/` skeleton matches the training plan.

## 2026-11-17T02:24:51Z — Claude Opus 5.5, Linked agent guide

- Added: `agents.md` to skeleton; pointer to `agents.md` for coding conventions and module guide.

## 2026-11-17T02:57:39Z — Claude Opus 5.5, Training scaffold

- Modified: `training/scripts/` skeleton note includes the proposed environment check (`check_env.py`).

## 2026-11-17T03:31:22Z — Claude Opus 5.5, Unified window size

- Modified: *Model* → *Context window* reduced from 512 to 256 subword tokens to match training.

## 2026-11-17T03:36:56Z — Claude Opus 5.5, App scaffold and dev tools

- Added: *Technology stack* → development-only tools table (tsx; proposed js-yaml, pyyaml, ruff).
- Added: skeleton entries for `tsconfig.json`, per-module `index.ts` and `types.ts` (proposed), and a `README.md` placeholder in `public/models/enparse-tagger/`.
- Added: header-only files for the full skeleton (`src/`, root config, `public/`). No code yet.

## 2026-11-17T04:00:45Z — Claude Opus 5.5, Approved dev tools; Git LFS for models

- Modified: js-yaml, pyyaml, and ruff approved by owner; proposed marks removed.
- Added: Git LFS to development tools; *Artifacts* notes that `public/models/` files are tracked with Git LFS.
- Modified: *Parsing engine* → accuracy source path corrected to `training/scripts/evaluate.py`.

## 2026-11-17T04:21:52Z — Claude Opus 5.5, Bench page in skeleton

- Modified: `training/js/` skeleton note includes `bench-page/` (Phase 10 browser benchmark).
