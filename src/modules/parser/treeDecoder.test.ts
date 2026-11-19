/**
 * src/modules/parser/treeDecoder.test.ts — unit tests for tree decoding and nested phrases
 *
 * Covers: label parsing and head resolution (rel_pos_v1), best-candidate
 * decoding, root repair (none / several), cycle repair, unresolvable heads,
 * the documented bracketing examples, PP labels, punctuation placement,
 * non-projective trees, and phrase spans.
 */

import { describe, expect, it } from "vitest";
import {
  REPAIR_RELATION,
  ROOT_LABEL,
  bracketString,
  buildPhrases,
  decodeTree,
  parseDepLabel,
  phraseSpans,
  resolveHead,
} from "./treeDecoder";
import type { DepCandidate } from "./types";

const c = (label: string, prob = 0.9): DepCandidate => ({ label, prob });

describe("labels", () => {
  it("parses labels", () => {
    expect(parseDepLabel("-2@NOUN|nmod")).toEqual({ offset: -2, headUpos: "NOUN", relation: "nmod" });
    expect(parseDepLabel(ROOT_LABEL)).toEqual({ offset: 0, headUpos: "ROOT", relation: "root" });
    expect(() => parseDepLabel("bad")).toThrow(/malformed/);
  });

  it("resolves the k-th word of the head's UPOS in the direction of the offset", () => {
    const upos = ["ADJ", "NOUN", "ADP", "NOUN"];
    expect(resolveHead("+1@NOUN|amod", upos, 0)).toBe(2);
    expect(resolveHead("+2@NOUN|amod", upos, 0)).toBe(4);
    expect(resolveHead("-1@NOUN|nmod", upos, 3)).toBe(2);
    expect(resolveHead("+3@NOUN|amod", upos, 0)).toBeNull();
    expect(resolveHead(ROOT_LABEL, upos, 1)).toBe(0);
  });
});

