/**
 * training/js/bench-page/vite.config.mjs — Vite server for the browser benchmark and cache spike
 *
 * Description:
 *   Serves bench-page/ with the app's production headers (COOP/COEP, so
 *   multi-threaded WASM works; BENCH_ISOLATION=0 drops them for the
 *   single-threaded check) and emulates the deployed /models/* route:
 *     /models/_ort/<file>        → node_modules/onnxruntime-web/dist/<file>
 *     /models/<model>/<file>     → training/data/onnx/<model>/<selected run>/<file>
 *   (selected run from data/eval/<model>/phase7_biaffine.json). labels.json gets
 *   a bench model_version (Phase 11 sets the real one). Every /models request
 *   is logged; the page and driver read the log and post results:
 *     GET  /__bench/log?since=<n>   requests since index n
 *     POST /__bench/result          appended to data/bench/results.jsonl
 *     POST /__bench/progress        appended to data/bench/progress.jsonl (steps, status, errors)
 *     POST /__bench/memory          client-side memory samples → data/bench/memory.jsonl (T67)
 *   The page imports the app's parser module (src/modules/parser) directly.
 *
 * Phases: 10 (T64); T31 cache spike. Started by ../bench_browsers.mjs.
 * Dependencies: vite (training/js devDependency); app sources in ../../../src.
 *
 * Status: implemented (T31, T64).
 */

import { createReadStream, existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..", "..");
const REPO = resolve(TRAINING, "..");
const ORT_DIST = join(REPO, "node_modules", "onnxruntime-web", "dist");
const RESULTS = join(TRAINING, "data", "bench", "results.jsonl");

const TYPES = { json: "application/json", onnx: "application/octet-stream", wasm: "application/wasm", mjs: "text/javascript", model: "application/octet-stream" };
export const requestLog = [];

function selectedRun(model) {
  const rec = JSON.parse(readFileSync(join(TRAINING, "data", "eval", model, "phase7_biaffine.json"), "utf8"));
  return rec.selected_run;
}

function resolveModelFile(rel) {
  const parts = rel.split("/").filter(Boolean);
  if (parts.some((p) => p === "..")) return null;
  if (parts[0] === "_ort") return join(ORT_DIST, ...parts.slice(1));
  const [model, ...rest] = parts;
  if (!model || rest.length === 0) return null;
  return join(TRAINING, "data", "onnx", model, selectedRun(model), ...rest);
}

function modelsMiddleware() {
  return {
    name: "enparse-bench-models",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname === "/__bench/log") {
          const since = Number(url.searchParams.get("since") ?? 0);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ next: requestLog.length, entries: requestLog.slice(since) }));
          return;
        }
        if (url.pathname === "/__bench/memory" && req.method === "POST") {
          // Memory samples from a sampler on the client machine (bench-page/vm-sampler.ps1):
          // [{ t, mb }] in the client's clock, the same clock as the page's marks.
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            const parsed = JSON.parse(body || "[]");
            const samples = Array.isArray(parsed) ? parsed : [parsed];
            mkdirSync(dirname(RESULTS), { recursive: true });
            appendFileSync(join(dirname(RESULTS), "memory.jsonl"), samples.map((x) => JSON.stringify(x)).join("\n") + "\n");
            res.end("ok");
          });
          return;
        }
        if (url.pathname === "/__bench/progress" && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            mkdirSync(dirname(RESULTS), { recursive: true });
            appendFileSync(join(dirname(RESULTS), "progress.jsonl"), body + "\n");
            res.end("ok");
          });
          return;
        }
        if (url.pathname === "/__bench/result" && req.method === "POST") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            mkdirSync(dirname(RESULTS), { recursive: true });
            appendFileSync(RESULTS, JSON.stringify({ ...JSON.parse(body), received_at: new Date().toISOString() }) + "\n");
            res.end("ok");
          });
          return;
        }
        if (!url.pathname.startsWith("/models/")) return next();
        const rel = decodeURIComponent(url.pathname.slice("/models/".length));
        let file;
        try {
          file = resolveModelFile(rel);
        } catch {
          file = null;
        }
        const entry = { path: url.pathname, method: req.method, status: 404, bytes: 0, t: Date.now() };
        requestLog.push(entry);
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }
        const ext = file.split(".").pop() ?? "";
        res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        if (rel.endsWith("/labels.json")) {
          const labels = JSON.parse(readFileSync(file, "utf8"));
          const body = JSON.stringify({ ...labels, model_version: labels.model_version ?? `bench-${rel.split("/")[0]}` });
          entry.status = 200;
          entry.bytes = body.length;
          res.end(body);
          return;
        }
        const size = statSync(file).size;
        res.setHeader("Content-Length", String(size));
        entry.status = 200;
        entry.bytes = size;
        if (req.method === "HEAD") return res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: HERE,
  plugins: [modelsMiddleware()],
  server: {
    port: process.env.BENCH_ISOLATION === "0" ? 5181 : 5180,
    strictPort: true,
    // BENCH_ISOLATION=0: no COOP/COEP, so the page is not cross-origin isolated and ONNX Runtime
    // runs WASM on one thread (the single-threaded check of Phase 10 task 4).
    headers:
      process.env.BENCH_ISOLATION === "0"
        ? {}
        : { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    fs: { allow: [REPO] },
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers", "onnxruntime-web"] },
});
