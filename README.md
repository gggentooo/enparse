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

Requires Node.js 20+ and npm. From the repository root:

```bash
npm ci
npm run typecheck
npm test
```

## Commands

| Command | Purpose | Status |
|---------|---------|--------|
| `npm run dev` | Start the Vite dev server | Available |
| `npm run build` | Production build into `dist/` | Available |
| `npm run typecheck` | `tsc --noEmit` | Available |
| `npm test` | Unit tests (`vitest run`) | Available |
| `npm run lint` | ESLint + Prettier check | Not set up |
| `npm run test:e2e` | Playwright tests | Not set up |
