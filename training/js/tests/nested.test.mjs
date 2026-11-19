/**
 * training/js/tests/nested.test.mjs — unit tests for lib/nested.mjs
 *
 * Runs with the app's real treeDecoder.ts through tsx: npm test (from training/js).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPhrases, decodeTree, phraseSpans } from "../../../src/modules/parser/treeDecoder.ts";
import { scoreNested } from "../lib/nested.mjs";

const decoder = { decodeTree, buildPhrases, phraseSpans };
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
});
