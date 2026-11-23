/**
 * training/js/projective_eval.mjs — non-crossing (projective) decoding vs MST: accuracy comparison (T82)
 *
 * Description:
 *   For a biaffine run's stored dev and test predictions, decodes every
 *   sentence twice from the same arc scores — maximum spanning tree
 *   (Chu-Liu-Edmonds, crossing arcs allowed) and the best projective tree
 *   (Eisner; src/modules/parser/treeDecoder.ts → projectiveTree) — and reports
 *   UAS and LAS (all words and without punctuation), sentences whose tree
 *   differs, and gold / predicted sentences with crossing arcs. Decides
 *   whether the app decodes projectively (owner, 2026-11-23: adopt only if
 *   accuracy does not drop).
 *
 * Run (from training/js): npx tsx projective_eval.mjs --model <m> --run <run>
 * Reads: ../configs/data.yaml (paths.eval); <split>_predictions.jsonl. Writes: nothing (prints JSON).
 *
 * Status: implemented (T82).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as yaml from "js-yaml";
import { headLogProbs, maxSpanningTree, projectiveTree } from "../../src/modules/parser/treeDecoder.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");
const { values } = parseArgs({ options: { model: { type: "string" }, run: { type: "string" } } });
const cfg = yaml.load(readFileSync(join(TRAINING, "configs", "data.yaml"), "utf8"));
const dir = join(TRAINING, cfg.paths.eval, values.model, values.run);
const base = (r) => r.split(":")[0];

/** True if a 1-based head array (0 = root) has crossing arcs. */
function crossing(heads) {
  const arcs = heads.map((h, d) => [Math.min(h, d + 1), Math.max(h, d + 1)]).filter(([a]) => a > 0);
  return arcs.some(([a, b]) => arcs.some(([c, d]) => a < c && c < b && b < d));
}

const out = {};
for (const split of ["dev", "test"]) {
  const records = readFileSync(join(dir, `${split}_predictions.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const acc = { mst: { uas: 0, las: 0, uasNp: 0, lasNp: 0 }, projective: { uas: 0, las: 0, uasNp: 0, lasNp: 0 } };
  let words = 0;
  let np = 0;
  let differ = 0;
  let goldCrossing = 0;
  let mstCrossing = 0;
  for (const r of records) {
    const n = r.words.length;
    const score = [new Array(n + 1).fill(-Infinity), ...headLogProbs(r.arc_scores)];
    const trees = { mst: maxSpanningTree(score).slice(1) };
    trees.projective = (projectiveTree(score) ?? [-1, ...trees.mst]).slice(1);
    if (trees.mst.some((h, i) => h !== trees.projective[i])) differ++;
    if (crossing(r.gold_head)) goldCrossing++;
    if (crossing(trees.mst)) mstCrossing++;
    for (let i = 0; i < n; i++) {
      const punct = r.gold_upos[i] === "PUNCT";
      words++;
      if (!punct) np++;
      for (const [name, heads] of Object.entries(trees)) {
        if (heads[i] !== r.gold_head[i]) continue;
        const rel = heads[i] === 0 ? "root" : base(r.rel_candidates[i].find((c) => c.relation !== "root")?.relation ?? "dep");
        acc[name].uas++;
        if (!punct) acc[name].uasNp++;
        if (rel === r.gold_rel[i]) {
          acc[name].las++;
          if (!punct) acc[name].lasNp++;
        }
      }
    }
  }
  const pct = (a, b) => Number(((100 * a) / b).toFixed(3));
  out[split] = { sentences: records.length, treesDiffer: differ, goldCrossing, mstCrossing };
  for (const name of ["mst", "projective"])
    out[split][name] = { uas: pct(acc[name].uas, words), las: pct(acc[name].las, words), uas_no_punct: pct(acc[name].uasNp, np), las_no_punct: pct(acc[name].lasNp, np) };
}
console.log(JSON.stringify(out, null, 1));
