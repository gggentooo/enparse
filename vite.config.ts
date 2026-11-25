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
 *   5. Vitest settings (test files next to sources; node environment;
 *      component tests opt in to jsdom per file).
 *   6. No proxies or server middleware: the app has no backend. Dev and
 *      preview send the COOP/COEP headers of public/_headers.
 *
 * Dependencies:
 *   Dev: vite 8.3.8, vitest 5.1.0, @vitejs/plugin-react 6.3.0 (T13).
 *   Related: src/index.html, src/main.tsx, src/modules/parser/parser.worker.ts,
 *            public/models/ (catalog.json + one folder per model).
 *
 * Hosting (owner, 2026-11-21; T12): Cloudflare Pages + R2. Model files are
 *   served from R2 at /models/* by functions/models/[[path]].ts, so the build
 *   leaves public/models/ and the bundled ONNX Runtime .wasm out of dist/
 *   (skipModelFiles; every file must stay under Pages' 25 MiB limit);
 *   COOP/COEP come from public/_headers.
 *
 * PWA (owner, T15/T69): pwaServiceWorker builds src/pwa/sw.ts into dist/sw.js
 *   with the precache list (no plugin dependency).
 *
 * Status: implemented.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { build, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { e2eStandIns } from "./vite.e2e.ts";
import { releasePreview } from "./vite.release.ts";
import { localModels } from "./vite.localModels.ts";
import { seo } from "./vite.seo.ts";

/** Cloudflare Pages' per-file limit (25 MiB); larger files go to R2. */
const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Production response headers (public/_headers): cross-origin isolation for multi-threaded WASM. */
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Leave public/models/ out of dist/: model files are served from R2 by functions/models/ (T12).
 * Also drop the ONNX Runtime Web .wasm that Vite copies from onnxruntime-web's fallback URL: the app
 * loads it from /models/_ort/ (transformerBackend.ts → wasmPaths; R2), and at 26.9 MB it is over
 * Cloudflare Pages' 25 MiB per-file limit and would be precached by the service worker (T66).
 */
function skipModelFiles(): Plugin {
  return {
    name: "enparse-skip-model-files",
    apply: "build",
    async closeBundle() {
      const dist = resolve(import.meta.dirname, "dist");
      await rm(join(dist, "models"), { recursive: true, force: true });
      const assets = join(dist, "assets");
      for (const f of await readdir(assets).catch(() => [] as string[])) {
        if (/^ort-wasm-.*\.wasm$/.test(f)) await rm(join(assets, f), { force: true });
      }
      const tooLarge = [];
      for (const f of await shellFiles(dist)) {
        if ((await stat(join(dist, f))).size > PAGES_MAX_FILE_BYTES) tooLarge.push(f);
      }
      if (tooLarge.length) throw new Error(`over Cloudflare Pages' 25 MiB file limit: ${tooLarge.join(", ")}`);
    },
  };
}

/** Files only crawlers and link previews read: not part of the offline app shell (T109–T113). */
const CRAWLER_ONLY = /^(robots\.txt|sitemap\.xml|og-image\.png|google[0-9a-f]+\.html|naver[0-9a-f]+\.html)$/;

/** Files of the built app shell (relative to dist/), excluding the worker itself and host config. */
async function shellFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  await walk(dir);
  return out.filter((f) => f !== "sw.js" && f !== "_headers" && !f.endsWith(".map") && !CRAWLER_ONLY.test(f)).sort();
}

/**
 * Build src/pwa/sw.ts into dist/sw.js after the app build (T69), with the precache list and a
 * version hash of the shell files' contents injected as __PRECACHE__ (hand-written; no plugin
 * dependency). Runs after skipModelFiles, so model files are never precached.
 */
function pwaServiceWorker(): Plugin {
  return {
    name: "enparse-service-worker",
    apply: "build",
    async closeBundle() {
      const dist = resolve(import.meta.dirname, "dist");
      const files = await shellFiles(dist);
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(await readFile(join(dist, f)));
      const precache = { version: hash.digest("hex").slice(0, 12), files };
      await build({
        configFile: false,
        logLevel: "warn",
        define: { __PRECACHE__: JSON.stringify(precache) },
        build: {
          outDir: dist,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          lib: {
            entry: resolve(import.meta.dirname, "src/pwa/sw.ts"),
            formats: ["iife"],
            name: "enparseSw",
            fileName: () => "sw.js",
          },
        },
      });
    },
  };
}

/** `vite --mode local-models` (npm run dev:models) serves the trained exports at /models/* (vite.localModels.ts). */
export default defineConfig(({ mode }) => ({
  root: "src",
  publicDir: "../public",
  base: "./",
  plugins: [
    react(),
    // Site address in the page head, robots.txt, sitemap.xml (T109–T113).
    seo(),
    skipModelFiles(),
    pwaServiceWorker(),
    ...(mode === "local-models" ? [localModels()] : []),
    // End-to-end tests without model files (T62): fake backend, e2e catalog, test dictionary.
    ...(mode === "e2e" ? [e2eStandIns()] : []),
    // Preview of the deployed site (T66): /models and /dict through the Pages Functions, R2 from disk.
    ...(mode === "release" ? [releasePreview()] : []),
  ],
  build: { outDir: "../dist", emptyOutDir: true },
  worker: { format: "es" },
  // Pre-bundle the worker's dependencies at server start: found later (first model load), they make
  // Vite reload the page, which cancels a running model download.
  optimizeDeps: { include: ["@huggingface/transformers", "wink-nlp", "wink-eng-lite-web-model"] },
  // Dev and preview send the production isolation headers, so development matches the deployed app.
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  test: {
    root: ".",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "functions/**/*.test.ts"],
    // Module tests run in Node; component tests (*.test.tsx) opt in with `// @vitest-environment jsdom`.
    environment: "node",
  },
}));
