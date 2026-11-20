/**
 * src/modules/parser/treeDecoder.test.ts — unit tests for tree decoding and nested phrases
 *
 * Covers: label parsing and head resolution (rel_pos_v1), best-candidate
 * decoding, root repair (none / several), cycle repair, unresolvable heads,
 * the documented bracketing examples, PP labels, punctuation placement,
 * non-projective trees, and phrase spans; MST decoding over arc scores
 * (optimality against brute force on small random sentences, single root,
 * relations) and confidence gating.
 */

import { describe, expect, it } from "vitest";
import {
  REPAIR_RELATION,
  ROOT_LABEL,
  ROOT_RELATION,
  bracketConfidence,
  bracketString,
  buildPhrases,
  decodeArcTree,
  decodeTree,
  gatePhrases,
  maxSpanningTree,
  parseDepLabel,
  phraseSpans,
  resolveHead,
} from "./treeDecoder";
import type { DepCandidate, PhraseNode, RelationCandidate } from "./types";

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

// -- MST decoding (biaffine) -------------------------------------------------------------

/** All head arrays (node 0 = root) that form a tree with exactly one root child. */
function allTrees(n: number): number[][] {
  const out: number[][] = [];
  const heads = new Array<number>(n + 1).fill(-1);
  const isTree = (): boolean => {
    if (heads.slice(1).filter((h) => h === 0).length !== 1) return false;
    for (let d = 1; d <= n; d++) {
      const seen = new Set<number>();
      for (let k = d; k !== 0; k = heads[k] as number) {
        if (seen.has(k)) return false;
        seen.add(k);
      }
    }
    return true;
  };
  const rec = (d: number): void => {
    if (d > n) {
      if (isTree()) out.push(heads.slice());
      return;
    }
    for (let h = 0; h <= n; h++) {
      if (h === d) continue;
      heads[d] = h;
      rec(d + 1);
    }
  };
  rec(1);
  return out;
}

function scoreOf(score: number[][], heads: number[]): number {
  return heads.slice(1).reduce((s, h, i) => s + (score[i + 1]?.[h] as number), 0);
}

function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const rel = (...names: string[]): RelationCandidate[] => names.map((relation, k) => ({ relation, prob: 0.9 - k * 0.1 }));

describe("maxSpanningTree", () => {
  it("finds the best single-root tree on random graphs (brute force, n ≤ 5)", () => {
    const rand = lcg(7);
    for (let trial = 0; trial < 120; trial++) {
      const n = 2 + (trial % 4);
      const score = Array.from({ length: n + 1 }, (_, d) =>
        Array.from({ length: n + 1 }, (_, h) => (d === 0 || h === d ? -Infinity : Math.log(rand() + 1e-3) * 3)),
      );
      const best = Math.max(...allTrees(n).map((t) => scoreOf(score, t)));
      const got = maxSpanningTree(score);
      expect(got.slice(1).filter((h) => h === 0)).toHaveLength(1);
      expect(scoreOf(score, got)).toBeCloseTo(best, 9);
    }
  });

  it("breaks a cycle", () => {
    // words 1 and 2 prefer each other; 3 prefers the root
    const L = Math.log;
    const score = [
      [-Infinity, -Infinity, -Infinity, -Infinity],
      [L(0.1), -Infinity, L(0.8), L(0.1)],
      [L(0.2), L(0.7), -Infinity, L(0.1)],
      [L(0.9), L(0.05), L(0.05), -Infinity],
    ];
    const heads = maxSpanningTree(score);
    expect(heads.slice(1)).toEqual([2, 3, 0]);
  });
});

describe("decodeArcTree", () => {
  it("decodes the argmax tree, root relation, and head probabilities", () => {
    // The dog barks : The→dog, dog→barks, barks→root
    const L = Math.log;
    const arc = [
      [L(0.05), -50, L(0.9), L(0.05)],
      [L(0.05), L(0.05), -50, L(0.9)],
      [L(0.9), L(0.05), L(0.05), -50],
    ];
    const t = decodeArcTree(arc, [rel("det", "nmod"), rel("nsubj", "obj"), rel("nsubj", ROOT_RELATION)]);
    expect(t.heads).toEqual([2, 3, 0]);
    expect(t.relations).toEqual(["det", "nsubj", ROOT_RELATION]);
    expect(t.repaired).toBe(false);
    expect(t.headProbs[0]).toBeCloseTo(0.9, 6);
  });

  it("keeps one root and never gives a non-root word the relation root", () => {
    const arc = [
      [5, 0, 0],
      [4, 0, 0],
    ];
    const t = decodeArcTree(arc, [rel(ROOT_RELATION, "nsubj"), rel(ROOT_RELATION, "obj")]);
    expect(t.heads.filter((h) => h === 0)).toHaveLength(1);
    expect(t.heads).toEqual([0, 1]);
    expect(t.relations).toEqual([ROOT_RELATION, "obj"]);
    expect(t.repairedWords).toEqual([1]);
  });

  it("falls back to dep when only root is offered for a non-root word", () => {
    const t = decodeArcTree([[3, 0, 0], [0, 3, 0]], [rel("nsubj"), rel(ROOT_RELATION)]);
    expect(t.relations).toEqual([ROOT_RELATION, REPAIR_RELATION]);
  });

  it("rejects malformed input", () => {
    expect(() => decodeArcTree([[0, 0]], [])).toThrow(/lengths differ/);
    expect(() => decodeArcTree([[0]], [rel("root")])).toThrow(/columns/);
    expect(decodeArcTree([], []).heads).toEqual([]);
  });
});

describe("confidence gating", () => {
  // The red dog barks . — heads: The→dog, red→dog, dog→barks, barks→root, .→barks
  const heads = [3, 3, 4, 0, 4];
  const upos = ["DET", "ADJ", "NOUN", "VERB", "PUNCT"];
  const rels = ["det", "amod", "nsubj", "root", "punct"];
  const words = ["The", "red", "dog", "barks", "."];
  const items = buildPhrases(heads, upos, rels);

  it("scores a bracket by the product of its non-head words' head probabilities", () => {
    const np = (items[0] as PhraseNode).children[0] as PhraseNode; // [The [red [dog]]]
    expect(bracketString([np], words)).toBe("[The [red [dog]]]");
    expect(bracketConfidence(np, [0.5, 0.8, 1, 1, 1])).toBeCloseTo(0.4, 9);
  });

  it("collapses brackets below the threshold and keeps the rest", () => {
    expect(bracketString(gatePhrases(items, [1, 1, 1, 1, 1], 0.9), words)).toBe(bracketString(items, words));
    const gated = gatePhrases(items, [0.5, 1, 1, 1, 1], 0.9);
    expect(bracketString(gated, words)).toBe("The [red [dog]] [barks] .");
  });
});