describe("decodeTree", () => {
  const upos = ["DET", "ADJ", "NOUN", "ADV", "VERB", "ADV", "PUNCT"];
  const best = [
    [c("+1@NOUN|det")],
    [c("+1@NOUN|amod")],
    [c("+1@VERB|nsubj")],
    [c("+1@VERB|advmod")],
    [c(ROOT_LABEL)],
    [c("-1@VERB|advmod")],
    [c("-1@VERB|punct")],
  ];

  it("uses the best labels when they form a tree", () => {
    const t = decodeTree(best, upos);
    expect(t.heads).toEqual([3, 3, 5, 5, 0, 5, 5]);
    expect(t.relations).toEqual(["det", "amod", "nsubj", "advmod", "root", "advmod", "punct"]);
    expect(t.repaired).toBe(false);
  });

  it("keeps the most probable root and moves the others to their next label", () => {
    const cands = best.map((x) => [...x]);
    cands[2] = [c(ROOT_LABEL, 0.6), c("+1@VERB|nsubj", 0.3)];
    cands[4] = [c(ROOT_LABEL, 0.95)];
    const t = decodeTree(cands, upos);
    expect(t.heads[2]).toBe(5);
    expect(t.heads.filter((h) => h === 0)).toHaveLength(1);
    expect(t.repairedWords).toEqual([2]);
  });

  it("creates a root when no word predicts one", () => {
    const cands = best.map((x) => [...x]);
    cands[4] = [c("-1@NOUN|dep", 0.5), c(ROOT_LABEL, 0.4)];
    const t = decodeTree(cands, upos);
    expect(t.heads[4]).toBe(0);
  });

  it("breaks cycles with the most probable alternative outside the cycle", () => {
    // 0 → 1 and 1 → 0 form a cycle; word 1 has an alternative to the verb.
    const u = ["NOUN", "NOUN", "VERB"];
    const t = decodeTree(
      [[c("+1@NOUN|compound", 0.9)], [c("-1@NOUN|nmod", 0.8), c("+1@VERB|obj", 0.5)], [c(ROOT_LABEL)]],
      u,
    );
    expect(t.heads).toEqual([2, 3, 0]);
    expect(t.repaired).toBe(true);
  });

  it("attaches words with no usable label to the root", () => {
    const t = decodeTree([[c("+5@NOUN|det")], [c(ROOT_LABEL)]], ["DET", "VERB"]);
    expect(t.heads).toEqual([2, 0]);
    expect(t.relations[0]).toBe(REPAIR_RELATION);
  });

  it("always returns a valid tree for random labels (fuzz)", () => {
    const tags = ["NOUN", "VERB", "DET", "ADJ", "PUNCT"];
    let seed = 7;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let trial = 0; trial < 3000; trial++) {
      const n = 1 + rand(14);
      const upos = Array.from({ length: n }, () => tags[rand(tags.length)] as string);
      const cands = upos.map(() =>
        Array.from({ length: 1 + rand(5) }, (_, k) => {
          const off = rand(7) - 3;
          const label = off === 0 ? ROOT_LABEL : `${off > 0 ? "+" : ""}${off}@${tags[rand(tags.length)]}|dep`;
          return c(label, 1 / (k + 1));
        }),
      );
      const t = decodeTree(cands, upos);
      expect(t.heads.filter((h) => h === 0)).toHaveLength(1);
      for (let i = 0; i < n; i++) {
        // following heads from every word reaches the root without revisiting a word
        const seen = new Set<number>();
        for (let k = i + 1; k !== 0; k = t.heads[k - 1] ?? 0) {
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
      expect(() => buildPhrases(t.heads, upos, t.relations)).not.toThrow();
    }
  });

  it("handles empty sentences", () => {
    expect(decodeTree([], []).heads).toEqual([]);
  });
});

describe("buildPhrases", () => {
  it("reproduces the documented example", () => {
    const words = ["The", "red", "dog", "rarely", "barks", "loudly", "."];
    const upos = ["DET", "ADJ", "NOUN", "ADV", "VERB", "ADV", "PUNCT"];
    const rel = ["det", "amod", "nsubj", "advmod", "root", "advmod", "punct"];
    const items = buildPhrases([3, 3, 5, 5, 0, 5, 5], upos, rel);
    expect(bracketString(items, words)).toBe("[[The [red [dog]]] [rarely [[barks] loudly]]] .");
    expect(bracketString(items, words, true)).toBe("[VP [NP The [NP red [NP dog]]] [VP rarely [VP [VP barks] loudly]]] .");
  });

  it("labels a nominal with a case dependent as PP (right dependents nest first)", () => {
    const words = ["the", "man", "in", "the", "car"];
    const upos = ["DET", "NOUN", "ADP", "DET", "NOUN"];
    const rel = ["det", "root", "case", "det", "nmod"];
    const items = buildPhrases([2, 0, 5, 5, 2], upos, rel);
    expect(bracketString(items, words)).toBe("[the [[man] [in [the [car]]]]]");
    expect(bracketString(items, words, true)).toBe("[NP the [NP [NP man] [PP in [NP the [NP car]]]]]");
  });

  it("keeps non-root punctuation in its head's outermost phrase", () => {
    const words = ["Paris", ",", "France", "rocks"];
    const upos = ["PROPN", "PUNCT", "PROPN", "VERB"];
    const rel = ["nsubj", "punct", "appos", "root"];
    const items = buildPhrases([4, 1, 1, 0], upos, rel);
    expect(bracketString(items, words)).toBe("[[[Paris] , France] [rocks]]");
  });

  it("marks discontinuous phrases in non-projective trees", () => {
    // word 0 depends on word 2, word 1 on word 3: crossing arcs
    const items = buildPhrases([3, 4, 0, 3], ["NOUN", "NOUN", "VERB", "VERB"], ["nsubj", "obj", "root", "ccomp"]);
    const spans = phraseSpans(items);
    expect(spans.length).toBeGreaterThan(0);
    const root = items[0];
    expect(root && "start" in root && root.contiguous).toBe(true);
    const inner = JSON.stringify(items);
    expect(inner).toContain('"contiguous":false');
  });

  it("lists every bracket as a span", () => {
    const items = buildPhrases([2, 0], ["ADJ", "NOUN"], ["amod", "root"]);
    expect(phraseSpans(items)).toEqual([
      { type: "NP", start: 0, end: 1 },
      { type: "NP", start: 1, end: 1 },
    ]);
  });
});
