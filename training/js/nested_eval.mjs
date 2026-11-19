/**
 * training/js/nested_eval.mjs — nested-phrase F1 and repaired-tree scores for one run
 *
 * Description:
 *   Reads data/eval/<model>/<run>/<split>_predictions.jsonl (scripts/evaluate.py)
 *   and scores it with the app's treeDecoder.ts (imported through tsx, so
 *   training and the app share one implementation). Writes <split>_nested.json.
 *
 * Phase: 7 task 4 (nested-phrase F1, tree repair share).
 * Run with (from training/js): npx tsx nested_eval.mjs --model <m> --run <run> --split test
 *
 * Dependencies:
 *   Node: tsx, js-yaml; ./lib/nested.mjs; app code:
 *         src/modules/parser/treeDecoder.ts.
 *   Reads: ../configs/data.yaml (paths.eval); <split>_predictions.jsonl.
 *   Writes: <split>_nested.json next to the predictions.
 *
 * Status: implemented (Phase 7).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as yaml from "js-yaml";
import { buildPhrases, decodeTree, phraseSpans } from "../../src/modules/parser/treeDecoder.ts";
import { scoreNested } from "./lib/nested.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");

const { values } = parseArgs({
  options: { model: { type: "string" }, run: { type: "string" }, split: { type: "string", default: "test" } },
});
const cfg = yaml.load(readFileSync(join(TRAINING, "configs", "data.yaml"), "utf8"));
const dir = join(TRAINING, cfg.paths.eval, values.model, values.run);
const records = readFileSync(join(dir, `${values.split}_predictions.jsonl`), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const result = scoreNested(records, { decodeTree, buildPhrases, phraseSpans });
writeFileSync(join(dir, `${values.split}_nested.json`), JSON.stringify(result, null, 2) + "\n");
console.log(
  `${values.model}/${values.run} ${values.split}: nested F1 ${result.nested_f1.toFixed(4)} ` +
    `(unlabeled ${result.nested_unlabeled_f1.toFixed(4)}), tree UAS ${result.tree_uas.toFixed(4)}, ` +
    `LAS ${result.tree_las.toFixed(4)}, repaired ${(100 * result.repaired_share).toFixed(1)}% of ${result.sentences} sentences`,
);
