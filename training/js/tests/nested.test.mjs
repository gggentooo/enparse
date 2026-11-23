/**
 * training/js/tests/nested.test.mjs — unit tests for lib/nested.mjs
 *
 * Runs with the app's real treeDecoder.ts through tsx: npm test (from training/js).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPhrases, decodeArcTree, decodeTree, phraseSpans } from "../../../src/modules/parser/treeDecoder.ts";
import { decodeRecord, scoreNested } from "../lib/nested.mjs";

const decoder = { decodeTree, decodeArcTree, buildPhrases, phraseSpans };
const gold = {
  gold_upos: ["DET", "NOUN", "VERB", "PUNCT"],
  gold_head: [2, 3, 0, 3],
  gold_rel: ["det", "nsubj", "root", "punct"],
};
const cand = (label) => [{ label, prob: 0.9 }];

describe("scoreNested", () => {
  it("scores a perfect prediction as 1", () => {
    const r = {
      ...gold,
      pred_upos: gold.gold_upos,
      dep_candidates: [cand("+1@NOUN|det"), cand("+1@VERB|nsubj"), cand("0@ROOT|root"), cand("-1@VERB|punct")],
    };
    const s = scoreNested([r], decoder);
    assert.equal(s.nested_f1, 1);
    assert.equal(s.tree_uas, 1);
    assert.equal(s.tree_las, 1);
    assert.equal(s.repaired_share, 0);
  });

  it("counts repairs and wrong brackets", () => {
    const r = {
      ...gold,
      pred_upos: gold.gold_upos,
      // "the" points nowhere (no NOUN two to the right) → repaired to the root.
      dep_candidates: [cand("+2@NOUN|det"), cand("+1@VERB|nsubj"), cand("0@ROOT|root"), cand("-1@VERB|punct")],
    };
    const s = scoreNested([r], decoder);
    assert.equal(s.repaired_share, 1);
    assert.equal(s.tree_uas, 0.75);
    assert.ok(s.nested_f1 < 1);
  });

  it("excludes punctuation from UAS and single-word brackets from multi-word F1", () => {
    const r = {
      ...gold,
      pred_upos: gold.gold_upos,
      // Only the final "." is wrong: it attaches to "dog" instead of "barks".
      dep_candidates: [cand("+1@NOUN|det"), cand("+1@VERB|nsubj"), cand("0@ROOT|root"), cand("-1@NOUN|punct")],
    };
    const s = scoreNested([r], decoder);
    assert.equal(s.tree_uas, 0.75);
    assert.equal(s.tree_uas_no_punct, 1);
    assert.equal(s.tree_las_no_punct, 1);
    // A main clause's subject and predicate are bracketed even as single words (T82); the
    // multi-word score leaves those out.
    const spans = phraseSpans(buildPhrases(gold.gold_head, gold.gold_upos, gold.gold_rel));
    assert.ok(spans.some((x) => x.end === x.start), "gold has single-word brackets");
    assert.ok(spans.some((x) => x.end > x.start), "gold has multi-word brackets");
  });

  it("scores multi-word brackets only", () => {
    const perfect = {
      ...gold,
      pred_upos: gold.gold_upos,
      dep_candidates: [cand("+1@NOUN|det"), cand("+1@VERB|nsubj"), cand("0@ROOT|root"), cand("-1@VERB|punct")],
    };
    assert.equal(scoreNested([perfect], decoder).nested_multiword_f1, 1);
    // "The" attached to "barks": [The dog] is lost, so a multi-word bracket is missed.
    const wrong = { ...perfect, dep_candidates: [cand("+2@VERB|det"), ...perfect.dep_candidates.slice(1)] };
    const s = scoreNested([wrong], decoder);
    assert.ok(s.nested_multiword_f1 < 1);
    assert.equal(s.tree_uas_no_punct, 2 / 3);
  });
});

describe("decodeRecord (biaffine records)", () => {
  it("decodes arc scores with MST, strips subtypes, and scores like rel_pos records", () => {
    const L = Math.log;
    // the dog barks . : the→dog, dog→barks, barks→root, .→barks
    const arc = [
      [L(0.01), -1e9, L(0.97), L(0.01), L(0.01)],
      [L(0.01), L(0.01), -1e9, L(0.97), L(0.01)],
      [L(0.97), L(0.01), L(0.01), -1e9, L(0.01)],
      [L(0.01), L(0.01), L(0.01), L(0.97), -1e9],
    ];
    const rels = [["det"], ["nsubj:pass"], ["root"], ["punct"]].map((x) => x.map((relation) => ({ relation, prob: 0.9 })));
    const r = { ...gold, pred_upos: gold.gold_upos, arc_scores: arc, rel_candidates: rels };
    const tree = decodeRecord(r, decoder);
    assert.deepEqual(tree.heads, [2, 3, 0, 3]);
    assert.deepEqual(tree.relations, ["det", "nsubj", "root", "punct"]);
    assert.equal(tree.fullRelations[1], "nsubj:pass");
    const s = scoreNested([r], decoder);
    assert.equal(s.tree_uas, 1);
    assert.equal(s.tree_las, 1);
    assert.equal(s.nested_f1, 1);
  });
});
