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

## Purpose

Rules and reference for AI agents (and humans) developing Enparse. Read this document before making any change.

- Items marked **(proposed)** are agent proposals not yet confirmed by the project owner. Follow them until confirmed or replaced; do not treat them as final decisions.

---

## Project at a glance

- **What:** Browser-based English grammar and vocabulary study tool for Korean speakers (beginner to intermediate).
- **Core features:** sentence structure breakdown (NP/VP chunks, ambiguity alternatives), dictionary lookup (English + Korean), subword parsing (prefixes, bases, suffixes), vocabulary lists with export/import.
- **Hard constraint:** fully client-side. No server-side computation, no backend, no live API calls at runtime.
- **Stack:** React 18+, TypeScript, Vite, React Router (hash routing), CSS Modules, Transformers.js + in-house ONNX tagger, wink-nlp.

---

## Source-of-truth documents

| Document | Contains | Read when |
|----------|----------|-----------|
| `dev_meta/plan.md` | Project overview, **Undecided** list | Always, before starting a task |
| `dev_meta/architecture.md` | Stack, layers, modules, parsing engine, skeleton | Before writing or moving any code |
| `dev_meta/plan-training.md` | Parser model training phases | Before working in `training/` or on the model |
| `dev_meta/agents.md` | This guide | Always |

- Documents win over code. If code and documents disagree, stop and report the conflict; do not silently follow either.
- If a task needs a decision listed under **Undecided** in `plan.md`, ask the owner. Do not decide it yourself. If you must proceed, use a clearly marked **(proposed)** default and add it to the Undecided item.

---

## Agent workflow

1. **Read** the four documents above (at least the sections relevant to the task).
2. **Check Undecided.** If the task depends on an open item, ask before proceeding.
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
- Never add network calls, telemetry, or analytics.

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

- Files inside one module may import each other.
- **Module public API (proposed):** each module exposes its public functions and types through `modules/<name>/index.ts`. Other layers import only from that file, never from internal files.
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
- The only allowed network requests are loading static assets (model files, dictionary data) from the app's own static host.
- Preprocessor limits and ambiguity thresholds come from constants or `labels.json`, never hard-coded in multiple places.

### User-facing text

- The UI language is undecided. Keep user-facing strings in one place per component (a `strings` constant at the top of the file) so they can be moved to an i18n system later.

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
9. **Documents:** update `plan.md` (resolved Undecided items) and changelogs.

### Adding a parser backend

- Implement the `ParserBackend` interface in `modules/parser/<name>Backend.ts`.
- Register it in `parser.worker.ts`. Do not change other parser files unless the interface changes.
- Add it to `evaluate_baselines.mjs` or `evaluate.py` so its accuracy is measured on the same test set.

---

## Testing guide

**Tooling (proposed):** Vitest for unit tests, React Testing Library for components, Playwright for end-to-end browser tests.

- **Modules:** unit tests for every public function, including edge cases (empty input, max length, non-Latin text).
- **Services:** test composition and subscription behavior with mocked modules.
- **Components:** test rendering and user interactions through hooks with mocked services.
- **Parser:** a fixed regression set of sentences with expected chunks; run against the shipped model and the fallback backend.
- **End-to-end:** paste text → see chunks → look up a word → add to vocab list → export.
- A change is not done until related tests exist and pass.

---

## Tooling and commands (proposed)

Not set up yet. Tracked under *Tooling* in `plan.md` → *Undecided*.

| Item | Proposed |
|------|----------|
| Node.js | 20 LTS or newer |
| Package manager | npm (lockfile committed) |
| Lint / format | ESLint (typescript-eslint, react-hooks plugin) + Prettier |
| Tests | Vitest, React Testing Library, Playwright |

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Unit and component tests |
| `npm run test:e2e` | Playwright tests |

### Training code (`training/`)

- Python 3.12 managed with `uv`; dependencies pinned in `requirements.txt`.
- Format and lint with `ruff` (proposed); type hints on all functions; tests with `pytest`.
- Every script reads settings from `configs/*.yaml`; no hard-coded paths or hyperparameters.
- Never commit raw or processed datasets, checkpoints, or large ONNX files to `training/` (git-ignored). Shipped model files live in `public/models/`.
- Follow the phase order and exit criteria in `plan-training.md`; record outcomes there.

---

## Dependency policy

- **Licenses:** only permissive licenses that allow commercial use (MIT, Apache 2.0, BSD, ISC). No GPL/AGPL, no non-commercial (CC BY-NC) code, models, or data.
- **Approval:** new runtime dependencies require owner approval and an entry in `architecture.md` → *Technology stack*.
- **Versions:** pin exact versions in the lockfile; note major-version upgrades in the changelog.
- **Size:** report the bundle size impact of any new runtime dependency.
- **Data and models:** record source, license, and version for every dataset or model (see `MODEL_CARD.md` for the parser).

---

## Documentation guide

### Which document to update

| Change | Update |
|--------|--------|
| Decision on an Undecided item | Remove it from `plan.md` → *Undecided*; record the decision in `plan.md` or `architecture.md` |
| New/changed module, service, hook, component, route, or dependency | `architecture.md` (modules table, graph, skeleton, stack) |
| Parser model, training data, or training process | `plan-training.md` (and `architecture.md` → *Parsing engine* if runtime behavior changes) |
| Agent workflow, conventions, or tooling | `agents.md` |
| New open question found during work | Add to `plan.md` → *Undecided* |

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

## 2026-11-17T02:24:51Z — Claude Opus 5.5, Created agent development guide

- Added: Document Maintaining Guide (same as other `dev_meta/` documents).
- Added: project summary, source-of-truth documents, agent workflow and boundaries, architecture rules summary.
- Added: coding, module/feature, testing, tooling, dependency, and documentation guides; definition of done.
- Added (proposed): module public API via `index.ts`; Vitest/RTL/Playwright; npm; ESLint + Prettier; ruff for training code.
