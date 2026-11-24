# Enparse Agent Development Guide

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

## Purpose

Rules and reference for AI agents (and humans) developing Enparse. Read this document before making any change.

- Items marked **(proposed)** are agent proposals not yet confirmed by the project owner. Follow them until confirmed or replaced; do not treat them as final decisions.

---

## Project at a glance

- **What:** Browser-based English grammar and vocabulary study tool for Korean speakers (beginner to intermediate).
- **Core features:** sentence structure breakdown (NP/VP chunks, ambiguity alternatives), dictionary lookup (English + Korean), subword parsing (prefixes, bases, suffixes), vocabulary lists with export/import.
- **Hard constraint:** fully client-side. No server-side computation, no backend, no live API calls at runtime.
- **Stack:** React 19, TypeScript, Vite, react-router (hash routing), CSS Modules, Transformers.js + in-house ONNX tagger, wink-nlp. Hosted on Cloudflare Pages with model files in R2, served on the app's origin.

---

## Source-of-truth documents

| Document | Contains | Read when |
|----------|----------|-----------|
| `dev_meta/plan.md` | Project overview and core features | Always, before starting a task |
| `dev_meta/todo.md` | Tasks and open owner decisions, ordered by dependency (replaces the former *Undecided* list) | Always, before starting a task |
| `dev_meta/architecture.md` | Stack, layers, modules, parsing engine, skeleton | Before writing or moving any code |
| `dev_meta/plan-training.md` | Parser model training phases | Before working in `training/` or on the model |
| `dev_meta/agents.md` | This guide | Always |

- Documents win over code. If code and documents disagree, stop and report the conflict; do not silently follow either.
- If a task needs an open **Decision** task in `todo.md`, ask the owner. Do not decide it yourself. If you must proceed, use a clearly marked **(proposed)** default and note it in that task.

---

## Agent workflow

1. **Read** the documents above (at least the sections relevant to the task).
2. **Check `todo.md`.** If the task's *Needs* are not done (especially owner **Decision** tasks), ask before proceeding.
3. **Plan** the change: list files to add or modify; confirm they fit the layer rules.
4. **Implement** in small, reviewable steps.
5. **Verify:** typecheck, lint, tests, and (for UI) a manual check in the browser.
6. **Update documents** affected by the change (see *Documentation guide*).
7. **Report** what changed, what was verified, and what was not.

### Agent boundaries

- Commit, push, or open pull requests only when the owner asks.
- Do not add runtime dependencies without owner approval (see *Dependency policy*).
- Do not change the architecture (layers, module list, stack) without updating `architecture.md` in the same change and telling the owner.
- Do not delete or rewrite document content outside the task's scope.
- Never add network calls, telemetry, or analytics (owner confirmed no tracking at all, T17).
- **Never let visitors upload data** (owner, 2026-11-24; T99): no Function, route, or app code may write to the R2 bucket or any other server-side store. The Functions in `functions/` answer GET and HEAD only and never call a bucket write; tests in `functions/models/[[path]].test.ts` enforce this. Features that move user data between people use links and files (shared results, vocabulary export), never a server.

---

## Architecture rules (summary)

Full details: `architecture.md` → *Layers*.

```
components/ → hooks/ → services/ → modules/ → core/, utils/
```

| Layer | Allowed | Not allowed |
|-------|---------|-------------|
| `components/` | Rendering, user events, calling hooks | Business logic; importing services or modules |
| `hooks/` | Calling services; React state; `useSyncExternalStore` subscriptions | Importing modules directly |
| `services/` | Composing modules; holding shared state; `subscribe()` / `getSnapshot()` | Importing other services; React imports |
| `modules/` | Pure TypeScript logic; listed external libraries | React, DOM access, rendering; importing other modules |
| `core/`, `utils/` | Infrastructure helpers | Importing any other layer |
| `i18n/` | UI message catalogs and lookup (T68); importable by components, hooks, services | Importing any other layer |
| `pwa/` | Service worker source and rules (T69); built separately | Importing any other layer |

- Files inside one module may import each other.
- **Module public API:** each module exposes its public functions and types through `modules/<name>/index.ts`. Other layers import only from that file, never from internal files.
- **Exception — training tools:** `training/js` scripts may run a module's internal file through `tsx` (e.g., `parser/winkBackend.ts`, `parser/treeDecoder.ts`) so training uses the exact runtime code. They are not an app layer.
- No event bus. Cross-component updates go through service subscriptions; parent/child data goes through props.

