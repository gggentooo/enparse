/**
 * src/modules/output/wordList.test.ts — the words of a parsed text (T101; rules T100)
 *
 * Covers: inflections merge, parts of speech split, phrasal verbs count once,
 * left-out tokens, shown forms, sort orders and ties, and a shared result.
 */

import { describe, expect, it } from "vitest";
import { annotate } from "./annotator";
import { decodeShareFile, encodeShareFile, toShared } from "./share";
import type { AnnotatorInput, InputToken } from "./types";
import { sortWords, wordList } from "./wordList";

type W = [text: string, lemma: string | null, upos: string, head?: number, relation?: string];

/** Sentences of space-separated words; heads default to the first word. */
function input(sentences: W[][]): { result: AnnotatorInput; text: string } {
  let pos = 0;
  const out = sentences.map((words) => {
    const start = pos;
    const tokens = words.map(([text, lemma, upos, head, relation], index): InputToken => {
      const s = pos;
      pos += text.length + 1;
      return {
        index,
        text,
        start: s,
        end: s + text.length,
        lemma,
        upos,
        chunkTag: "O",
        head: head ?? (index === 0 ? -1 : 0),
        relation: relation ?? (index === 0 ? "root" : "dep"),
      };
    });
    return { start, end: pos - 1, tokens, chunks: [], phrases: null, alternatives: [] };
  });
  const text = sentences.map((ws) => ws.map((w) => w[0]).join(" ")).join(" ");
  return { result: { sentences: out, modelId: "m", modelVersion: "1", backend: "wasm" }, text };
}

const SENTENCES: W[][] = [
  [
    ["She", "she", "PRON", 1, "nsubj"],
    ["looked", "look", "VERB", -1, "root"],
    ["it", "it", "PRON", 1, "obj"],
    ["up", "up", "ADP", 1, "compound:prt"],
    [".", ".", "PUNCT", 1, "punct"],
  ],
  [
    ["The", "the", "DET"],
    ["dogs", "dog", "NOUN"],
    ["ran", "run", "VERB"],
    ["a", "a", "DET"],
    ["run", "run", "NOUN"],
    ["in", "in", "ADP"],
    ["Paris", "paris", "PROPN"],
    ["with", "with", "ADP"],
    ["3", "3", "NUM"],
    ["two", "two", "NUM"],
    ["cats", "cat", "NOUN"],
    ["$", "$", "SYM"],
    ["etc", "etc", "X"],
    ["and", "and", "CCONJ"],
    ["is", "be", "AUX"],
    ["Runs", "run", "VERB"],
    ["the", "the", "DET"],
    ["look", "look", "VERB"],
    ["!", "!", "PUNCT"],
  ],
];

const words = (): ReturnType<typeof wordList> => {
  const { result, text } = input(SENTENCES);
  return wordList(annotate(result, text));
};

describe("wordList", () => {
  it("merges inflections, splits parts of speech, counts phrasal verbs once, and leaves out non-words", () => {
    const list = words();
    expect(list.map((w) => [w.word, w.upos, w.count])).toEqual([
      ["she", "PRON", 1],
      ["look up", "VERB", 1],
      ["it", "PRON", 1],
      ["the", "DET", 2],
      ["dog", "NOUN", 1],
      ["run", "VERB", 2],
      ["a", "DET", 1],
      ["run", "NOUN", 1],
      ["in", "ADP", 1],
      ["Paris", "PROPN", 1],
      ["with", "ADP", 1],
      ["two", "NUM", 1],
      ["cat", "NOUN", 1],
      ["and", "CCONJ", 1],
      ["be", "AUX", 1],
      ["look", "VERB", 1],
    ]);
    const run = list.find((w) => w.word === "run" && w.upos === "VERB");
    expect(run).toMatchObject({ forms: ["ran", "runs"], phrasal: false, lemma: "run" });
    expect(run?.sentence).toMatch(/^The dogs ran/);
    expect(list.find((w) => w.phrasal)).toMatchObject({
      forms: ["looked up"],
      query: { word: "looked up", lemma: "look up", upos: "VERB" },
      sentence: "She looked it up .",
    });
    expect(list.find((w) => w.upos === "PROPN")?.query).toEqual({ word: "Paris", lemma: "paris", upos: "PROPN" });
  });

  it("sorts alphabetically, by part of speech, and by frequency, with stable ties", () => {
    const list = words();
    const show = (by: "alpha" | "pos" | "frequency"): string[] => sortWords(list, by).map((w) => `${w.word}/${w.upos}`);
    expect(show("alpha").slice(0, 6)).toEqual(["a/DET", "and/CCONJ", "be/AUX", "cat/NOUN", "dog/NOUN", "in/ADP"]);
    // The same word: by part of speech (noun before verb).
    expect(show("alpha").filter((w) => w.startsWith("run/"))).toEqual(["run/NOUN", "run/VERB"]);
    expect(show("pos").slice(0, 5)).toEqual(["cat/NOUN", "dog/NOUN", "run/NOUN", "Paris/PROPN", "it/PRON"]);
    expect(show("frequency").slice(0, 3)).toEqual(["run/VERB", "the/DET", "a/DET"]); // equal counts: alphabetical
    expect(sortWords(list, "alpha")).not.toBe(list);
  });

  it("gives the same words for a shared result (T99)", () => {
    const { result, text } = input(SENTENCES);
    const opened = decodeShareFile(encodeShareFile(toShared(result, text)));
    expect(wordList(annotate(opened.input, opened.text))).toEqual(words());
  });

  it("uses the written word when the parse has no lemma", () => {
    const { result, text } = input([[["Hello", null, "INTJ"]]]);
    expect(wordList(annotate(result, text))).toMatchObject([{ word: "hello", lemma: "hello", upos: "INTJ" }]);
  });
});
