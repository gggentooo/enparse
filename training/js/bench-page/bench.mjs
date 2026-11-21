/**
 * training/js/bench-page/bench.mjs — page logic for the browser benchmark and the T31 cache spike
 *
 * Description:
 *   bench, phase=cold: clear the model cache; load (download + init) with the
 *          app's parser worker; one parse.
 *   bench, phase=warm: (fresh page, same browser profile) load from Cache
 *          Storage; one warm-up parse, then `runs` parses of sample.txt
 *          (median). Phase timestamps feed the driver's memory sampling.
 *   suite: run a list of bench steps one after another (manual runs on another
 *          machine, T67; see suiteSteps).
 *   spike: clear the cache; download the model's files like modelLibrary will
 *          (fetch, stream, Blob), SHA-256 each with crypto.subtle.digest
 *          (whole-file buffer) and compare with labels.json → files; store
 *          them in the "transformers-cache" cache under the absolute
 *          /models/<model>/<file> URL; then load the model in the app's
 *          worker and list the /models requests made during the load (none
 *          for the cached files means Transformers.js reused them).
 *
 * Phases: 10 (T64); T31. Dependencies: app src/modules/parser/index.ts.
 * Status: implemented (T31, T64).
 */

import { createParserWorker } from "../../../src/modules/parser/index.ts";

const CACHE = "transformers-cache";
const params = new URL(location.href).searchParams;
const mode = params.get("mode") ?? "bench";
const SUITE_PAUSE_MS = 4000;
const modelId = params.get("model") ?? "deberta_v3_xsmall";
const variant = params.get("variant") === "fp16" ? "fp16" : "int8";
const runs = Number(params.get("runs") ?? 10);
const model = { id: modelId, folder: modelId, variant, nestedView: true };
const out = document.getElementById("log");
const marks = [];
// Visibility and focus during the run: Safari/macOS may throttle hidden or unfocused pages.
const visibility = { hidden_events: 0, focus_samples: 0, unfocused_samples: 0 };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") visibility.hidden_events++;
});
setInterval(() => {
  visibility.focus_samples++;
  if (!document.hasFocus()) visibility.unfocused_samples++;
}, 500);
const mark = (name) => marks.push({ name, t: Date.now() });
const log = (s) => (out.textContent += `${s}\n`);
/** Progress to the bench server (shows where a hung run stopped). */
const progress = (step) =>
  fetch("/__bench/progress", { method: "POST", body: JSON.stringify({ token: params.get("token"), step, t: Date.now() }) }).catch(() => undefined);
self.addEventListener("error", (e) => progress(`window error: ${e.message}`));
self.addEventListener("unhandledrejection", (e) => progress(`unhandled rejection: ${String(e.reason)}`));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const logSince = async (n) => (await fetch(`/__bench/log?since=${n}`)).json();

function environment() {
  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated === true,
    webgpu: "gpu" in navigator,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
  };
}

async function loadTimed() {
  const client = createParserWorker();
  progress("worker created");
  client.onStatus((st) => progress(`status ${JSON.stringify(st)}`));
  const t0 = performance.now();
  await client.load(model);
  return { client, ms: performance.now() - t0, status: client.status() };
}

/** Cold: empty cache, download + init, one parse. Warm (fresh page, same profile): cached load, warm-up, runs. */
async function bench(phase) {
  const sample = await (await fetch("/sample.txt")).text();
  progress("sample fetched");
  if (phase === "cold") {
    await caches.delete(CACHE);
    progress("cache cleared");
    mark("cold_load_start");
    const cold = await loadTimed();
    mark("cold_load_end");
    const t0 = performance.now();
    await cold.client.parse(sample);
    const firstParseMs = performance.now() - t0;
    mark("cold_parse_end");
    cold.client.dispose();
    return {
      phase,
      cold_load_ms: cold.ms,
      backend: cold.status.state === "ready" ? cold.status.backend : null,
      cold_first_parse_ms: firstParseMs,
    };
  }
  mark("warm_load_start");
  const warm = await loadTimed();
  mark("warm_load_end");
  const first = performance.now();
  const r0 = await warm.client.parse(sample);
  const warmupMs = performance.now() - first;
  mark("parse_start");
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await warm.client.parse(sample);
    times.push(performance.now() - t0);
  }
  mark("parse_end");
  warm.client.dispose();
  const words = r0.sentences.reduce((n, s) => n + s.tokens.length, 0);
  return {
    phase,
    warm_load_ms: warm.ms,
    backend: warm.status.state === "ready" ? warm.status.backend : null,
    first_parse_ms: warmupMs,
    parse_median_ms: median(times),
    parse_ms: times,
    sample_chars: sample.length,
    sentences: r0.sentences.length,
    words,
    sentences_with_alternatives: r0.sentences.filter((s) => s.alternatives.length > 0).length,
  };
}

