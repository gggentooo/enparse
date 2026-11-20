/**
 * training/js/tests/errors.test.mjs — unit tests for lib/errors.mjs
 *
 * Runs with the app's real treeDecoder.ts through tsx: npm test (from training/js).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPhrases, phraseSpans } from "../../../src/modules/parser/treeDecoder.ts";
import { bracketCauses, chunkErrors, chunkSpans, context, headType, sample, sentenceErrors, uposType } from "../lib/errors.mjs";

const decoder = { buildPhrases, phraseSpans };

describe("uposType", () => {
  it("names the common confusions", () => {
    assert.equal(uposType("NOUN", "VERB"), "noun/verb homograph");
    assert.equal(uposType("PROPN", "NOUN"), "proper vs common noun");
    assert.equal(uposType("ADJ", "VERB"), "adjective vs noun/verb (participles, modifiers)");
    assert.equal(uposType("ADV", "ADJ"), "adjective vs adverb");
    assert.equal(uposType("ADP", "SCONJ"), "function word (ADP/SCONJ/ADV/PART/CCONJ)");
    assert.equal(uposType("NOUN", "NUM"), "numbers and codes");
    assert.equal(uposType("PRON", "VERB"), "other");
  });
});

describe("chunkSpans", () => {
  it("starts a chunk at a stray I- (seqeval default mode)", () => {
    assert.deepEqual(chunkSpans(["O", "I-NP", "I-NP", "B-VP", "I-PP"]), [
      { type: "NP", start: 1, end: 2 },
      { type: "VP", start: 3, end: 3 },
      { type: "PP", start: 4, end: 4 },
    ]);
  });
});

describe("chunkErrors", () => {
  it("finds no errors in a perfect prediction", () => {
    const l = ["B-NP", "I-NP", "B-VP"];
    assert.deepEqual(chunkErrors(l, l), []);
  });
  it("classifies type, boundary, missed and spurious errors", () => {
    const gold = ["B-NP", "I-NP", "B-VP", "B-ADVP", "O", "B-NP"];
    const pred = ["B-NP", "B-NP", "B-ADJP", "O", "B-PP", "B-NP"];
    const types = chunkErrors(gold, pred).map((e) => e.type);
    assert.deepEqual(types, ["NP boundary: too short (split)", "wrong type (VP → ADJP)", "ADVP missed (tagged O)", "spurious PP"]);
  });
  it("tells a chunk joined with its neighbor", () => {
    const types = chunkErrors(["B-NP", "B-NP"], ["B-NP", "I-NP"]).map((e) => e.type);
    assert.deepEqual(types, ["NP boundary: too long (joined with a neighbor)", "NP boundary: too long (joined with a neighbor)"]);
  });
});

describe("headType", () => {
  // I saw the man with a telescope .
  const head = [2, 0, 4, 2, 7, 7, 2, 2];
  const rel = ["nsubj", "root", "det", "obj", "case", "det", "obl", "punct"];
  const upos = ["PRON", "VERB", "DET", "NOUN", "ADP", "DET", "NOUN", "PUNCT"];
  it("detects PP attachment, arguments, clauses and punctuation", () => {
    assert.equal(headType(6, head, rel, upos, "nmod"), "PP attachment");
    assert.equal(headType(3, head, rel, upos, "obj"), "subject/object attachment");
    assert.equal(headType(1, head, rel, upos, "ccomp"), "clause attachment (root, ccomp, advcl, acl, ...)");
    assert.equal(headType(7, head, rel, upos, "punct"), "punctuation attachment");
  });
});

describe("sentenceErrors and bracketCauses", () => {
  const r = {
    words: ["I", "saw", "the", "man", "with", "a", "telescope", "."],
    gold_upos: ["PRON", "VERB", "DET", "NOUN", "ADP", "DET", "NOUN", "PUNCT"],
    pred_upos: ["PRON", "VERB", "DET", "NOUN", "ADP", "DET", "NOUN", "PUNCT"],
    gold_chunk: ["B-NP", "B-VP", "B-NP", "I-NP", "B-PP", "B-NP", "I-NP", "O"],
    pred_chunk: ["B-NP", "B-VP", "B-NP", "I-NP", "B-PP", "B-NP", "I-NP", "O"],
    gold_head: [2, 0, 4, 2, 7, 7, 2, 2],
    gold_rel: ["nsubj", "root", "det", "obj", "case", "det", "obl", "punct"],
  };
  it("reports one PP attachment error and no bracket error for a perfect tree", () => {
    const perfect = { heads: r.gold_head, relations: r.gold_rel };
    assert.deepEqual(sentenceErrors(r, perfect), []);
    assert.equal(bracketCauses(r, perfect, decoder).missed, 0);
    const wrong = { heads: [2, 0, 4, 2, 7, 7, 4, 2], relations: ["nsubj", "root", "det", "obj", "case", "det", "nmod", "punct"] };
    const errs = sentenceErrors(r, wrong);
    assert.equal(errs.length, 1);
    assert.equal(errs[0].type, "PP attachment");
    assert.equal(errs[0].gold, "obl of saw#2");
    const b = bracketCauses(r, wrong, decoder);
    assert.ok(b.missed > 0);
    assert.equal(b.missed, b.inside + b.intruder + b.labelOnly + b.other);
  });
});

describe("sample and context", () => {
  it("samples deterministically without replacement", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = sample(items, 10, 7);
    assert.deepEqual(a, sample(items, 10, 7));
    assert.equal(new Set(a).size, 10);
    assert.deepEqual(sample(items, 100, 7), items);
  });
  it("marks the error span", () => {
    assert.equal(context(["a", "b", "c"], 1, 1), "a ⟦b⟧ c");
    assert.equal(context(["a", "b", "c", "d"], 3, 3, 1), "… c ⟦d⟧");
  });
});
