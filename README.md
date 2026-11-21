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

Status: setup and available commands written (2026-11-18).
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

## Commands

| Command | Purpose | Status |
|---------|---------|--------|
| `npm run dev` | Start the Vite dev server | Available |
| `npm run build` | Production build into `dist/` | Available |
| `npm run typecheck` | `tsc --noEmit` | Available |
| `npm test` | Unit tests (`vitest run`) | Available |
| `npm run lint` | oxlint + Prettier check | Available |
| `npm run format` | Prettier write | Available |
| `npm run test:e2e` | Playwright tests | Added with the first tests (T62) |

## License

Required Notice: Copyright Hankyung Lee (https://github.com/gggentooo/enparse)

The app's source code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): use, changes, and sharing for non-commercial purposes only, keeping the Required Notice above. Parser model files are CC BY-SA 4.0 ([`training/MODEL_CARD.md`](training/MODEL_CARD.md)); third-party libraries and dictionary data keep their own licenses (in-app: *About & licenses*).
