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
 *   5. Vitest settings (environment jsdom, test files next to sources) (proposed).
 *   6. No proxies or server middleware: the app has no backend.
 *
 * Dependencies:
 *   Dev: vite, @vitejs/plugin-react, vitest (proposed).
 *   Related: src/index.html, src/main.tsx, src/modules/parser/parser.worker.ts,
 *            public/models/enparse-tagger/.
 *
 * Open items (plan.md → Undecided): deployment target (affects base path),
 *   Offline/PWA (would add a plugin here).
 *
 * Status: header only; not implemented.
 */
