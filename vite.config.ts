/**
 * vite.config.ts — Vite build and dev-server configuration
 *
 * Description:
 *   Configures Vite for the static, fully client-side app. Source root is
 *   src/; static assets (model files) come from public/.
 *
 * Tasks:
 *   1. root: 'src'; publicDir: '../public'; build.outDir: '../dist'.
 *   2. Enable @vitejs/plugin-react.
 *   3. Worker format 'es' so parser.worker.ts can import Transformers.js and wink-nlp.
 *   4. Relative base path so hash routing works on any static host.
 *   5. Vitest settings (test files next to sources; node environment until
 *      component tests need jsdom).
 *   6. No proxies or server middleware: the app has no backend.
 *
 * Dependencies:
 *   Dev: vite 8.3.8, vitest 5.1.0; @vitejs/plugin-react (added with React).
 *   Related: src/index.html, src/main.tsx, src/modules/parser/parser.worker.ts,
 *            public/models/ (catalog.json + one folder per model).
 *
 * Open items (plan.md → Undecided): deployment target (affects base path),
 *   Offline/PWA (would add a plugin here).
 *
 * Status: tasks 1, 3, 4, 5, 6 implemented; task 2 (React plugin) added with React.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true },
  worker: { format: "es" },
  test: {
    root: ".",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // TODO(react): switch component tests to jsdom when React and RTL are added.
    environment: "node",
  },
});
