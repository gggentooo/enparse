/**
 * training/js/gating_eval.mjs — Phase 8 bracket gating: threshold, shown precision, coverage
 *
 * Description:
 *   Reads a biaffine run's dev and test predictions (scripts/evaluate.py →
 *   <split>_predictions.jsonl), applies the arc temperature, decodes trees with
 *   the app's treeDecoder.ts (decodeArcTree: MST and head probabilities),
 *   builds nested phrases, and gates them with gatePhrases at each threshold
 *   (lib/gating.mjs). Picks the lowest threshold whose dev precision of shown
 *   multi-word brackets (labeled) is ≥ --min-precision, so coverage is as high
 *   as possible; reports test precision, coverage, and recall at every
 *   threshold. Prints one JSON line (read by scripts/calibrate.py) and writes
 *   gating.json next to the predictions.
 *
 * Phase: 8 (T58). Run (from training/js):
 *   npx tsx gating_eval.mjs --model <m> --run <run> --arc-temperature 1.1 --min-precision 0.95
 *
 * Dependencies:
 *   Node: tsx, js-yaml; ./lib/gating.mjs, ./lib/nested.mjs; app code:
 *         src/modules/parser/treeDecoder.ts.
 *   Reads: ../configs/data.yaml (paths.eval); <split>_predictions.jsonl (dev, test).
 *   Writes: data/eval/<model>/<run>/gating.json.
 *
 * Status: implemented (T58).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as yaml from "js-yaml";
import { buildPhrases, decodeArcTree, gatePhrases, phraseSpans } from "../../src/modules/parser/treeDecoder.ts";
import { THRESHOLDS, chooseThreshold, gatingCurve } from "./lib/gating.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");
const { values } = parseArgs({
  options: {
    model: { type: "string" },
    run: { type: "string" },
    "arc-temperature": { type: "string", default: "1" },
    "min-precision": { type: "string", default: "0.95" },
  },
});
const cfg = yaml.load(readFileSync(join(TRAINING, "configs", "data.yaml"), "utf8"));
const dir = join(TRAINING, cfg.paths.eval, values.model, values.run);
const read = (split) =>
  readFileSync(join(dir, `${split}_predictions.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const decoder = { decodeArcTree, buildPhrases, gatePhrases, phraseSpans };
const t = Number(values["arc-temperature"]);
const dev = gatingCurve(read("dev"), decoder, t, THRESHOLDS);
const test = gatingCurve(read("test"), decoder, t, THRESHOLDS);
const threshold = chooseThreshold(dev, Number(values["min-precision"]));
const at = (curve) => curve.find((r) => r.threshold === threshold);
const result = {
  threshold,
  arc_temperature: t,
  min_precision: Number(values["min-precision"]),
  met_on_dev: at(dev).precision !== null && at(dev).precision >= Number(values["min-precision"]),
  dev: at(dev),
  test: at(test),
  curve: THRESHOLDS.map((th, i) => ({ threshold: th, dev: dev[i], test: test[i] })),
};
writeFileSync(join(dir, "gating.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