async function spike() {
  await caches.delete(CACHE);
  const labels = await (await fetch(`/models/${modelId}/labels.json`)).json();
  const onnx = variant === "fp16" ? "onnx/model_fp16.onnx" : "onnx/model_quantized.onnx";
  const files = Object.keys(labels.files).filter((f) => !f.startsWith("onnx/") || f === onnx);
  const cache = await caches.open(CACHE);
  const perFile = [];
  mark("download_start");
  for (const f of files) {
    const url = new URL(`/models/${modelId}/${f}`, location.href).href;
    const t0 = performance.now();
    const res = await fetch(url);
    const reader = res.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.length;
    }
    const blob = new Blob(chunks);
    const downloadMs = performance.now() - t0;
    mark(`hash_start:${f}`);
    const t1 = performance.now();
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hashMs = performance.now() - t1;
    mark(`hash_end:${f}`);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    await cache.put(
      url,
      new Response(blob, { headers: { "Content-Type": res.headers.get("Content-Type") ?? "", "Content-Length": String(bytes) } }),
    );
    perFile.push({ file: f, bytes, download_ms: downloadMs, hash_ms: hashMs, sha256_ok: hex === labels.files[f].sha256 });
    log(`${f}: ${bytes} bytes, hash ${hashMs.toFixed(0)} ms, ok ${hex === labels.files[f].sha256}`);
  }
  mark("download_end");
  const before = (await logSince(0)).next;
  mark("load_start");
  const loaded = await loadTimed();
  mark("load_end");
  const after = await logSince(before);
  const parsed = await loaded.client.parse("The red dog rarely barks loudly.");
  loaded.client.dispose();
  const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
  return {
    files: perFile,
    load_ms: loaded.ms,
    backend: loaded.status.state === "ready" ? loaded.status.backend : null,
    requests_during_load: after.entries.map((e) => e.path),
    model_files_refetched: after.entries.filter((e) => files.some((f) => e.path === `/models/${modelId}/${f}`)).map((e) => e.path),
    cache_keys: keys,
    parse_ok: parsed.sentences[0]?.tokens.length === 7,
  };
}

/**
 * Suite (T67, manual runs on another machine): steps = models × variants × (cold, warm); each step
 * is a fresh page; after a step posts its result, the page waits SUITE_PAUSE_MS (idle baseline for
 * the memory sampler) and moves to the next step. ?mode=suite&label=<name>[&models=…][&variants=…][&runs=…]
 */
function suiteSteps() {
  const models = (params.get("models") ?? "deberta_v3_xsmall,modernbert_base").split(",");
  const variants = (params.get("variants") ?? "int8,fp16").split(",");
  return models.flatMap((m) => variants.flatMap((v) => ["cold", "warm"].map((phase) => ({ model: m, variant: v, phase }))));
}

function suiteUrl(i) {
  const q = new URLSearchParams(params);
  q.set("mode", "suite");
  q.set("i", String(i));
  return `/?${q}`;
}

if (mode === "suite") {
  const steps = suiteSteps();
  const i = Number(params.get("i") ?? 0);
  const label = params.get("label") ?? "manual";
  if (i >= steps.length) {
    progress(`suite done ${label}`);
    document.title = "SUITE DONE";
    log(`Suite "${label}" finished (${steps.length} steps). You can close this tab.`);
  } else {
    const st = steps[i];
    const q = new URLSearchParams({
      mode: "bench",
      phase: st.phase,
      model: st.model,
      variant: st.variant,
      runs: params.get("runs") ?? "10",
      token: `${label}-${i}`,
      suite: suiteUrl(i + 1),
    });
    log(`Step ${i + 1}/${steps.length}: ${st.model} ${st.variant} ${st.phase} (starting in ${SUITE_PAUSE_MS / 1000} s)…`);
    setTimeout(() => location.replace(`/?${q}`), SUITE_PAUSE_MS);
  }
}

if (mode !== "suite") (async () => {
  const started = Date.now();
  progress(`start ${mode} ${params.get("phase") ?? ""} isolated=${self.crossOriginIsolated}`);
  let result;
  try {
    const body = mode === "spike" ? await spike() : await bench(params.get("phase") === "cold" ? "cold" : "warm");
    result = { ok: true, mode, model: modelId, variant, ...body };
  } catch (e) {
    result = { ok: false, mode, model: modelId, variant, phase: params.get("phase"), error: String(e?.stack ?? e) };
  }
  Object.assign(result, { env: environment(), marks, started, token: params.get("token"), visibility });
  log(JSON.stringify(result, null, 1));
  await fetch("/__bench/result", { method: "POST", body: JSON.stringify(result) });
  window.__benchResult = result;
  document.title = result.ok ? "DONE" : "ERROR";
  const next = params.get("suite");
  if (next) setTimeout(() => location.replace(next), 1000);
})();
