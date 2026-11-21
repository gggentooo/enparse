/**
 * training/js/bench_browsers.mjs — Phase 10 browser benchmarks and the T31 cache spike (driver)
 *
 * Description:
 *   Starts bench-page/ (Vite; COOP/COEP; /models/* from the Phase 9 exports).
 *   For each browser × offered model × variant, in one fresh browser profile
 *   (Chrome) or tab sequence (Safari), opens bench-page/?mode=bench&phase=cold
 *   (empty cache: download, init, one parse), then a fresh page with
 *   phase=warm (cached load, warm-up, `runs` parses), and waits for each
 *   result. With --spike, also one cache-spike run per browser and model
 *   (largest variant). The app's own parser worker does the work
 *   (bench-page/bench.mjs).
 *   Memory: resident memory (RSS) of the browser's processes, sampled every
 *   benchmark.memory_sample_ms from outside; peak minus the idle baseline
 *   measured just before each page opens. The warm page's peak is the
 *   steady-state requirement (it covers WASM heaps and GPU-process memory,
 *   which JS heap APIs miss). The page records focus and visibility, since
 *   Safari throttles unfocused pages.
 *
 * Browsers (owner, 2026-11-21: Safari and Chrome only for now):
 *   chrome  system Google Chrome via Playwright (channel "chrome", headed so
 *           WebGPU is available), a new temporary profile per run.
 *   safari  the installed Safari, pages opened with `open -a Safari` (results
 *           come back through the bench server; see runSafari for why not
 *           WebDriver). Tabs stay open; close them afterwards. Keep Safari in
 *           front during the run.
 *
 * Phase: 10 (T64); T31. Run (from training/js, on AC power):
 *   node bench_browsers.mjs [--browsers chrome,safari] [--models m1,m2] [--spike] [--runs 10]
 *     [--single-thread]   no COOP/COEP → one WASM thread (use with --variants int8)
 *   node bench_browsers.mjs --serve --label vm-chrome [--runs 10]
 *                       serve only, for a browser on another machine (T67; see serve())
 *
 * Dependencies:
 *   Node: @playwright/test (repo root devDependency, system Chrome), vite, js-yaml.
 *   Reads: ../configs/eval.yaml (benchmark), data/onnx/<model>/<run>/parity.json
 *          (shipped variants), data/eval/<model>/phase7_biaffine.json.
 *   Writes: bench-page/sample.txt, data/bench/{phase10,spike}_<browsers>.json
 *           (js/bench_report.mjs builds ../reports/benchmark.md from them).
 *
 * Status: implemented (Phase 10, T31).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as yaml from "js-yaml";
import { createServer } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");
const REPO = resolve(TRAINING, "..");
const cfg = yaml.load(readFileSync(join(TRAINING, "configs", "eval.yaml"), "utf8")).benchmark;
const { values } = parseArgs({
  options: {
    browsers: { type: "string", default: cfg.browsers.join(",") },
    models: { type: "string" },
    variants: { type: "string", default: cfg.variants.join(",") },
    runs: { type: "string", default: String(cfg.runs) },
    spike: { type: "boolean", default: false },
    "skip-bench": { type: "boolean", default: false },
    "single-thread": { type: "boolean", default: false },
    timeout: { type: "string" },
    serve: { type: "boolean", default: false },
    label: { type: "string", default: "vm" },
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -- sample text ---------------------------------------------------------------------------

function writeSample() {
  const texts = readFileSync(join(TRAINING, cfg.sample_source), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("# text = "))
    .map((l) => l.slice(9).trim());
  let out = "";
  for (const t of texts) {
    const next = out ? `${out} ${t}` : t;
    if (next.length > cfg.sample_chars) break;
    out = next;
  }
  writeFileSync(join(HERE, "bench-page", "sample.txt"), out);
  return out.length;
}

// -- offered models ------------------------------------------------------------------------

function offeredModels() {
  const all = ["distilbert_base_cased", "deberta_v3_xsmall", "bert_base_cased", "modernbert_base"];
  const out = [];
  for (const m of all) {
    try {
      const run = JSON.parse(readFileSync(join(TRAINING, "data", "eval", m, "phase7_biaffine.json"), "utf8")).selected_run;
      const parity = JSON.parse(readFileSync(join(TRAINING, "data", "onnx", m, run, "parity.json"), "utf8"));
      const bytes = parity.bytes;
      if (parity.shipped_variants.length) out.push({ model: m, run, variants: parity.shipped_variants, bytes });
    } catch {
      // not exported or not offered
    }
  }
  return out;
}

// -- memory sampling -----------------------------------------------------------------------

function processTable() {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss=,args="], { encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
      return m ? { pid: +m[1], ppid: +m[2], rssKb: +m[3], args: m[4] } : null;
    })
    .filter(Boolean);
}

/** Total RSS (MB) of the processes selected by `select` (whole process table → subset). */
function rssMb(select) {
  return select(processTable()).reduce((s, p) => s + p.rssKb, 0) / 1024;
}

