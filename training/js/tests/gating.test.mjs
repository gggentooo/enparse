/**
 * training/js/tests/gating.test.mjs — unit tests for lib/gating.mjs (Phase 8, T58)
 *
 * Runs with the app's real treeDecoder.ts through tsx: npm test (from training/js).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPhrases, decodeArcTree, gatePhrases, phraseSpans } from "../../../src/modules/parser/treeDecoder.ts";
import { chooseThreshold, gatingCurve, scaleArc } from "../lib/gating.mjs";

const decoder = { decodeArcTree, buildPhrases, gatePhrases, phraseSpans };
const L = Math.log;
// the red dog barks . : the→dog, red→dog, dog→barks, barks→root, .→barks
const record = (pThe) => ({
  gold_upos: ["DET", "ADJ", "NOUN", "VERB", "PUNCT"],
  pred_upos: ["DET", "ADJ", "NOUN", "VERB", "PUNCT"],
  gold_head: [3, 3, 4, 0, 4],
  gold_rel: ["det", "amod", "nsubj", "root", "punct"],
  arc_scores: [
    [L(0.01), -1e9, L(0.01), L(pThe), L(1 - pThe - 0.03), L(0.01)],
    [L(0.01), L(0.01), -1e9, L(0.97), L(0.005), L(0.005)],
    [L(0.01), L(0.01), L(0.01), -1e9, L(0.96), L(0.01)],
    [L(0.97), L(0.01), L(0.01), L(0.005), -1e9, L(0.005)],
    [L(0.01), L(0.01), L(0.01), L(0.01), L(0.96), -1e9],
  ],
  rel_candidates: [["det"], ["amod"], ["nsubj"], ["root"], ["punct"]].map((x) => x.map((relation) => ({ relation, prob: 0.9 }))),
});

describe("gatingCurve", () => {
  it("shows every bracket at threshold 0 and fewer at higher thresholds", () => {
    const curve = gatingCurve([record(0.97)], decoder, 1, [0, 0.9, 0.99]);
    assert.equal(curve[0].coverage, 1);
    assert.equal(curve[0].precision, 1);
    assert.ok(curve[2].shown <= curve[1].shown && curve[1].shown <= curve[0].shown);
  });

  it("counts a wrong attachment and hides the bracket containing it", () => {
    // "the" attaches to "barks" (wrong, p 0.6): brackets NP[red dog] ok, VP[red dog barks] wrong,
    // VP[the red dog barks] ok. Only the last contains the uncertain word, so it is hidden first.
    const curve = gatingCurve([record(0.37)], decoder, 1, [0, 0.7]);
    assert.equal(curve[0].shown, 3);
    assert.ok(Math.abs(curve[0].precision - 2 / 3) < 1e-9);
    assert.equal(curve[1].shown, 2);
  });

  it("chooses the lowest threshold meeting the precision target and ignores empty ones", () => {
    const curve = [
      { threshold: 0, precision: 0.9, shown: 10 },
      { threshold: 0.5, precision: 0.96, shown: 6 },
      { threshold: 0.9, precision: null, shown: 0 },
    ];
    assert.equal(chooseThreshold(curve, 0.95), 0.5);
    assert.equal(chooseThreshold(curve.slice(0, 1).concat(curve[2]), 0.95), 0.9);
    assert.deepEqual(scaleArc([[2, -4]], 2), [[1, -2]]);
  });
});
