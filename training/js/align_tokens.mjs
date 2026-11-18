/**
 * training/js/align_tokens.mjs — align wink-nlp runtime words with UD words
 *
 * Description:
 *   At runtime, wink-nlp splits text into words before the model runs, so
 *   training words must match runtime words. For each EWT sentence this
 *   script runs the app's preprocess() and tokenize(), aligns the runtime
 *   words to UD words, transfers UPOS, chunk, head, and relation labels, and
 *   writes the aligned sentences for prepare_data.py.
 *
 * Phase: 3 — Tokenization alignment with runtime.
 * Run with (from training/js): npm run align   (= tsx align_tokens.mjs)
 *
 * Steps (plan-training.md → Phase 3 → Decisions and tasks):
 *   1. Read chunked sentences (derive_chunks.py output) with `# text =`.
 *   2. Run the app's preprocess() (src/modules/input) and drop sentences with
 *      removals; tokenize() the clean text with src/modules/parser/winkBackend.ts
 *      (run via tsx; one implementation, no copied settings).
 *   3. Align by character offsets (UD forms normalized with normalizeChars());
 *      multiword tokens use their parts when the parts spell the surface form.
 *   4. Apply mapping rules (merge or split) for mismatches and remap heads
 *      (lib/align.mjs); repair BIO; check every sentence is a valid tree.
 *   5. Measure agreement per split (target in configs/data.yaml →
 *      alignment.min_agreement); write mismatch categories, counts, and
 *      examples to reports/alignment.md.
 *   6. Write aligned sentences as JSON Lines: data/processed/aligned/<split>.jsonl.
 *
 * Output record (one per UD sentence; training keeps UD sentence boundaries):
 *   { doc_id, sent_id, text, words: [{ form, start, end, upos, chunk, head,
 *     deprel, reviewed, wink_sent, ud, rule }] }
 *   head: 1-based index into words (0 = root). deprel: full UD relation
 *   (Phase 4 reduces it to the base relation). wink_sent: runtime sentence
 *   index within the UD sentence. ud: UD word ids covered. rule: exact,
 *   merge:hyphen, merge:glued, merge:other, split-first, split-piece, complex.
 *
 * Dependencies:
 *   Node:   tsx, js-yaml; ./lib/conllu.mjs, ./lib/align.mjs; app code:
 *           src/modules/input/index.ts, src/modules/parser/winkBackend.ts
 *           (wink-nlp resolved from root node_modules).
 *   Reads:  ../configs/data.yaml (paths.chunked, paths.aligned, ud_ewt.files,
 *           alignment.*); data/processed/chunked/.
 *   Writes: data/processed/aligned/ (git-ignored); ../reports/alignment.md.
 *   Consumed by: scripts/prepare_data.py, js/evaluate_baselines.mjs.
 *
 * Status: implemented (Phase 3).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { normalizeChars, preprocess } from "../../src/modules/input/index.ts";
import { tokenize } from "../../src/modules/parser/winkBackend.ts";
import { EXCLUDED_CATEGORIES, alignSentence, bioProblem, locateUdWords, treeProblem } from "./lib/align.mjs";
import { parseConllu } from "./lib/conllu.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");
const REPO = resolve(TRAINING, "..");
const NO_LIMIT = Number.MAX_SAFE_INTEGER; // EWT sentences are not user input

function versions() {
  const lock = JSON.parse(readFileSync(join(HERE, "package-lock.json"), "utf8"));
  const v = (name) => lock.packages[`node_modules/${name}`]?.version ?? "?";
  return { wink: v("wink-nlp"), model: v("wink-eng-lite-web-model") };
}

function alignSplit(sentences, maxExamples) {
  const stats = {
    sentences: sentences.length,
    droppedPreprocess: 0,
    droppedError: 0,
    written: 0,
    udWords: 0,
    runtimeWords: 0,
    categories: new Map(),
    examples: new Map(),
    rules: new Map(),
    multiExitMerges: 0,
    chunkChanges: 0,
    invalidTrees: 0,
    winkSplitSentences: 0,
    crossSentenceHeads: 0,
    errors: [],
  };
  const records = [];
  const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

  for (const s of sentences) {
    const pre = preprocess(s.text, NO_LIMIT);
    if (pre.hasRemovals) {
      stats.droppedPreprocess++;
      continue;
    }
    let result;
    let rt;
    try {
      const spans = locateUdWords(pre.text, s, normalizeChars);
      rt = tokenize(pre.text).flatMap((sent, i) => sent.words.map((w) => ({ ...w, sent: i })));
      result = alignSentence(s.words, spans, rt);
    } catch (e) {
      stats.droppedError++;
      stats.errors.push(`${s.sentId}: ${e.message}`);
      continue;
    }
    const problem =
      treeProblem(result.words.map((w) => w.head)) ??
      bioProblem(result.words.map((w) => w.chunk)) ??
      result.words.map((w) => (pre.text.slice(w.start, w.end) === w.form ? null : `offsets of ${w.form}`)).find(Boolean) ??
      null;
    if (problem) {
      stats.invalidTrees++;
      stats.errors.push(`${s.sentId}: invalid output (${problem})`);
      continue;
    }

    stats.written++;
    stats.udWords += s.words.length;
    stats.runtimeWords += result.words.length;
    stats.multiExitMerges += result.multiExitMerges;
    stats.chunkChanges += result.chunkChanges;
    if (new Set(rt.map((w) => w.sent)).size > 1) stats.winkSplitSentences++;
    for (const w of result.words) {
      bump(stats.rules, w.rule);
      if (w.head !== 0 && result.words[w.head - 1].wink_sent !== w.wink_sent) stats.crossSentenceHeads++;
    }
    result.udCategory.forEach((cat, u) => {
      bump(stats.categories, cat);
      if (cat === "exact") return;
      const ex = stats.examples.get(cat) ?? new Map();
      const covering = result.words.filter((w) => w.ud.includes(s.words[u].id)).map((w) => w.form);
      const key = `${s.words[u].form} → ${covering.join(" | ")}`;
      ex.set(key, (ex.get(key) ?? 0) + 1);
      stats.examples.set(cat, ex);
    });
    records.push({ doc_id: s.docId, sent_id: s.sentId, text: pre.text, words: result.words });
  }
  const counted = [...stats.categories].filter(([c]) => !EXCLUDED_CATEGORIES.has(c)).reduce((a, [, n]) => a + n, 0);
  stats.counted = counted;
  stats.exact = stats.categories.get("exact") ?? 0;
  stats.agreement = counted > 0 ? stats.exact / counted : 0;
  return { records, stats };
}

const CATEGORY_TEXT = {
  "merge:hyphen": ["Hyphenated word kept whole (owner rule)", "Merge; not counted"],
  "merge:glued": ["UD splits inside one written token", "Merge; not counted"],
  "merge:other": ["Merge with an apostrophe", "Merge"],
  split: ["Runtime splits a UD word", "Split"],
  complex: ["Partial overlap (merge and split)", "Merge + split"],
};

const pct = (x) => `${(100 * x).toFixed(2)}%`;
const num = (n) => n.toLocaleString("en-US");

function writeReport(path, cfg, results, target, maxExamples) {
  const v = versions();
  const ewt = cfg.ud_ewt;
  const L = [];
  L.push("# Alignment report (Phase 3)", "");
  L.push(
    `Generated by \`js/align_tokens.mjs\` from UD English EWT ${ewt.release_tag} (commit \`${ewt.commit.slice(0, 12)}\`) ` +
      `and the app's \`preprocess()\` + \`tokenize()\` (wink-nlp ${v.wink}, wink-eng-lite-web-model ${v.model}). ` +
      "Metric and rules: `dev_meta/plan-training.md` → Phase 3 → *Decisions*.",
    "",
  );
  L.push("## Agreement", "");
  L.push(`Target: ≥ ${pct(target)} on each split (counted UD words that map to exactly one runtime word).`, "");
  L.push("| Split | Sentences | Written | Dropped (preprocess) | Dropped (error) | UD words | Counted | Exact | Agreement | All-word agreement | Result |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [split, { stats }] of results) {
    const ok = stats.agreement >= target && stats.invalidTrees === 0 && stats.droppedError === 0;
    L.push(
      `| ${split} | ${num(stats.sentences)} | ${num(stats.written)} | ${stats.droppedPreprocess} | ${stats.droppedError} | ` +
        `${num(stats.udWords)} | ${num(stats.counted)} | ${num(stats.exact)} | **${pct(stats.agreement)}** | ` +
        `${pct(stats.exact / stats.udWords)} | ${ok ? "Pass" : "**Fail**"} |`,
    );
  }
  L.push("", "## Mismatches (UD words)", "");
  L.push("| Type | Rule | " + [...results.keys()].join(" | ") + " |");
  L.push("|---|---|" + [...results.keys()].map(() => "---").join("|") + "|");
  for (const [cat, [label, rule]] of Object.entries(CATEGORY_TEXT)) {
    L.push(`| ${label} | ${rule} | ` + [...results.values()].map(({ stats }) => num(stats.categories.get(cat) ?? 0)).join(" | ") + " |");
  }
  L.push("", "Examples (train; `UD word → runtime word(s)`, count):", "");
  const train = results.get("train") ?? [...results.values()][0];
  for (const [cat, [label]] of Object.entries(CATEGORY_TEXT)) {
    const ex = train.stats.examples.get(cat);
    if (!ex) continue;
    const items = [...ex].sort((a, b) => b[1] - a[1]).slice(0, maxExamples).map(([k, n]) => `\`${k}\` (${n})`);
    L.push(`- ${label}: ${items.join(", ")}`);
  }
  L.push("", "## Label transfer and trees", "");
  L.push("| Split | Runtime words | Merged words | Split pieces | Multi-exit merges | Chunk tag changes | Invalid trees | UD sentences split by wink | Heads across wink sentences |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const [split, { stats }] of results) {
    const merged = ["merge:hyphen", "merge:glued", "merge:other"].reduce((a, r) => a + (stats.rules.get(r) ?? 0), 0);
    L.push(
      `| ${split} | ${num(stats.runtimeWords)} | ${num(merged)} | ${num(stats.rules.get("split-piece") ?? 0)} | ` +
        `${stats.multiExitMerges} | ${stats.chunkChanges} | ${stats.invalidTrees} | ${stats.winkSplitSentences} | ${stats.crossSentenceHeads} |`,
    );
  }
  L.push(
    "",
    "- *Multi-exit merges:* a merged word whose UD words attach to more than one word outside it; only the head word's arc is kept.",
    "- *Chunk tag changes:* exactly aligned words whose B-/I- prefix changed because a neighbouring merge or split changed the word sequence (chunks are never joined).",
    "- *Heads across wink sentences:* arcs whose head is in another runtime sentence; at runtime these attach to the sentence root (Phase 7 measures the effect).",
  );
  const errors = [...results].flatMap(([split, { stats }]) => stats.errors.map((e) => `${split} ${e}`));
  L.push("", "## Dropped sentences", "");
  if (errors.length === 0) L.push("None besides preprocessing drops (sentences with non-Latin text, emoji, or control characters).");
  else for (const e of errors) L.push(`- ${e}`);
  L.push("");
  writeFileSync(path, L.join("\n"), "utf8");
}

function main() {
  const cfg = yaml.load(readFileSync(join(TRAINING, "configs", "data.yaml"), "utf8"));
  const inDir = join(TRAINING, cfg.paths.chunked);
  const outDir = join(TRAINING, cfg.paths.aligned);
  const { splits, report, min_agreement: target, report_examples: maxExamples } = cfg.alignment;
  mkdirSync(outDir, { recursive: true });

  const results = new Map();
  for (const split of splits) {
    const file = join(inDir, cfg.ud_ewt.files[split]);
    const sentences = parseConllu(readFileSync(file, "utf8"));
    const { records, stats } = alignSplit(sentences, maxExamples);
    const out = join(outDir, `${split}.jsonl`);
    writeFileSync(out, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    results.set(split, { stats });
    console.log(
      `${split}: ${stats.written}/${stats.sentences} sentences, agreement ${pct(stats.agreement)}, ` +
        `invalid trees ${stats.invalidTrees}, errors ${stats.droppedError} -> ${basename(out)}`,
    );
  }
  const reportPath = join(TRAINING, report);
  writeReport(reportPath, cfg, results, target, maxExamples);
  console.log(`report -> ${reportPath.replace(REPO + "/", "")}`);

  const failed = [...results].filter(([, { stats }]) => stats.agreement < target || stats.invalidTrees > 0 || stats.droppedError > 0);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map(([s]) => s).join(", ")}`);
    process.exit(1);
  }
}

main();
