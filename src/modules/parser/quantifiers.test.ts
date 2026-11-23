/**
 * src/modules/parser/quantifiers.test.ts — quantifier display rule (T77)
 */

import { describe, expect, it } from "vitest";
import { QUANTIFIER_RELATION, displayTree } from "./quantifiers";
import { bracketString, buildPhrases } from "./treeDecoder";

type Sent = { words: string[]; heads: number[]; rels: string[]; upos: string[] };
const sent = (words: string, heads: number[], rels: string, upos: string): Sent => ({
  words: words.split(" "),
  heads,
  rels: rels.split(" "),
  upos: upos.split(" "),
});
const brackets = (s: Sent): string => {
  const d = displayTree(s.heads, s.rels, s.words);
  return bracketString(
    buildPhrases(
      d.heads,
      s.upos,
      d.relations.map((r) => r.split(":")[0] as string),
    ),
    s.words,
    true,
  );
};

describe("displayTree", () => {
  // given to a number of species of fish
  const NUMBER = sent(
    "given to a number of species of fish",
    [0, 4, 4, 1, 6, 4, 8, 6],
    "root case det obl case nmod case nmod",
    "VERB ADP DET NOUN ADP NOUN ADP NOUN",
  );

  it("shows the quantity word as a quantifier of the noun and moves the preposition to the noun", () => {
    const d = displayTree(NUMBER.heads, NUMBER.rels, NUMBER.words);
    expect(d.heads).toEqual([0, 6, 4, 6, 4, 1, 8, 6]);
    expect(d.relations).toEqual(["root", "case", "det", QUANTIFIER_RELATION, "fixed", "obl", "case", "nmod"]);
    expect(d.source).toEqual([0, 1, 2, 5, 4, 3, 6, 7]);
    expect(brackets(NUMBER)).toBe("[VP given [PP to [NP a number of] species [PP of fish]]]");
  });

  it("does not change the input", () => {
    const heads = [...NUMBER.heads];
    displayTree(NUMBER.heads, NUMBER.rels, NUMBER.words);
    expect(NUMBER.heads).toEqual(heads);
  });

  it("applies to the listed expressions, with adjectives kept in the quantifier", () => {
    const lot = sent("A lot of people came", [2, 5, 4, 2, 0], "det nsubj case nmod root", "DET NOUN ADP NOUN VERB");
    expect(brackets(lot)).toBe("[NP [NP A lot of] people] [VP came]");
    const deal = sent("a great deal of money", [3, 3, 0, 5, 3], "det amod root case nmod", "DET ADJ NOUN ADP NOUN");
    expect(brackets(deal)).toBe("[NP [NP a great deal of] money]");
    const some = sent("Some of the fish swim", [5, 4, 4, 1, 0], "nsubj case det nmod root", "DET ADP DET NOUN VERB");
    expect(brackets(some)).toBe("[NP [Some of] the fish] [VP swim]");
    const amount = sent("a large amount of water", [3, 3, 0, 5, 3], "det amod root case nmod", "DET ADJ NOUN ADP NOUN");
    expect(brackets(amount)).toBe("[NP [NP a large amount of] water]");
  });

  it("leaves 'the number of …', possessives, bare 'deal', and unlisted nouns alone", () => {
    const the = sent(
      "the number of students grew",
      [2, 5, 4, 2, 0],
      "det nsubj case nmod root",
      "DET NOUN ADP NOUN VERB",
    );
    expect(displayTree(the.heads, the.rels, the.words).heads).toEqual(the.heads);
    const poss = sent("my lot of books", [2, 0, 4, 2], "nmod:poss root case nmod", "PRON NOUN ADP NOUN");
    expect(displayTree(poss.heads, poss.rels, poss.words).heads).toEqual(poss.heads);
    const deal = sent("a deal of money", [2, 0, 4, 2], "det root case nmod", "DET NOUN ADP NOUN");
    expect(displayTree(deal.heads, deal.rels, deal.words).heads).toEqual(deal.heads);
    const species = sent("species of fish", [0, 3, 1], "root case nmod", "NOUN ADP NOUN");
    expect(displayTree(species.heads, species.rels, species.words).heads).toEqual(species.heads);
  });

  it("needs 'of' right after the quantity word, as the case of its nmod", () => {
    const other = sent("a number in red", [2, 0, 4, 2], "det root case nmod", "DET NOUN ADP ADJ");
    expect(displayTree(other.heads, other.rels, other.words).heads).toEqual(other.heads);
  });
});