/** Chrome: the browser process started with our profile dir and all its descendants. */
const chromeSelector = (profile) => (table) => {
  const roots = table.filter((p) => p.args.includes(profile) && /Google Chrome(?! Helper)/.test(p.args));
  const ids = new Set(roots.map((p) => p.pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of table) if (!ids.has(p.pid) && ids.has(p.ppid)) (ids.add(p.pid), (grew = true));
  }
  return table.filter((p) => ids.has(p.pid));
};

/** Safari: the Safari app and WebKit's content, GPU, and networking processes (XPC services). */
const safariSelector = () => (table) =>
  table.filter((p) => /\/Safari\.app\/Contents\/MacOS\/Safari\b|com\.apple\.WebKit\.(WebContent|GPU|Networking)/.test(p.args));

class Sampler {
  constructor(select) {
    this.select = select;
    this.samples = [];
  }
  start() {
    this.timer = setInterval(() => {
      try {
        this.samples.push({ t: Date.now(), mb: rssMb(this.select) });
      } catch {
        // process table unavailable for one tick
      }
    }, cfg.memory_sample_ms);
  }
  stop() {
    clearInterval(this.timer);
  }
  peakBetween(t0, t1) {
    const xs = this.samples.filter((s) => s.t >= t0 && s.t <= t1).map((s) => s.mb);
    return xs.length ? Math.max(...xs) : null;
  }
}

// -- browsers ------------------------------------------------------------------------------