---

## Coding guide

### TypeScript

- `strict: true` in `tsconfig.json`. No `any`; use `unknown` and narrow it.
- Prefer `type` for data shapes and `interface` for contracts implemented by classes or backends (e.g., `ParserBackend`).
- Public functions have explicit parameter and return types.
- Use named exports. No default exports, except where a tool requires them.
- Async APIs return `Promise<T>`. Errors are thrown as typed `Error` subclasses (e.g., `ParserLoadError`); no silent failures.
- No magic numbers for limits and thresholds. Put them in a named, exported constant in the owning module (e.g., `MAX_INPUT_CHARS = 5000`).

### Naming

| Item | Convention | Example |
|------|-----------|---------|
| React component files | `PascalCase.tsx` | `OutputPage.tsx` |
| CSS Module files | Same name as component | `OutputPage.module.css` |
| Other TS files | `camelCase.ts` | `vocabManager.ts` |
| Hooks | `useXxx` | `useParser` |
| Services | `xxxService` | `parserService` |
| Types | `PascalCase` | `ParseResult` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_ALTERNATIVES` |
| Test files | Next to source, `.test.ts(x)` | `subwordParser.test.ts` |

### React

- Function components and hooks only. No class components.
- Components receive data through props or hooks; they never call services or modules directly.
- Keep components small. Split when a file exceeds ~200 lines or mixes unrelated concerns.
- Shared UI goes in `components/Shared/`; page-specific UI stays next to its page.
- Every interactive element is keyboard-accessible and has an accessible name.

### Styling

- One `.module.css` per component. No inline styles except for values computed at runtime.
- Use design tokens from `css/tokens.css` (colors, spacing, fonts). No hard-coded colors or spacing values.
- Global styles only in `css/global.css`.

### Parser and worker code

- Parsing runs only inside `parser.worker.ts`. Never parse on the main thread.
- The only allowed network requests are loading static assets (model files, dictionary data) from the app's own static host: GET and HEAD only, never a request that sends user data. Model files are served at `/models/*` on that origin by the Pages Function in `functions/models/` (from R2; owner, 2026-11-21, T12); this is the same origin, not an exception.
- Preprocessor limits and ambiguity thresholds come from constants or `labels.json`, never hard-coded in multiple places.

### User-facing text

- The UI is in Korean, with English terms beside grammar labels (owner, 2026-11-21; T18). All user-facing text goes through the app's i18n plumbing (T68) so more languages can be added; until T68 lands, keep it in one `strings` constant per file.

### Comments

- Explain *why*, not *what*. Document public functions with a one-line TSDoc comment.
- Mark known gaps with `TODO(<topic>):` and a short reason; do not leave untracked TODOs.

---

## Adding a new module or feature

1. **Check scope:** confirm the feature is in `plan.md` or approved by the owner.
2. **Update `architecture.md` first:** add the module to *Logic modules*, the service/hook to *Services and hooks*, the dependency graph, and the skeleton.
3. **Logic module:** create `src/modules/<name>/` with `index.ts` (public API), implementation files, and `types.ts` for shared types. No React or DOM.
4. **Service:** create `src/services/<name>Service.ts` wrapping the module. If it holds shared state, implement `subscribe()` and `getSnapshot()`.
5. **Hook:** create `src/hooks/use<Name>.ts` exposing the service to components.
6. **Components:** add components in `src/components/`, each with a `.module.css` file.
7. **Route (pages only):** add the route to `src/routes.tsx` and a link in `Sidebar.tsx`.
8. **Tests:** unit tests for the module and service; component tests for new UI.
9. **Documents:** update `todo.md` (finished tasks to *Done*) and changelogs.

### Adding a parser backend

- Implement the `ParserBackend` interface in `modules/parser/<name>Backend.ts`.
- Register it in `parser.worker.ts`. Do not change other parser files unless the interface changes.
- Add it to `evaluate.py` so its accuracy is measured on the same test set.
- There is no rule-based fallback backend: a backend must load the model fully before it accepts parse requests (`architecture.md` → *Model readiness*).

---

## Testing guide

**Tooling:** Vitest 5.1.0 for unit tests; React Testing Library 16 + jsdom for components (opt in per file with `// @vitest-environment jsdom`); Playwright for end-to-end browser tests (all approved; T13). **End-to-end tests (T62; owner, 2026-11-23):** `e2e/*.spec.ts`, run in the system Chrome (`channel: "chrome"`; no browser download). CI has no model files, so `npm run test:e2e` starts `vite --mode e2e`, where `vite.e2e.ts` swaps the parser worker's model backend for `e2e/fakeBackend.ts` (a deterministic word-list tagger with the `ParserBackend` contract) and serves a small e2e catalog and the test dictionary; everything else is the real app. `npm run test:e2e:models` runs the same tests against the trained models and the built dictionary (local only). The stand-ins never enter production builds. **Release checks (T66):** `src/modules/parser/packagedModels.test.ts` runs every packaged model in Node against its Phase 9 outputs (skipped without packaged files), and `npm run test:e2e:release` runs `e2e/release.spec.ts` (and the main flow) against the production build behind the real Pages Functions; run both before uploading a release.

- **Modules:** unit tests for every public function, including edge cases (empty input, max length, non-Latin text).
- **Services:** test composition and subscription behavior with mocked modules.
- **Components:** test rendering and user interactions through hooks with mocked services.
- **Parser:** a fixed regression set of sentences with expected chunks; run against the shipped model. Test that parsing is refused before the model is ready.
- **End-to-end:** paste text → see chunks → look up a word → add to vocab list → export.
- A change is not done until related tests exist and pass.

---

## Tooling and commands

Tooling decisions: T13 (owner, 2026-11-21).

| Item | Choice | Status |
|------|--------|--------|
| Node.js | 20 LTS or newer | Approved |
| Package manager | npm (lockfile committed; exact versions) | Approved |
| Language | TypeScript 7.0.2 (`strict`) | Approved |
| Build | Vite 8.3.8 (same version as `training/js`) | Approved |
| Unit tests | Vitest 5.1.0 | Approved |
| Frontend | React 19.3.1, react-dom 19.3.1, react-router 8.5.2, `@vitejs/plugin-react` 6.3.0 | Approved (2026-11-21, T13) |
| Component / end-to-end tests | React Testing Library 16.3.3 + jsdom 31.0.1; Playwright 1.65.1; fake-indexeddb 6.2.8 (IndexedDB in unit tests) | Approved (2026-11-21, T13; fake-indexeddb with T29) |
| Lint / format | oxlint 1.94.0 (`.oxlintrc.json`: correctness errors, react hooks, no `any`, no default exports) + Prettier 3.10.1 (`printWidth` 120) | Approved (2026-11-21, T13; ESLint not used: typescript-eslint supports TypeScript < 6.1 only) |
| CI | GitHub Actions (`.github/workflows/ci.yml`: typecheck, lint, test, build, end-to-end tests with the fake model backend in the runner's Chrome; checkout without LFS) | Approved (2026-11-21, T13; e2e step T62) |

| Command | Purpose | Status |
|---------|---------|--------|
| `npm run dev` | Start the Vite dev server | Available |
| `npm run dev:models` | Dev server plus a local `/models/*` route serving the selected training exports (`vite.localModels.ts`; README → *Test the models locally*) | Available |
| `npm run build` | Production build into `dist/` | Available |
| `npm run typecheck` | `tsc --noEmit` | Available |
| `npm test` | Unit tests (`vitest run`) | Available |
| `npm run lint` | oxlint + Prettier check (`src/`, `functions/`, `vite.config.ts`, `vite.localModels.ts`) | Available |
| `npm run format` | Prettier write | Available |
| `npm run test:e2e` | End-to-end tests (Playwright, system Chrome) against `vite --mode e2e`: fake model backend, e2e catalog, test dictionary (`vite.e2e.ts`); run in CI | Available |
| `npm run test:e2e:models` | The same end-to-end tests against the trained models and the built dictionary on this machine (`vite --mode local-models`); not in CI | Available |
| `npm run test:e2e:release` | End-to-end tests against the production build with the packaged models (`vite preview --mode release`; release check before uploading, T66); not in CI | Available |
| `npm run preview:release` | Build, then preview the site as deployed: `/models` and `/dict` through the Pages Functions from the release files (`vite.release.ts`) | Available |
| `npm run r2 -- list \| upload <bucket> \| verify <site>` | Release files in R2 (`scripts/r2.ts`; see [`PUBLISHING.md`](PUBLISHING.md)) | Available |

### Training code (`training/`)

- Python 3.12 managed with `uv`; dependencies pinned in `requirements.txt`.
- Format and lint with `ruff`; type hints on all functions; tests with `pytest`.
- Node tools in `training/js/`: ES modules with JSDoc types; unit tests with Node's built-in `node:test` (`npm test`, no extra dependency).
- Every script reads settings from `configs/*.yaml`; no hard-coded paths or hyperparameters.
- Never commit raw or processed datasets, checkpoints, or large ONNX files to `training/` (git-ignored). Shipped model files live in `public/models/` and are tracked with Git LFS (`.gitattributes`); never commit them as regular git blobs.
- Follow the phase order and exit criteria in `plan-training.md`; record outcomes there.

---

## Dependency policy

- **Licenses (dependencies and data):** only permissive licenses that allow commercial use (MIT, Apache 2.0, BSD, ISC). No GPL/AGPL, no non-commercial (CC BY-NC) code, models, or data. Share-alike data (CC BY-SA) is accepted for the models and dictionary (owner).
- **The app's own code** is licensed under PolyForm Noncommercial 1.0.0 (`LICENSE.md`; owner, 2026-11-21, T16). Keep the `Required Notice:` line in `LICENSE.md`, `README.md`, and the About page identical.
- **Unshipped exceptions:** weak-copyleft (LGPL, MPL) transitive dependencies are allowed only if they never reach the app bundle (install-time or Node-only code). Accepted: `sharp-libvips` (LGPL-3.0, via the Node build of Transformers.js) and `lightningcss` (MPL-2.0, via Vite). Re-check with a license scan of `package-lock.json` when dependencies change.
- **Approval:** new runtime dependencies require owner approval and an entry in `architecture.md` → *Technology stack*.
- **Versions:** pin exact versions in the lockfile; note major-version upgrades in the changelog.
- **Size:** report the bundle size impact of any new runtime dependency.
- **Data and models:** record source, license, and version for every dataset or model (see `MODEL_CARD.md` for the parser).

---

## Documentation guide

### Which document to update

| Change | Update |
|--------|--------|
| Decision on a `todo.md` **Decision** task | Record the decision in `plan.md`, `architecture.md`, or `plan-training.md`; move the task to `todo.md` → *Done* |
| Task finished | Move it to `todo.md` → *Done*; update tasks that list it under *Needs* |
| New/changed module, service, hook, component, route, or dependency | `architecture.md` (modules table, graph, skeleton, stack) |
| Parser model, training data, or training process | `plan-training.md` (and `architecture.md` → *Parsing engine* if runtime behavior changes) |
| Agent workflow, conventions, or tooling | `agents.md` |
| New open question or task found during work | Add a task to `todo.md` at the right dependency stage |

### Writing rules

- Follow each document's *Document Maintaining Guide*: direct edits, concise language, changelog entry for every change.
- **Changelog entries:** ISO 8601 UTC timestamp from the system clock (`date -u +%Y-%m-%dT%H:%M:%SZ`), author (username for humans, model name for agents), brief title, then `Added` / `Modified` / `Removed` bullets.
- Keep documents consistent: a change in one document that affects another must update both in the same task.
- Use tables for structured facts, short bullets for rules, and code blocks for trees and diagrams.
- Mark unconfirmed agent suggestions as **(proposed)**.

### Code documentation

- `README.md` covers setup, commands, and a short project description; keep it in sync with *Tooling and commands*.
- Each module's `index.ts` starts with a short comment describing the module's purpose and public API.

---

## Definition of done

- [ ] Code follows the layer rules and coding guide.
- [ ] Typecheck, lint, and tests pass.
- [ ] UI changes checked in a browser (and keyboard-accessible).
- [ ] No new network calls, telemetry, or unapproved dependencies.
- [ ] Affected documents updated, with changelog entries.
- [ ] Report to the owner lists what was verified and what was not.

---

## Changelog

### 2026-11-17T02:24:51Z — Claude Opus 5.5, Created agent development guide

- Added: Document Maintaining Guide (same as other `dev_meta/` documents).
- Added: project summary, source-of-truth documents, agent workflow and boundaries, architecture rules summary.
- Added: coding, module/feature, testing, tooling, dependency, and documentation guides; definition of done.
- Added (proposed): module public API via `index.ts`; Vitest/RTL/Playwright; npm; ESLint + Prettier; ruff for training code.

### 2026-11-17T04:00:45Z — Claude Opus 5.5, ruff approved; Git LFS rule

- Modified: *Training code* — `ruff` approved by owner (proposed mark removed).
- Modified: *Training code* — shipped model files in `public/models/` are tracked with Git LFS.

### 2026-11-17T22:20:06Z — Claude Opus 5.5, Heading hierarchy

- Added: H1 document title "Enparse Agent Development Guide".
- Modified: *Document Maintaining Guide* is now an H2 section (*Rules*, *Format template* are H3); changelog entries are H3 under *Changelog*, and the format template matches.

### 2026-11-18T05:29:52Z — Claude Opus 5.5, Tool stack approved; module public API confirmed

- Modified: *Tooling and commands* — npm, Node 20+, TypeScript 7.0.2, Vite 8.3.8, Vitest 5.1.0 approved by owner; `dev`, `build`, `typecheck`, `test` available. ESLint + Prettier, RTL, Playwright still proposed.
- Modified: *Module public API* confirmed by owner (proposed mark removed); added the training-tools exception (`tsx` may run internal module files).

### 2026-11-18T05:38:31Z — Claude Opus 5.5, Unshipped dependency exception

- Added: *Dependency policy* → unshipped weak-copyleft exception (owner decision): `sharp-libvips`, `lightningcss`.

### 2026-11-18T06:27:44Z — Claude Opus 5.5, Node training tests

- Added: *Training code* — `training/js` tests use the built-in `node:test` runner.

### 2026-11-18T06:56:29Z — Claude Opus 5.5, No fallback mode

- Modified: testing guide and *Adding a parser backend* — no fallback backend; parsing refused before the model is ready.

### 2026-11-19T05:09:52Z — Claude Opus 5.5, todo.md replaces Undecided

- Added: `dev_meta/todo.md` to *Source-of-truth documents*.
- Modified: agent workflow, *Adding a new module or feature*, *Tooling and commands*, and *Documentation guide* point to `todo.md` instead of `plan.md` → *Undecided* (owner decision: the Undecided list moved to `todo.md`).

### 2026-11-20T23:00:24Z — Claude Opus 5.5, Tooling and hosting decided (T12, T13)

- Modified: *Project at a glance* → stack: React 19, react-router; hosting on Cloudflare Pages + R2 (T12).
- Modified: *Parser and worker code*: `/models/*` is served on the app's origin by the Pages Function (same-origin rule unchanged).
- Modified: *Testing guide* and *Tooling and commands*: React, RTL + jsdom, Playwright, oxlint + Prettier, GitHub Actions approved (T13); `npm run lint` and `npm run format` available.

### 2026-11-21T04:48:09Z — Claude Opus 5.5, fake-indexeddb approved

- Modified: *Tooling and commands*: fake-indexeddb 6.2.8 (Apache-2.0, dev only) approved by the owner for `storage.ts` tests (T29).

### 2026-11-21T04:57:03Z — Claude Opus 5.5, License, privacy, and UI language decided

- Modified: *Dependency policy*: dependency licenses vs. the app's own PolyForm Noncommercial license (T16); share-alike data accepted.
- Modified: *Agent boundaries*: no tracking confirmed (T17). *User-facing text*: Korean UI with English grammar terms, i18n plumbing (T18, T68).

### 2026-11-21T05:43:45Z — Claude Opus 5.5, i18n and PWA layers

- Added: *Architecture rules* → `i18n/` (message catalogs; T68) and `pwa/` (service worker; T69).

### 2026-11-21T07:18:46Z — Claude Opus 5.5, Local model testing command

- Added: *Tooling and commands* → `npm run dev:models` (trained models served locally by `vite.localModels.ts`).
- Modified: `npm run lint` covers `vite.localModels.ts`.

### 2026-11-23T14:00:00Z — Claude Opus 5.5, End-to-end tests and CI (T62)

- Added: *Testing guide* → end-to-end tests (fake model backend in CI, real models locally, system Chrome).
- Modified: *Tooling and commands* → `npm run test:e2e`, `npm run test:e2e:models` available; CI runs the end-to-end tests.

### 2026-11-23T14:30:00Z — Claude Opus 5.5, Release checks and publishing commands

- Added: *Testing guide* → release checks (packaged-model integration test, `test:e2e:release`).
- Added: *Tooling and commands* → `test:e2e:release`, `preview:release`, `r2`; `PUBLISHING.md`.

### 2026-11-24T05:30:41Z — Claude Fable 5.2, No uploads (T99)

- Added: *Agent boundaries* → visitors must never be able to upload data; the R2 bucket is read-only through the Functions (owner).
- Modified: *Parser and worker code* → the allowed requests are GET and HEAD only.
