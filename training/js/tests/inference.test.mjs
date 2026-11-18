/**
 * training/js/tests/inference.test.mjs — unit tests for lib/inference.mjs
 *
 * Runs with Node's built-in test runner: npm test (from training/js).
 *
 * Covers: special tokens from an empty encode, word-by-word encoding with the
 * per-word subword cap and both strategies, token→word maps, first-subword
 * argmax per label group, and agreement counting.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agreement, argmaxWords, encodeWords, sameIds, specialIds } from "../lib/inference.mjs";

// Fake tokenizer: [CLS]=1 ... [SEP]=2; each character is one token (code point % 100 + 10);
// a leading space becomes token 3 so the "space" strategy is visible.
const fake = {
  encode(text, { add_special_tokens }) {
    const body = [...text].map((ch) => (ch === " " ? 3 : (ch.codePointAt(0) % 100) + 10));
    return add_special_tokens ? [1, ...body, 2] : body;
  },
};

describe("encoding", () => {
  it("finds special tokens around an empty string", () => {
    assert.deepEqual(specialIds(fake), { prefix: [1], suffix: [2] });
  });

  it("encodes words one by one with a per-word cap and a token→word map", () => {
    const { ids, tokenWord } = encodeWords(fake, ["ab", "cdef"], 3, "plain");
    assert.deepEqual(ids, [1, 107, 108, 109, 10, 11, 2]); // "d" = 100 → 10, "e" = 101 → 11
    assert.deepEqual(tokenWord, [-1, 0, 0, 1, 1, 1, -1]);
  });

  it("prefixes a space with the space strategy", () => {
    const { ids } = encodeWords(fake, ["a"], 4, "space");
    assert.deepEqual(ids, [1, 3, 107, 2]);
  });

  it("compares id arrays", () => {
    assert.ok(sameIds([1, 2], [1, 2]));
    assert.ok(!sameIds([1, 2], [1]));
  });
});

describe("argmax and agreement", () => {
  const groups = { chunk: { start: 0, end: 2 }, dep: { start: 2, end: 5 } };
  // 4 tokens × 5 classes: [CLS], word0, word0 (2nd subword), word1
  const data = new Float32Array([
    9, 9, 9, 9, 9,
    0, 1, 0, 5, 0,
    7, 0, 9, 0, 0,
    2, 0, 0, 0, 3,
  ]); // prettier-ignore

  it("reads the first subword of each word in each group", () => {
    assert.deepEqual(argmaxWords(data, 5, [-1, 0, 0, 1], groups), { chunk: [1, 0], dep: [1, 2] });
  });

  it("counts agreement per group", () => {
    const r = agreement([{ js: { chunk: [1, 0], dep: [1, 2] }, ref: { chunk: [1, 1], dep: [1, 2] } }]);
    assert.deepEqual(r, { chunk: 0.5, dep: 1, words: 2 });
    assert.throws(() => agreement([{ js: { chunk: [1], dep: [1] }, ref: { chunk: [1, 2], dep: [1, 2] } }]));
  });

  it("counts only confident words when a margin is given", () => {
    const pair = {
      js: { chunk: [1, 0, 3], dep: [1, 2, 0] },
      ref: { chunk: [1, 1, 3], dep: [0, 2, 0], chunkMargin: [0.5, 0.05, 0.2], depMargin: [0.01, 0.3, 0.3] },
    };
    assert.deepEqual(agreement([pair], 0.1), { chunk: 1, dep: 1, words: 2, dep_words: 2 });
    assert.deepEqual(agreement([pair]).words, 3);
  });
});