/** Open each URL in turn in one fresh Chrome profile (the model cache persists between them). */
async function runChrome(urls) {
  const require = createRequire(join(REPO, "package.json"));
  const { chromium } = require("@playwright/test");
  const profile = mkdtempSync(join(tmpdir(), "enparse-chrome-"));
  const ctx = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: false });
  const select = chromeSelector(profile);
  const outs = [];
  try {
    const page = await ctx.newPage();
    for (const url of urls) {
      await page.goto("about:blank");
      await sleep(3000);
      const baseline = rssMb(select);
      const sampler = new Sampler(select);
      sampler.start();
      try {
        await page.goto(url);
        await page.waitForFunction(() => document.title === "DONE" || document.title === "ERROR", null, {
          timeout: cfg.run_timeout_seconds * 1000,
        });
        outs.push({ result: await page.evaluate(() => window.__benchResult), baseline, sampler });
      } finally {
        sampler.stop();
      }
    }
    return outs;
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/**
 * Memory: new WebContent processes (this tab) + GPU and networking processes, minus their idle
 * baseline; the Safari UI process and other tabs are excluded.
 * Safari: open each URL with macOS `open -a Safari` (the page runs by itself and posts its
 * result, tagged with a token, to the bench server). WebDriver (safaridriver) would allow
 * closing tabs and isolated sessions, but its sessions time out on this machine even with
 * remote automation allowed, so it is not used. Tabs stay open afterwards (idle; workers
 * disposed); the model cache is Safari's own cache for this origin, cleared by the cold page.
 */
async function runSafari(urls) {
  const select = safariSelector();
  const outs = [];
  for (const url of urls) {
    await sleep(3000);
    // Only this run's tab: WebContent processes that did not exist before it opened, plus the
    // shared GPU and networking processes (their growth over the idle baseline).
    const before = new Set(processTable().filter((p) => /com\.apple\.WebKit\.WebContent/.test(p.args)).map((p) => p.pid));
    const runSelect = (table) =>
      select(table).filter((p) => !/com\.apple\.WebKit\.WebContent/.test(p.args) || !before.has(p.pid));
    const shared = (table) => select(table).filter((p) => !/com\.apple\.WebKit\.WebContent|\/Safari\.app\/Contents\/MacOS\/Safari\b/.test(p.args));
    const baseline = rssMb(shared);
    const sampler = new Sampler((table) => runSelect(table).filter((p) => !/\/Safari\.app\/Contents\/MacOS\/Safari\b/.test(p.args)));
    const token = new URL(url).searchParams.get("token");
    sampler.start();
    try {
      execFileSync("open", ["-a", "Safari", url]);
      const deadline = Date.now() + cfg.run_timeout_seconds * 1000;
      let result = null;
      while (!result && Date.now() < deadline) {
        await sleep(1000);
        result = readResults().find((r) => r.token === token) ?? null;
      }
      if (!result) throw new Error("timed out");
      outs.push({ result, baseline, sampler });
    } finally {
      sampler.stop();
    }
  }
  return outs;
}

const RESULTS = join(TRAINING, "data", "bench", "results.jsonl");
function readResults() {
  try {
    return readFileSync(RESULTS, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// -- main ----------------------------------------------------------------------------------

function phasePeaks(result, baseline, sampler) {
  const at = (name) => result.marks?.find((m) => m.name === name)?.t;
  const span = (a, b) => {
    const t0 = at(a);
    const t1 = at(b);
    if (!t0 || !t1) return null;
    const peak = sampler.peakBetween(t0 - cfg.memory_sample_ms, t1 + cfg.memory_sample_ms);
    return peak === null ? null : Math.round(peak - baseline);
  };
  const overall = sampler.samples.length ? Math.round(Math.max(...sampler.samples.map((s) => s.mb)) - baseline) : null;
  return {
    baseline_mb: Math.round(baseline),
    peak_delta_mb: overall,
    cold_peak_mb: span("cold_load_start", "cold_parse_end"),
    warm_peak_mb: span("warm_load_start", "parse_end"),
    download_hash_peak_mb: span("download_start", "download_end"),
    load_peak_mb: span("load_start", "load_end"),
  };
}

/**
 * --serve (T67): keep the bench server running for a browser on another machine (reached as
 * localhost through an SSH tunnel). The client opens /?mode=suite&label=<label>; its memory
 * sampler (bench-page/vm-sampler.ps1) posts to /__bench/memory. Ends when the suite reports
 * "suite done <label>" (or on Ctrl+C) and writes data/bench/phase10_<label>.json.
 */
async function serve() {
  const label = values.label;
  const bench = join(TRAINING, "data", "bench");
  const startedAt = Date.now();
  const server = await createServer({ configFile: join(HERE, "bench-page", "vite.config.mjs"), logLevel: "warn" });
  await server.listen(cfg.port);
  writeSample();
  console.log(`bench server on http://localhost:${cfg.port}/ (label "${label}")`);
  console.log(`client: open http://localhost:${cfg.port}/?mode=suite&label=${label}&runs=${values.runs}`);
  const readJsonl = (f) => {
    try {
      return readFileSync(join(bench, f), "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  const progressStart = readJsonl("progress.jsonl").length; // ignore earlier suites
  const done = () => readJsonl("progress.jsonl").slice(progressStart).some((p) => p.step === `suite done ${label}`);
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  let seen = 0;
  while (!stop && !done()) {
    await sleep(2000);
    const mine = readResults().filter((r) => r.token?.startsWith(`${label}-`) && Date.parse(r.received_at) >= startedAt);
    for (const r of mine.slice(seen)) {
      console.log(
        `  ${r.model} ${r.variant} ${r.phase}: ${r.ok ? (r.phase === "warm" ? `parse median ${Math.round(r.parse_median_ms)} ms` : `cold load ${Math.round(r.cold_load_ms)} ms`) : `ERROR ${String(r.error).slice(0, 200)}`}`,
      );
    }
    seen = mine.length;
  }
  await server.close();
  const samples = readJsonl("memory.jsonl");
  const results = readResults()
    .filter((r) => r.token?.startsWith(`${label}-`) && Date.parse(r.received_at) >= startedAt)
    .map((r) => {
      // Baseline: lowest sample in the suite's idle pause before the page started (client clock).
      const before = samples.filter((x) => x.t >= r.started - 5000 && x.t <= r.started).map((x) => x.mb);
      const baseline = before.length ? Math.min(...before) : null;
      const sampler = { samples, peakBetween: (a, b) => {
        const xs = samples.filter((x) => x.t >= a && x.t <= b).map((x) => x.mb);
        return xs.length ? Math.max(...xs) : null;
      } };
      // Page window in the client clock: from page start to its last mark.
      const end = Math.max(r.started, ...(r.marks ?? []).map((m) => m.t)) + 1000;
      const memory =
        baseline === null ? null : phasePeaks(r, baseline, { ...sampler, samples: samples.filter((x) => x.t >= r.started && x.t <= end) });
      return { browser: label, ...r, memory };
    });
  const out = { generated_at: new Date().toISOString(), config: cfg, label, sample_chars: results[0]?.sample_chars ?? null, models: offeredModels(), results };
  mkdirSync(bench, { recursive: true });
  writeFileSync(join(bench, `phase10_${label}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`-> data/bench/phase10_${label}.json (${results.length} results; ${samples.length ? "with" : "no"} memory samples)`);
}

async function main() {
  if (values.serve) return serve();
  if (values.timeout) cfg.run_timeout_seconds = Number(values.timeout);
  const chars = writeSample();
  const models = offeredModels().filter((m) => !values.models || values.models.split(",").includes(m.model));
  const browsers = values.browsers.split(",");
  const variants = values.variants.split(",");
  console.log(`sample ${chars} chars; models ${models.map((m) => m.model).join(", ")}; browsers ${browsers.join(", ")}`);
  if (values["single-thread"]) process.env.BENCH_ISOLATION = "0";
  const server = await createServer({ configFile: join(HERE, "bench-page", "vite.config.mjs"), logLevel: "warn" });
  // Single-threaded runs use the next port: a separate origin, so the browser cannot reuse
  // cached responses that carry the isolation headers.
  const port = cfg.port + (values["single-thread"] ? 1 : 0);
  await server.listen(port);
  const base = `http://localhost:${port}/`;
  const results = [];
  /** One browser session: spike, or a bench pair (cold page, then warm page). */
  const runOne = async (browser, query) => {
    const tag = `${browser}-${query.mode}-${query.model}-${query.variant}-${Date.now()}`;
    const queries = (query.mode === "spike" ? [query] : [{ ...query, phase: "cold" }, { ...query, phase: "warm" }]).map(
      (q, i) => ({ ...q, token: `${tag}-${i}` }),
    );
    const urls = queries.map((q) => `${base}?${new URLSearchParams(q)}`);
    const started = Date.now();
    try {
      const outs = browser === "chrome" ? await runChrome(urls) : await runSafari(urls);
      const rows = outs.map(({ result, baseline, sampler }) => ({
        browser,
        single_thread: values["single-thread"],
        ...result,
        memory: phasePeaks(result, baseline, sampler),
      }));
      results.push(...rows);
      const bad = rows.find((r) => !r.ok);
      let msg;
      if (bad) msg = `ERROR ${bad.error.slice(0, 300)}`;
      else if (query.mode === "spike") {
        const r = rows[0];
        msg = `refetched ${JSON.stringify(r.model_files_refetched)}, hash ${JSON.stringify(r.files.map((f) => [f.file, Math.round(f.hash_ms)]).filter(([, ms]) => ms > 5))}, download+hash peak +${r.memory.download_hash_peak_mb} MB`;
      } else {
        const [c, w] = rows;
        msg = `backend ${w.backend}, cold ${Math.round(c.cold_load_ms)} ms (+${c.memory.cold_peak_mb} MB), warm ${Math.round(w.warm_load_ms)} ms, parse median ${Math.round(w.parse_median_ms)} ms, warm peak +${w.memory.warm_peak_mb} MB`;
      }
      console.log(`${browser} ${query.mode} ${query.model} ${query.variant}: ${msg} [${Math.round((Date.now() - started) / 1000)} s]`);
    } catch (e) {
      results.push({ browser, ok: false, mode: query.mode, model: query.model, variant: query.variant, error: String(e) });
      console.log(`${browser} ${query.mode} ${query.model} ${query.variant}: FAILED ${String(e).slice(0, 300)}`);
    }
  };
  try {
    for (const browser of browsers) {
      for (const m of models) {
        if (values.spike) {
          const v = m.variants.includes("fp16") ? "fp16" : m.variants[0];
          await runOne(browser, { mode: "spike", model: m.model, variant: v });
        }
        if (values["skip-bench"]) continue;
        for (const v of variants.filter((x) => m.variants.includes(x))) {
          await runOne(browser, { mode: "bench", model: m.model, variant: v, runs: values.runs });
        }
      }
    }
  } finally {
    await server.close();
  }
  const outDir = join(TRAINING, "data", "bench");
  mkdirSync(outDir, { recursive: true });
  const out = { generated_at: new Date().toISOString(), config: cfg, sample_chars: chars, models, results };
  const kind = values["skip-bench"] ? "spike" : values["single-thread"] ? "phase10st" : "phase10";
  const name = `${kind}_${browsers.join("_")}.json`;
  writeFileSync(join(outDir, name), JSON.stringify(out, null, 2) + "\n");
  console.log(`-> data/bench/${name}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
