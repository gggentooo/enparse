/**
 * training/js/tests/gating.test.mjs — unit tests for lib/gating.mjs (Phase 8, T58)
 *
 * Runs with the app's real treeDecoder.ts through tsx: npm test (from training/js).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelPhrases } from "../../../src/modules/parser/phraseLabeler.ts";
import { buildPhrases, decodeArcTree, gatePhrases, phraseSpans } from "../../../src/modules/parser/treeDecoder.ts";
import { chooseThreshold, gatingCurve, roleCurve, scaleArc, scaleRel } from "../lib/gating.mjs";

const decoder = { decodeArcTree, buildPhrases, gatePhrases, phraseSpans, labelPhrases };
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
    // "the" attaches to "barks" (wrong, p 0.6): NP[red dog] ok, VP[red dog barks] wrong,
    // VP[the red dog barks] ok. The wrong one has confident words inside, but "the" is an outer
    // dependent of its head, so it is hidden with the one containing "the"; NP[red dog] stays.
    const curve = gatingCurve([record(0.37)], decoder, 1, [0, 0.7]);
    assert.equal(curve[0].shown, 3);
    assert.ok(Math.abs(curve[0].precision - 2 / 3) < 1e-9);
    assert.equal(curve[1].shown, 1);
    assert.equal(curve[1].precision, 1);
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
    // Correct tree: Subject [the red dog], Modifier red, Predicate [barks]; the clause itself has no role.
    const all = roleCurve([record(0.97)], decoder, 1, 1, 0, [0, 0.999]);
    assert.equal(all[0].shown, 3);
    assert.equal(all[0].precision, 1);
    assert.equal(all[0].recall, 1);
    assert.equal(all[1].shown, 0); // relation prob 0.9 × head prob < 0.999
    assert.equal(all[1].precision, null);
    // Brackets gated at 0.99: [the red dog] collapses (0.97 × 0.97); its Subject role becomes a badge on "dog".
    const gated = roleCurve([record(0.97)], decoder, 1, 1, 0.99, [0]);
    assert.equal(gated[0].shown, 3);
    assert.equal(gated[0].precision, 1);
  });

  it("rescales relation candidates by temperature", () => {
    const [cs] = scaleRel([[{ relation: "a", prob: 0.8 }, { relation: "b", prob: 0.2 }]], 2);
    assert.ok(Math.abs(cs[0].prob - Math.sqrt(0.8) / (Math.sqrt(0.8) + Math.sqrt(0.2))) < 1e-12);
  });
});
