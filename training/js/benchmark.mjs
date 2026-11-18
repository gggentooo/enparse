/**
 * training/js/benchmark.mjs — Transformers.js load, tokenizer, parity, and speed checks (Node)
 *
 * Description:
 *   Loads an export from export_onnx.py with Transformers.js in Node (CPU,
 *   onnxruntime-node), the same library the app uses in the browser, and
 *   checks it against the PyTorch reference written by the export.
 *
 * Phases: 7 task 0 (smoke test), 9 (parity), 10 (Node speed; browser numbers
 *         come from bench-page/).
 * Run with (from training/js):
 *   npm run benchmark -- --model distilbert_base_cased --run smoke [--mode smoke|parity|speed]
 *   npm run benchmark -- --dir <export folder> [--variants fp32,int8,fp16]
 *
 * Modes:
 *   smoke   1. Tokenizer: encode reference.json sentences word by word
 *              (lib/inference.mjs) with each strategy; one must reproduce
 *              Python's ids exactly (reported per model).
 *           2. Per variant: load; logits width = labels.json labels; word
 *              argmax on the reference sentences and parity_inputs.jsonl vs
 *              PyTorch (agreement per group).
 *           3. Pass: tokenizer match; fp32 agreement ≥ parity.fp32_min_agreement
 *              on all words; int8/fp16 agreement ≥ parity.smoke_min_confident_agreement
 *              on words where PyTorch's top-two logit gap > parity.smoke_margin
 *              (a barely trained model has near-ties everywhere; quantization
 *              quality is judged in Phase 9).
 *   parity  Step 2 on every window in parity_inputs.jsonl; writes
 *           js_predictions_<variant>.jsonl for scripts/evaluate.py (chunk F1
 *           and LAS drops, Phase 9).
 *   speed   Median time per full window and tokens per second per variant.
 *   Each mode writes benchmark_<mode>.json into the export folder and exits
 *   non-zero on failure.
 *
 * Dependencies:
 *   Node:   @huggingface/transformers 4.3.2 (same as the app), js-yaml;
 *           ./lib/inference.mjs.
 *   Reads:  ../configs/data.yaml (paths.onnx), ../configs/eval.yaml (parity);
 *           <export>/labels.json, reference.json, parity_inputs.jsonl, model files.
 *   Writes: <export>/benchmark_<mode>.json, <export>/js_predictions_<variant>.jsonl (parity).
 *
 * Status: implemented (Phase 7 pre-work). Not yet run on a trained candidate.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AutoModelForTokenClassification, AutoTokenizer, Tensor, env } from "@huggingface/transformers";
import * as yaml from "js-yaml";
import { STRATEGIES, agreement, argmaxWords, encodeWords, sameIds } from "./lib/inference.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");
const DTYPES = { fp32: "fp32", int8: "q8", fp16: "fp16" };
const VARIANT_FILES = { fp32: "onnx/model.onnx", int8: "onnx/model_quantized.onnx", fp16: "onnx/model_fp16.onnx" };

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readJsonl = (p) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

function useLocalFolder(dir) {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${dirname(dir)}/`;
  return basename(dir);
}

async function loadTokenizer(dir) {
  return AutoTokenizer.from_pretrained(useLocalFolder(dir));
}

async function loadModel(dir, variant) {
  return AutoModelForTokenClassification.from_pretrained(useLocalFolder(dir), { dtype: DTYPES[variant], device: "cpu" });
}

async function logitsFor(model, ids) {
  const n = ids.length;
  const inputIds = new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, n]);
  const mask = new Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]);
  const out = await model({ input_ids: inputIds, attention_mask: mask });
  const [, t, c] = out.logits.dims;
  return { data: out.logits.data, tokens: t, width: c };
}

function checkTokenizer(tokenizer, reference) {
  const results = {};
  for (const strategy of STRATEGIES) {
    results[strategy] = reference.sentences.map((s) => {
      const { ids, tokenWord } = encodeWords(tokenizer, s.words, reference.max_subwords_per_word, strategy);
      return sameIds(ids, s.input_ids) && sameIds(tokenWord, s.token_word);
    });
  }
  const strategy = STRATEGIES.find((st) => results[st].every(Boolean)) ?? null;
  return { strategy, matches: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.filter(Boolean).length])) };
}

async function predictWindows(model, windows, groups, nLabels) {
  const preds = [];
  let widthOk = true;
  for (const w of windows) {
    const { data, width } = await logitsFor(model, w.input_ids);
    widthOk &&= width === nLabels;
    preds.push(argmaxWords(data, width, w.token_word, groups));
  }
  return { preds, widthOk };
}

const refOf = (w) => ({
  chunk: w.torch_chunk_ids,
  dep: w.torch_dep_ids,
  chunkMargin: w.torch_chunk_margin,
  depMargin: w.torch_dep_margin,
});

async function runVariant(dir, variant, labels, reference, parity, mode, margin) {
  const started = performance.now();
  const model = await loadModel(dir, variant);
  const loadSeconds = (performance.now() - started) / 1000;
  const nLabels = labels.labels.length;
  const result = { variant, file: VARIANT_FILES[variant], load_seconds: +loadSeconds.toFixed(2) };

  if (mode === "speed") {
    const longest = [...parity].sort((a, b) => b.input_ids.length - a.input_ids.length).slice(0, 5);
    const times = [];
    for (let r = 0; r < 3; r++) {
      for (const w of longest) {
        const t0 = performance.now();
        await logitsFor(model, w.input_ids);
        times.push({ ms: performance.now() - t0, tokens: w.input_ids.length });
      }
    }
    times.sort((a, b) => a.ms - b.ms);
    const median = times[Math.floor(times.length / 2)];
    const tokens = times.reduce((s, x) => s + x.tokens, 0);
    const ms = times.reduce((s, x) => s + x.ms, 0);
    Object.assign(result, { median_window_ms: +median.ms.toFixed(1), window_tokens: median.tokens, tokens_per_second: Math.round((tokens / ms) * 1000) });
  } else {
    const ref = await predictWindows(model, reference.sentences, labels.groups, nLabels);
    const par = await predictWindows(model, parity, labels.groups, nLabels);
    result.logits_width_ok = ref.widthOk && par.widthOk;
    result.reference_agreement = agreement(ref.preds.map((js, i) => ({ js, ref: refOf(reference.sentences[i]) })));
    result.parity_agreement = agreement(par.preds.map((js, i) => ({ js, ref: refOf(parity[i]) })));
    const all = [...ref.preds.map((js, i) => ({ js, ref: refOf(reference.sentences[i]) })), ...par.preds.map((js, i) => ({ js, ref: refOf(parity[i]) }))];
    result.confident_agreement = agreement(all, margin);
    if (mode === "parity") {
      const lines = par.preds.map((p) => JSON.stringify({ chunk_ids: p.chunk, dep_ids: p.dep }));
      writeFileSync(join(dir, `js_predictions_${variant}.jsonl`), lines.join("\n") + "\n");
    }
  }
  await model.dispose?.();
  return result;
}

function verdict(mode, tok, variants, limits) {
  const problems = [];
  if (mode === "smoke" && tok.strategy === null) problems.push("no word-encoding strategy reproduces Python's token ids");
  if (mode === "speed") return problems;
  for (const v of variants) {
    if (!v.logits_width_ok) problems.push(`${v.variant}: logits width differs from labels.json`);
    for (const g of ["chunk", "dep"]) {
      const name = g === "chunk" ? "A" : "B";
      if (v.variant === "fp32") {
        const got = Math.min(v.reference_agreement[g], v.parity_agreement[g]);
        if (got < limits.fp32_min_agreement) problems.push(`fp32: group ${name} agreement ${got.toFixed(4)} < ${limits.fp32_min_agreement}`);
      } else if (mode === "smoke") {
        const got = v.confident_agreement[g];
        if (got < limits.smoke_min_confident_agreement)
          problems.push(`${v.variant}: group ${name} agreement on confident words ${got.toFixed(4)} < ${limits.smoke_min_confident_agreement}`);
      }
    }
  }
  return problems;
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string" },
      run: { type: "string" },
      dir: { type: "string" },
      mode: { type: "string", default: "smoke" },
      variants: { type: "string", default: "fp32,int8,fp16" },
    },
  });
  if (!["smoke", "parity", "speed"].includes(values.mode)) throw new Error(`unknown mode ${values.mode}`);
  const dataCfg = yaml.load(readFileSync(join(TRAINING, "configs", "data.yaml"), "utf8"));
  const evalCfg = yaml.load(readFileSync(join(TRAINING, "configs", "eval.yaml"), "utf8"));
  const dir = values.dir ? resolve(values.dir) : join(TRAINING, dataCfg.paths.onnx, values.model ?? "", values.run ?? "");
  if (!existsSync(join(dir, "labels.json"))) throw new Error(`no export found at ${dir}`);

  const labels = readJson(join(dir, "labels.json"));
  const reference = readJson(join(dir, "reference.json"));
  const parity = readJsonl(join(dir, "parity_inputs.jsonl"));
  const tok = checkTokenizer(await loadTokenizer(dir), reference);
  console.log(`tokenizer: strategy ${tok.strategy ?? "NONE"} (matches per strategy: ${JSON.stringify(tok.matches)})`);

  const results = [];
  for (const variant of values.variants.split(",")) {
    if (!existsSync(join(dir, VARIANT_FILES[variant]))) throw new Error(`missing ${VARIANT_FILES[variant]}`);
    const r = await runVariant(dir, variant, labels, reference, parity, values.mode, evalCfg.parity.smoke_margin);
    results.push(r);
    const summary =
      values.mode === "speed"
        ? `median ${r.median_window_ms} ms / ${r.window_tokens}-token window, ${r.tokens_per_second} tokens/s`
        : `agreement A ${r.parity_agreement.chunk.toFixed(4)} / B ${r.parity_agreement.dep.toFixed(4)} ` +
          `(${r.parity_agreement.words} words), reference A ${r.reference_agreement.chunk.toFixed(4)} / B ${r.reference_agreement.dep.toFixed(4)}, ` +
          `confident A ${r.confident_agreement.chunk.toFixed(4)} (${r.confident_agreement.words}) / B ${r.confident_agreement.dep.toFixed(4)} (${r.confident_agreement.dep_words})`;
    console.log(`${variant}: load ${r.load_seconds} s, ${summary}`);
  }
  const problems = verdict(values.mode, tok, results, evalCfg.parity);
  const report = { mode: values.mode, export: dir, tokenizer: tok, variants: results, problems, passed: problems.length === 0 };
  writeFileSync(join(dir, `benchmark_${values.mode}.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(report.passed ? "PASS" : `FAIL:\n- ${problems.join("\n- ")}`);
  if (!report.passed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
