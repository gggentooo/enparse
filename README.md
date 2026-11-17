<!--
README.md — project entry point

Description:
  Short project description, setup, and commands. Kept in sync with
  dev_meta/agents.md → Tooling and commands (agents.md → Code documentation).

Tasks:
  1. Fill Setup once tooling is confirmed (plan.md → Undecided → Tooling).
  2. Keep the Commands table identical to agents.md.

Dependencies:
  dev_meta/agents.md, dev_meta/architecture.md, training/README.md.

Status: skeleton only.
-->

# Enparse

Browser-based English grammar and vocabulary study tool for Korean speakers (beginner to intermediate). Fully client-side: no backend, no runtime API calls.

- Architecture: [`dev_meta/architecture.md`](dev_meta/architecture.md)
- Development rules: [`dev_meta/agents.md`](dev_meta/agents.md)
- Model training: [`training/README.md`](training/README.md)

## Setup

TODO(tooling): written once tooling is confirmed.

## Commands (proposed)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Unit and component tests |
| `npm run test:e2e` | Playwright tests |
