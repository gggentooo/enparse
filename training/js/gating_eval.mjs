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
 *   threshold. Then the role gate (T59): at that bracket threshold, labels
 *   phrases with phraseLabeler.ts (badges on collapsed brackets) and picks the
 *   lowest role threshold (relation × head probability, calibrated with
 *   --rel-temperature) whose dev role precision is ≥ --min-precision.
 *   Prints one JSON line (read by scripts/calibrate.py) and writes
 *   gating.json next to the predictions.
 *
 * Phase: 8 (T58). Run (from training/js):
 *   npx tsx gating_eval.mjs --model <m> --run <run> --arc-temperature 1.1 --rel-temperature 1.2 --min-precision 0.95
 *
 * Dependencies:
 *   Node: tsx, js-yaml; ./lib/gating.mjs; app code: src/modules/parser/treeDecoder.ts,
 *         src/modules/parser/phraseLabeler.ts.
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
import { labelPhrases } from "../../src/modules/parser/phraseLabeler.ts";
import { buildPhrases, decodeArcTree, gatePhrases, phraseSpans } from "../../src/modules/parser/treeDecoder.ts";
import { ROLE_THRESHOLDS, THRESHOLDS, chooseThreshold, gatingCurve, roleCurve } from "./lib/gating.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAINING = resolve(HERE, "..");
const { values } = parseArgs({
  options: {
    model: { type: "string" },
    run: { type: "string" },
    "arc-temperature": { type: "string", default: "1" },
    "rel-temperature": { type: "string", default: "1" },
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

const decoder = { decodeArcTree, buildPhrases, gatePhrases, phraseSpans, labelPhrases };
const t = Number(values["arc-temperature"]);
const relT = Number(values["rel-temperature"]);
const minP = Number(values["min-precision"]);
const devRecords = read("dev");
const testRecords = read("test");
const dev = gatingCurve(devRecords, decoder, t, THRESHOLDS);
const test = gatingCurve(testRecords, decoder, t, THRESHOLDS);
const threshold = chooseThreshold(dev, minP);
const at = (curve, th = threshold) => curve.find((r) => r.threshold === th);
// Role gate (T59): at the chosen bracket threshold, the lowest role threshold with dev role precision ≥ minP.
const roleDev = roleCurve(devRecords, decoder, t, relT, threshold, ROLE_THRESHOLDS);
const roleTest = roleCurve(testRecords, decoder, t, relT, threshold, ROLE_THRESHOLDS);
const roleThreshold = chooseThreshold(roleDev, minP);
const result = {
  threshold,
  arc_temperature: t,
  min_precision: Number(values["min-precision"]),
  met_on_dev: at(dev).precision !== null && at(dev).precision >= Number(values["min-precision"]),
  dev: at(dev),
  test: at(test),
  curve: THRESHOLDS.map((th, i) => ({ threshold: th, dev: dev[i], test: test[i] })),
  role: {
    threshold: roleThreshold,
    rel_temperature: relT,
    met_on_dev: at(roleDev, roleThreshold).precision !== null && at(roleDev, roleThreshold).precision >= minP,
    dev: at(roleDev, roleThreshold),
    test: at(roleTest, roleThreshold),
    curve: ROLE_THRESHOLDS.map((th, i) => ({ threshold: th, dev: roleDev[i], test: roleTest[i] })),
  },
};
writeFileSync(join(dir, "gating.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
