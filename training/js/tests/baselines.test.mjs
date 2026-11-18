/**
 * training/js/tests/baselines.test.mjs — unit tests for Phase 5 metrics and baseline mapping
 *
 * Runs with Node's built-in test runner: npm test (from training/js).
 *
 * Covers: BIO span extraction (incl. I- after O, type changes), chunk
 * precision/recall/F1 (overall, per type), UPOS accuracy and confusions,
 * joining words and choosing the deciding token per word, compromise tag
 * mapping, and both baselines on real library instances (smoke tests).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nlpCompromise from "compromise";
import winkModel from "wink-eng-lite-web-model";
import winkNLP from "wink-nlp";
import { compromiseTags, compromiseTermUpos, joinWords, tokenForWords, winkUpos } from "../lib/baselines.mjs";
import { chunkScores, spansFromBio, uposScores } from "../lib/metrics.mjs";

describe("metrics", () => {
  it("extracts spans like seqeval (I- after O or another type starts a chunk)", () => {
    assert.deepEqual(spansFromBio(["B-NP", "I-NP", "O", "I-VP", "I-PP", "B-PP"]), ["NP:0:1", "VP:3:3", "PP:4:4", "PP:5:5"]);
    assert.deepEqual(spansFromBio(["O", "O"]), []);
    assert.deepEqual(spansFromBio(["B-NP", "I-NP"]), ["NP:0:1"]);
  });

  it("scores chunks by exact type and boundaries", () => {
    const gold = [["B-NP", "I-NP", "B-VP", "B-NP"]];
    const pred = [["B-NP", "I-NP", "B-VP", "B-ADJP"]];
    const { overall, perType } = chunkScores(gold, pred);
    assert.equal(overall.correct, 2);
    assert.equal(overall.gold, 3);
    assert.equal(overall.pred, 3);
    assert.ok(Math.abs(overall.f1 - 2 / 3) < 1e-12);
    assert.equal(perType.NP.recall, 0.5);
    assert.equal(perType.ADJP.precision, 0);
  });

  it("rejects mismatched lengths", () => {
    assert.throws(() => chunkScores([["O"]], [["O", "O"]]), /lengths differ/);
    assert.throws(() => uposScores(["NOUN"], []), /lengths differ/);
  });

  it("computes UPOS accuracy, per-tag accuracy, and confusions", () => {
    const r = uposScores(["NOUN", "NOUN", "VERB", "DET"], ["NOUN", "PROPN", "VERB", "PROPN"]);
    assert.equal(r.accuracy, 0.5);
    assert.equal(r.perTag.NOUN.accuracy, 0.5);
    assert.deepEqual(r.confusions[0], ["NOUN → PROPN", 1]);
  });
});

describe("token mapping", () => {
  it("joins words with single spaces and records spans", () => {
    assert.deepEqual(joinWords(["I", "'m", "ok"]), {
      text: "I 'm ok",
      spans: [{ start: 0, end: 1 }, { start: 2, end: 4 }, { start: 5, end: 7 }],
    });
  });

  it("picks the last alphanumeric token inside a word (head-final compounds)", () => {
    const spans = [{ start: 0, end: 10 }, { start: 11, end: 12 }];
    const tokens = [
      { start: 0, end: 4, text: "well" },
      { start: 4, end: 5, text: "-" },
      { start: 5, end: 10, text: "known" },
      { start: 11, end: 12, text: "." },
    ];
    assert.deepEqual(tokenForWords(spans, tokens), [2, 3]);
  });

  it("ignores zero-length tokens and reports uncovered words", () => {
    const tokens = [{ start: 0, end: 0, text: "" }];
    assert.deepEqual(tokenForWords([{ start: 0, end: 2 }], tokens), [-1]);
  });

  it("maps compromise tags to UPOS", () => {
    assert.equal(compromiseTermUpos({ text: ",", tags: ["Noun", "Singular"] }), "PUNCT");
    assert.equal(compromiseTermUpos({ text: "$", tags: [] }), "SYM");
    assert.equal(compromiseTermUpos({ text: "to", tags: ["Connector", "Conjunction"] }), "PART");
    assert.equal(compromiseTermUpos({ text: "and", tags: ["Connector", "Conjunction"] }), "CCONJ");
    assert.equal(compromiseTermUpos({ text: "because", tags: ["Connector", "Conjunction"] }), "SCONJ");
    assert.equal(compromiseTermUpos({ text: "in", tags: ["Connector", "Preposition"] }), "ADP");
    assert.equal(compromiseTermUpos({ text: "John", tags: ["Noun", "ProperNoun"] }), "PROPN");
    assert.equal(compromiseTermUpos({ text: "could", tags: ["Verb", "Modal", "Auxiliary"] }), "AUX");
    assert.equal(compromiseTermUpos({ text: "zzz", tags: [] }), "X");
  });
});

describe("baselines on real libraries", () => {
  const words = ["The", "big", "dog", "in", "the", "yard", "barked", "."];

  it("wink-nlp gives one UPOS per word", () => {
    const tags = winkUpos(winkNLP(winkModel), words);
    assert.equal(tags.length, words.length);
    assert.equal(tags[0], "DET");
    assert.equal(tags[7], "PUNCT");
  });

  it("compromise gives valid UPOS and BIO per word, with prepositions as PP", () => {
    const { upos, chunk } = compromiseTags(nlpCompromise, words);
    assert.equal(upos.length, words.length);
    assert.equal(chunk.length, words.length);
    assert.equal(chunk[3], "B-PP");
    assert.equal(chunk[7], "O");
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i].startsWith("I-")) assert.equal(chunk[i - 1].slice(2), chunk[i].slice(2));
    }
  });
});
