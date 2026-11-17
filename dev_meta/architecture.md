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
| jszip        | Archive export format (optional)                 |
| csv-stringify + csv-parse | CSV import/export (optional)        |

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
| `input/textInput.ts`         | Prepares raw text for parsing: cleanup, normalization, sentence segmentation. UI is in `InputPage`. |
| `parser/parser.ts`           | Parser adapter interface. Accepts sentences, returns NP/VP chunks and ambiguity list. Pluggable backend. |
| `output/annotator.ts`        | Converts parse results into an annotation model (chunks, highlights, tree data). Rendering is in `OutputPage`. |
| `dictionary/dictionary.ts`   | Lookup interface: resolves a word to definitions and example usages. Display is in components.    |
| `dictionary/staticDb.ts`     | Local static dictionary database adapter. No live API calls.                                       |
| `subword/subwordParser.ts`   | Splits words into prefixes, roots, suffixes, and inflections (e.g., *un-* + *happy* + *-ness*).    |
| `vocab/vocabManager.ts`      | CRUD for custom vocabulary lists. Export/import as JSON or CSV. Persists via `core/storage`.       |

---

### Dependency graph

```
components/  ──►  hooks/  ──►  services/  ──►  modules/  ──►  core/storage.ts
                                                         └──►  utils/helpers.ts

parserService      ──► input/textInput ─► parser/parser ─► output/annotator   (called in sequence by the service)
dictionaryService  ──► dictionary/dictionary ──► dictionary/staticDb
subwordService     ──► subword/subwordParser
vocabService       ──► vocab/vocabManager ──► core/storage
```

- Arrows point from dependent to dependency.
- `dictionary.ts` → `staticDb.ts` is the only intra-module import; both belong to the same `dictionary` module.

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
│   └── architecture.md
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
│   ├── modules/
│   │   ├── input/
│   │   │   └── textInput.ts
│   │   ├── parser/
│   │   │   └── parser.ts
│   │   ├── output/
│   │   │   └── annotator.ts
│   │   ├── dictionary/
│   │   │   ├── dictionary.ts
│   │   │   └── staticDb.ts
│   │   ├── subword/
│   │   │   └── subwordParser.ts
│   │   └── vocab/
│   │       └── vocabManager.ts
│   └── utils/
│       └── helpers.ts
├── package.json
├── vite.config.ts (root: 'src')
└── README.md
```

- `src/` contains all source files. `dist/` is generated by Vite and is git-ignored.
- Each logic module is a self-contained directory under `modules/`.

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
