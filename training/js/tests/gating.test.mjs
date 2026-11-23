/**
 * training/js/tests/gating.test.mjs — unit tests for lib/gating.mjs (Phase 8, T58)
 *
 * Runs with the app's real treeDecoder.ts through tsx: npm test (from training/js).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gateLabeled, labelPhrases } from "../../../src/modules/parser/phraseLabeler.ts";
import { displayTree } from "../../../src/modules/parser/quantifiers.ts";
import { buildPhrases, decodeArcTree, phraseSpans, spanConfidence } from "../../../src/modules/parser/treeDecoder.ts";
import { chooseThreshold, gatingCurve, roleCurve, scaleArc, scaleRel } from "../lib/gating.mjs";

const decoder = { decodeArcTree, displayTree, buildPhrases, labelPhrases, gateLabeled, spanConfidence, phraseSpans };
const L = Math.log;
// the red dog barks . : the→dog, red→dog, dog→barks, barks→root, .→barks
const record = (pThe) => ({
  gold_upos: ["DET", "ADJ", "NOUN", "VERB", "PUNCT"],
  pred_upos: ["DET", "ADJ", "NOUN", "VERB", "PUNCT"],
  gold_head: [3, 3, 4, 0, 4],
  gold_rel: ["det", "amod", "nsubj", "root", "punct"],
  gold_deprel: ["det", "amod", "nsubj", "root", "punct"],
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

  it("counts a wrong attachment and hides the brackets it makes uncertain", () => {
    // "the" attaches to "barks" (wrong, p 0.6): the subject [red dog] is wrong (gold: [the red dog]).
    // Without gating it is shown; gated at 0.7 it is not shown as certain ("the" may belong inside,
    // p 0.38) but, as the main clause's subject, it stays as a dashed bracket (T82).
    const curve = gatingCurve([record(0.37)], decoder, 1, [0, 0.7]);
    assert.equal(curve[0].shown, 1);
    assert.equal(curve[0].precision, 0);
    assert.equal(curve[1].shown, 0);
    assert.equal(curve[1].precision, null);
    assert.equal(curve[1].dashed, 1);
    assert.equal(curve[1].dashed_precision, 0);
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

describe("roleCurve", () => {
  it("counts roles on brackets, words, and badges, and gates them by confidence", () => {
    // Correct tree: Subject [the red dog], Modifier red, Predicate [barks] (main clause: no clause bracket).
    const all = roleCurve([record(0.97)], decoder, 1, 1, 0, [0, 0.999]);
    assert.equal(all[0].shown, 3);
    assert.equal(all[0].precision, 1);
    assert.equal(all[0].recall, 1);
    assert.equal(all[1].shown, 0); // relation prob 0.9 × head prob < 0.999
    assert.equal(all[1].precision, null);
    // Brackets gated at 0.99: [the red dog] is below it (about 0.92) but pinned, so it keeps its Subject role.
    const gated = roleCurve([record(0.97)], decoder, 1, 1, 0.99, [0]);
    assert.equal(gated[0].shown, 3);
    assert.equal(gated[0].precision, 1);
  });

  it("rescales relation candidates by temperature", () => {
    const [cs] = scaleRel([[{ relation: "a", prob: 0.8 }, { relation: "b", prob: 0.2 }]], 2);
    assert.ok(Math.abs(cs[0].prob - Math.sqrt(0.8) / (Math.sqrt(0.8) + Math.sqrt(0.2))) < 1e-12);
  });
});
