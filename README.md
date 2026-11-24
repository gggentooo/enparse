<!--
README.md — project entry point

Description:
  Short project description, setup, and commands. Kept in sync with
  dev_meta/agents.md → Tooling and commands (agents.md → Code documentation).

Tasks:
  1. Fill Setup once tooling is confirmed (dev_meta/todo.md → [Project] tooling task).
  2. Keep the Commands table identical to agents.md.

Dependencies:
  dev_meta/agents.md, dev_meta/architecture.md, training/README.md.

Status: setup and available commands written (2026-11-18); local model testing (2026-11-21); end-to-end tests (2026-11-23, T62).
-->

# Enparse

Browser-based English grammar and vocabulary study tool for Korean speakers (beginner to intermediate). Fully client-side: no backend, no runtime API calls.

- Architecture: [`dev_meta/architecture.md`](dev_meta/architecture.md)
- Development rules: [`dev_meta/agents.md`](dev_meta/agents.md)
- Model training: [`training/README.md`](training/README.md)

## Setup

Requires Node.js 20+, npm, and Git LFS (model files in `public/models/`). From the repository root:

```bash
git lfs install            # once per machine
npm ci
npm run typecheck && npm run lint && npm test
npm run dev                # http://localhost:5173/#/input
```

Deployment: Cloudflare Pages builds `dist/` (`npm run build`); model files are uploaded to the R2 bucket bound as `MODELS` and served at `/models/*` by `functions/models/[[path]].ts` (`dev_meta/architecture.md` → *Deployment*).

## Test the models locally

Until Phase 11 packages the models into `public/models/`, `npm run dev` has no models to offer (the app shows "the model list could not be loaded"). To try the trained models in the real app on your machine:

```bash
npm run dev:models         # http://localhost:5173/#/models
```

This is the normal dev server plus a local `/models/*` route (`vite.localModels.ts`) that serves the selected Phase 7 export of each offered model from `training/data/onnx/<model>/<run>/` (run from `training/data/eval/<model>/phase7_biaffine.json`), the way the deployed site serves them from R2. Names, metrics, and speeds come from the catalog fixture (`src/modules/modelLibrary/catalog.fixture.json`); file sizes and SHA-256 are computed from the files on disk, so a re-export is picked up on the next page load. The terminal lists the models it serves.

Then, in Chrome or Safari:

1. **Models** (`#/models`): choose a model (*이 모델 사용*). It downloads once, is verified, and loads; the header badge shows *준비됨* when ready. Downloaded models stay in the browser's cache, so later visits load them without downloading.
2. **Input** (`#/input`): paste English text and press *분석하기*.
3. **Output** (`#/output`): switch between the flat and structure views, open *다른 해석* where a sentence has other readings, and select words for details. *공유* shares the result without a server: a link for one sentence under 128 characters, a file otherwise (opened with *공유된 파일 열기*; T99). *어휘 통계* lists every word of the text with its part of speech, Korean meaning, and number of uses; *이 글로 단어장 만들기* turns the words into a new vocabulary list, with meanings from the dictionary or left empty (T105, T106).

Notes:

- Needs the training exports on this machine (`training/data/` is not in git). Models without an export are left out and named in the terminal.
- Use a normal browser window. Private windows have too little storage for the larger model (the app says so).
- Model files are not cached by the dev server, but the browser keeps downloaded models in Cache Storage. To re-test a download after a re-export, delete the model on the Models page (or clear the site data).
- `labels.json` gets `model_version` = `local-<run>` (Phase 11 sets the real one).
- The same server serves the dictionary data at `/dict/*` from `training/data/dict/` once it is built (`training/dictionary/`, T70).
- Local only: the route exists only in `npm run dev:models`, never in builds or the deployed site.

## Commands

| Command | Purpose | Status |
|---------|---------|--------|
| `npm run dev` | Start the Vite dev server | Available |
| `npm run dev:models` | Dev server that also serves the trained models locally at `/models/*` (see *Test the models locally*) | Available |
| `npm run build` | Production build into `dist/` | Available |
| `npm run typecheck` | `tsc --noEmit` | Available |
| `npm test` | Unit tests (`vitest run`) | Available |
| `npm run lint` | oxlint + Prettier check | Available |
| `npm run format` | Prettier write | Available |
| `npm run test:e2e` | End-to-end tests (Playwright, system Chrome) against `vite --mode e2e`: fake model backend, e2e catalog, test dictionary (`vite.e2e.ts`); run in CI | Available |
| `npm run test:e2e:models` | The same end-to-end tests against the trained models and the built dictionary on this machine (`vite --mode local-models`); not in CI | Available |
| `npm run test:e2e:release` | End-to-end tests against the production build with the packaged models (`vite preview --mode release`; release check before uploading, T66); not in CI | Available |
| `npm run preview:release` | Build, then preview the site as deployed: `/models` and `/dict` through the Pages Functions from the release files (`vite.release.ts`) | Available |
| `npm run r2 -- list \| upload <bucket> \| verify <site>` | Release files in R2 (`scripts/r2.ts`; see [`PUBLISHING.md`](PUBLISHING.md)) | Available |

## Publishing

The app is hosted on Cloudflare Pages, with the model files and dictionary in R2 and Cloudflare Access for a closed preview. Step-by-step instructions are in [`PUBLISHING.md`](PUBLISHING.md): package and check a release, upload, deploy, restrict access, share, and update.

## License

Required Notice: Copyright Hankyung Lee (https://github.com/gggentooo/enparse)

The app's source code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): use, changes, and sharing for non-commercial purposes only, keeping the Required Notice above. Parser model files are CC BY-SA 4.0 ([`training/MODEL_CARD.md`](training/MODEL_CARD.md)); third-party libraries and dictionary data keep their own licenses (in-app: *About & licenses*).
