/**
 * src/modules/output/annotator.test.ts — parse result → annotation model (T57)
 */

import { describe, expect, it } from "vitest";
import type { ParseResult, SentenceParse, Token } from "../parser";
import { annotate, annotateNodes, flatSegments } from "./annotator";
import type { AnnotatorInput } from "./types";

const labels = { role: null, isHead: false, coordinated: false, splitPredicate: false, badge: false } as const;

/** Tokens of "The dog ran ." with offsets into `text`. */
function tokens(words: string[], offset = 0, gaps: boolean[] = []): Token[] {
  let pos = offset;
  return words.map((text, index) => {
    const start = pos;
    pos += text.length + (gaps[index] === false ? 0 : 1);
    return {
      index,
      text,
      start,
      end: start + text.length,
      lemma: text.toLowerCase(),
      upos: "X",
      uposProb: 1,
      chunkTag: "O",
      chunkProb: 1,
      head: -1,
      relation: "dep",
      headProb: 1,
      relationProb: 1,
    };
  });
}

function sentence(words: string[], offset: number, over: Partial<SentenceParse> = {}): SentenceParse {
  const toks = tokens(
    words,
    offset,
    words.map((_, i) => i !== words.length - 2),
  );
  return {
    start: offset,
    end: toks.at(-1)?.end ?? offset,
    tokens: toks,
    chunks: [],
    phrases: null,
    treeRepaired: false,
    alternatives: [],
    ...over,
  };
}

describe("flatSegments", () => {
  it("covers every word with chunks and gap runs, in order", () => {
    const segs = flatSegments(
      [
        { type: "VP", start: 2, end: 2 },
        { type: "NP", start: 0, end: 1 },
      ],
      5,
      "x",
    );
    expect(segs.map((s) => [s.type, s.start, s.end])).toEqual([
      ["NP", 0, 1],
      ["VP", 2, 2],
      [null, 3, 4],
    ]);
    expect(new Set(segs.map((s) => s.id)).size).toBe(segs.length);
  });

  it("skips overlapping and out-of-range chunks", () => {
    const segs = flatSegments(
      [
        { type: "NP", start: 0, end: 2 },
        { type: "PP", start: 1, end: 1 },
        { type: "VP", start: 3, end: 9 },
      ],
      4,
      "x",
    );
    expect(segs.map((s) => [s.type, s.start, s.end])).toEqual([
      ["NP", 0, 2],
      [null, 3, 3],
    ]);
  });
});

describe("annotateNodes", () => {
  it("keeps roles and head flags and collapses wrapper brackets into their word", () => {
    const nodes = annotateNodes(
      [
        {
          ...labels,
          role: "Subject",
          category: "NP",
          head: 1,
          start: 0,
          end: 1,
          contiguous: true,
          wrapper: false,
          children: [
            { ...labels, word: 0 },
            {
              ...labels,
              isHead: true,
              category: "NP",
              head: 1,
              start: 1,
              end: 1,
              contiguous: true,
              wrapper: true,
              children: [{ ...labels, word: 1 }],
            },
          ],
        },
        { ...labels, word: 2, role: "Predicate", badge: true },
      ],
      "n",
    );
    expect(nodes[0]).toMatchObject({ kind: "phrase", category: "NP", role: "Subject", id: "n-0" });
    const inner = nodes[0]?.kind === "phrase" ? nodes[0].children : [];
    expect(inner[1]).toMatchObject({ kind: "word", token: 1, isHead: true, id: "n-0-1" });
    expect(nodes[1]).toMatchObject({ kind: "word", token: 2, role: "Predicate", badge: true });
  });
});

describe("annotate", () => {
  const text = "The dog ran.\n\nIt sat.";
  const s1 = sentence(["The", "dog", "ran", "."], 0, {
    chunks: [
      { type: "NP", start: 0, end: 1 },
      { type: "VP", start: 2, end: 2 },
    ],
    alternatives: [
      {
        rank: 1,
        probability: 0.25,
        reason: "probability",
        changes: [{ index: 2, upos: "NOUN", chunkTag: "I-NP" }],
        chunks: [{ type: "NP", start: 0, end: 2 }],
        phrases: null,
      },
    ],
  });
  const s2 = sentence(["It", "sat", "."], 14);
  const result: ParseResult = { sentences: [s1, s2], modelId: "m", modelVersion: "1", backend: "wasm" };

  it("accepts a parser ParseResult as input (structural contract)", () => {
    const input: AnnotatorInput = result;
    expect(input.modelId).toBe("m");
  });

  it("builds sentences with paragraphs, text, spacing, readings, and ambiguity marks", () => {
    const a = annotate(result, text);
    expect(a).toMatchObject({ modelId: "m", modelVersion: "1", backend: "wasm", hasNested: false });
    expect(a.sentences.map((s) => [s.id, s.paragraph, s.text])).toEqual([
      ["s0", 0, "The dog ran."],
      ["s1", 1, "It sat."],
    ]);
    const [first] = a.sentences;
    expect(first?.tokens.map((t) => t.spaceAfter)).toEqual([true, true, false, false]);
    expect(first?.tokens.map((t) => t.ambiguous)).toEqual([false, false, true, false]);
    expect(first?.tokens[1]).toMatchObject({ id: "s0-t1", text: "dog", lemma: "dog" });

    const [primary, alt] = first?.readings ?? [];
    expect(primary).toMatchObject({ rank: 0, reason: "primary", probability: 0.75, nodes: null, changes: {} });
    expect(primary?.segments.map((s) => s.type)).toEqual(["NP", "VP", null]);
    expect(alt).toMatchObject({ rank: 1, reason: "probability", probability: 0.25 });
    expect(alt?.changes).toEqual({ 2: { upos: "NOUN", chunkTag: "I-NP" } });
    expect(alt?.segments.map((s) => [s.type, s.start, s.end])).toEqual([
      ["NP", 0, 2],
      [null, 3, 3],
    ]);
  });

  it("marks hasNested when the model ships phrases", () => {
    const nested = sentence(["Hi", "."], 0, {
      phrases: [
        { ...labels, word: 0 },
        { ...labels, word: 1 },
      ],
    });
    const a = annotate({ ...result, sentences: [nested] }, "Hi.");
    expect(a.hasNested).toBe(true);
    expect(a.sentences[0]?.readings[0]?.nodes).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(annotate({ ...result, sentences: [] }, "").sentences).toEqual([]);
  });
});
