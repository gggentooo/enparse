/**
 * src/modules/parser/treeDecoder.test.ts — unit tests for tree decoding and nested phrases
 *
 * Covers: label parsing and head resolution (rel_pos_v1), best-candidate
 * decoding, root repair (none / several), cycle repair, unresolvable heads,
 * the documented bracketing examples (phrase-per-head; T75), clause /
 * predicate / complement levels, PP labels, punctuation placement,
 * non-projective trees, and phrase spans; MST decoding over arc scores
 * (optimality against brute force on small random sentences, single root,
 * relations, head distributions) and span confidence.
 */

import { describe, expect, it } from "vitest";
import {
  REPAIR_RELATION,
  ROOT_LABEL,
  ROOT_RELATION,
  bracketString,
  buildPhrases,
  decodeArcTree,
  decodeTree,
  maxSpanningTree,
  parseDepLabel,
  phraseSpans,
  projectiveTree,
  resolveHead,
  spanConfidence,
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
      const sentUpos = Array.from({ length: n }, () => tags[rand(tags.length)] as string);
      const cands = sentUpos.map(() =>
        Array.from({ length: 1 + rand(5) }, (_, k) => {
          const off = rand(7) - 3;
          const label = off === 0 ? ROOT_LABEL : `${off > 0 ? "+" : ""}${off}@${tags[rand(tags.length)]}|dep`;
          return c(label, 1 / (k + 1));
        }),
      );
      const t = decodeTree(cands, sentUpos);
      expect(t.heads.filter((h) => h === 0)).toHaveLength(1);
      for (let i = 0; i < n; i++) {
        // following heads from every word reaches the root without revisiting a word
        const seen = new Set<number>();
        for (let k = i + 1; k !== 0; k = t.heads[k - 1] ?? 0) {
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
      }
      expect(() => buildPhrases(t.heads, sentUpos, t.relations)).not.toThrow();
    }
  });

  it("handles empty sentences", () => {
    expect(decodeTree([], []).heads).toEqual([]);
  });
});

describe("buildPhrases", () => {
  const levels = (items: ReturnType<typeof buildPhrases>): string[] => {
    const out: string[] = [];
    const walk = (x: (typeof items)[number]): void => {
      if ("word" in x) return;
      out.push(`${x.level}:${x.start}-${x.end}`);
      x.children.forEach(walk);
    };
    items.forEach(walk);
    return out;
  };

  it("reproduces the documented example: one bracket per phrase; the main clause is its subject and predicate brackets", () => {
    const words = ["The", "red", "dog", "rarely", "barks", "loudly", "."];
    const upos = ["DET", "ADJ", "NOUN", "ADV", "VERB", "ADV", "PUNCT"];
    const rel = ["det", "amod", "nsubj", "advmod", "root", "advmod", "punct"];
    const items = buildPhrases([3, 3, 5, 5, 0, 5, 5], upos, rel);
    expect(bracketString(items, words)).toBe("[The red dog] [rarely barks loudly] .");
    expect(bracketString(items, words, true)).toBe("[NP The red dog] [VP rarely barks loudly] .");
    expect(levels(items)).toEqual(["phrase:0-2", "predicate:3-5"]);
  });

  it("brackets a copular clause as subject + [cop [complement]]", () => {
    const words = "Mackerel is a common name given to fish .".split(" ");
    const upos = "NOUN AUX DET ADJ NOUN VERB ADP NOUN PUNCT".split(" ");
    const rel = "nsubj cop det amod root acl case obl punct".split(" ");
    const items = buildPhrases([5, 5, 5, 5, 0, 5, 8, 6, 5], upos, rel);
    expect(bracketString(items, words)).toBe("[Mackerel] [is [a common name [given [to fish]]]] .");
    expect(bracketString(items, words, true)).toBe(
      "[NP Mackerel] [VP is [NP a common name [VP given [PP to fish]]]] .",
    );
    expect(levels(items)).toEqual(["phrase:0-0", "predicate:1-7", "complement:2-7", "phrase:5-7", "phrase:6-7"]);
  });

  it("keeps auxiliaries flat in the predicate; a main clause's one-word subject and predicate are bracketed", () => {
    const words = ["He", "has", "been", "given", "a", "book"];
    const upos = ["PRON", "AUX", "AUX", "VERB", "DET", "NOUN"];
    const rel = ["nsubj", "aux", "aux", "root", "det", "obj"];
    expect(bracketString(buildPhrases([4, 4, 4, 0, 6, 4], upos, rel), words)).toBe("[He] [has been given [a book]]");
    expect(bracketString(buildPhrases([2, 0], ["PRON", "VERB"], ["nsubj", "root"]), ["He", "runs"])).toBe(
      "[He] [runs]",
    );
  });

  it("keeps words before the subject outside the predicate (question, fronted adverb)", () => {
    const upos = ["AUX", "DET", "NOUN", "VERB", "ADV", "PUNCT"];
    const rel = ["aux", "det", "nsubj", "root", "advmod", "punct"];
    const words = ["Does", "the", "dog", "bark", "loudly", "?"];
    expect(bracketString(buildPhrases([4, 3, 4, 0, 4, 4], upos, rel), words)).toBe("Does [the dog] [bark loudly] ?");
  });

  it("brackets coordinated phrases side by side, with the conjunction between them", () => {
    const words = "She likes red apples and green pears".split(" ");
    const upos = "PRON VERB ADJ NOUN CCONJ ADJ NOUN".split(" ");
    const rel = "nsubj root amod obj cc amod conj".split(" ");
    const items = buildPhrases([2, 0, 4, 2, 7, 7, 4], upos, rel);
    expect(bracketString(items, words)).toBe("[She] [likes [[red apples] and [green pears]]]");
    expect(levels(items)).toEqual(["phrase:0-0", "predicate:1-6", "phrase:2-6", "conjunct:2-3", "phrase:5-6"]);
    // One-word conjuncts stay plain words; a sentence-initial conjunction stays outside.
    const short = buildPhrases(
      [3, 3, 0, 5, 3],
      ["CCONJ", "PRON", "VERB", "CCONJ", "VERB"],
      ["cc", "nsubj", "root", "cc", "conj"],
    );
    expect(bracketString(short, ["And", "he", "sings", "and", "dances"])).toBe("And [he] [sings and dances]");
  });

  it("gives a clause coordinated with the main clause its own subject and predicate brackets", () => {
    const words = "He ran , and she walked home .".split(" ");
    const upos = "PRON VERB PUNCT CCONJ PRON VERB ADV PUNCT".split(" ");
    const rel = "nsubj root punct cc nsubj conj advmod punct".split(" ");
    const items = buildPhrases([2, 0, 6, 6, 6, 2, 6, 2], upos, rel);
    expect(bracketString(items, words)).toBe("[He] [ran] , and [she] [walked home] .");
  });

  it("labels a nominal with a case dependent as PP; the preposition stays inside its noun's phrase", () => {
    const words = ["the", "man", "in", "the", "car"];
    const upos = ["DET", "NOUN", "ADP", "DET", "NOUN"];
    const rel = ["det", "root", "case", "det", "nmod"];
    const items = buildPhrases([2, 0, 5, 5, 2], upos, rel);
    expect(bracketString(items, words)).toBe("[the man [in the car]]");
    expect(bracketString(items, words, true)).toBe("[NP the man [PP in the car]]");
  });

  it("keeps punctuation in the innermost bracket of its head that surrounds it", () => {
    const words = ["Paris", ",", "France", ",", "rocks", "."];
    const upos = ["PROPN", "PUNCT", "PROPN", "PUNCT", "VERB", "PUNCT"];
    const rel = ["nsubj", "punct", "appos", "punct", "root", "punct"];
    // "," (1) and "," (3) depend on France, "." on the root.
    const items = buildPhrases([5, 3, 1, 3, 0, 5], upos, rel);
    expect(bracketString(items, words)).toBe("[Paris , France ,] [rocks] .");
    // Punctuation between a head's words goes inside that head's bracket.
    const inner = buildPhrases([4, 1, 1, 0], ["PROPN", "PUNCT", "PROPN", "VERB"], ["nsubj", "punct", "appos", "root"]);
    expect(bracketString(inner, ["Paris", ",", "France", "rocks"])).toBe("[Paris , France] [rocks]");
  });

  it("marks discontinuous phrases in non-projective trees", () => {
    // word 0 depends on word 2, word 1 on word 3: crossing arcs
    const items = buildPhrases([3, 4, 0, 3], ["NOUN", "NOUN", "VERB", "VERB"], ["nsubj", "obj", "root", "ccomp"]);
    expect(phraseSpans(items).length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).toContain('"contiguous":false');
  });

  it("lists every bracket as a span; a single word is not a bracket", () => {
    expect(phraseSpans(buildPhrases([2, 0], ["ADJ", "NOUN"], ["amod", "root"]))).toEqual([
      { type: "NP", start: 0, end: 1 },
    ]);
    expect(buildPhrases([0], ["NOUN"], ["root"])).toEqual([{ word: 0 }]);
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

const rel = (...names: string[]): RelationCandidate[] =>
  names.map((relation, k) => ({ relation, prob: 0.9 - k * 0.1 }));

describe("maxSpanningTree", () => {
  it("finds the best single-root tree on random graphs (brute force, n ≤ 5)", () => {
    const rand = lcg(7);
    for (let trial = 0; trial < 120; trial++) {
      const n = 2 + (trial % 4);
      const score = Array.from({ length: n + 1 }, (_, d) =>
        Array.from({ length: n + 1 }, (__, h) => (d === 0 || h === d ? -Infinity : Math.log(rand() + 1e-3) * 3)),
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

describe("projectiveTree", () => {
  const crossing = (heads: number[]): boolean => {
    const arcs = heads.slice(1).map((h, d) => [Math.min(h, d + 1), Math.max(h, d + 1)] as const);
    return arcs.some(([a, b]) => arcs.some(([x, y]) => a < x && x < b && b < y));
  };

  it("finds the best single-root tree without crossing arcs on random graphs (brute force, n ≤ 5)", () => {
    const rand = lcg(11);
    for (let trial = 0; trial < 150; trial++) {
      const n = 1 + Math.floor(rand() * 5);
      const score = Array.from({ length: n + 1 }, () => Array.from({ length: n + 1 }, () => Math.log(rand() + 1e-6)));
      const best = Math.max(
        ...allTrees(n)
          .filter((t) => !crossing(t))
          .map((t) => scoreOf(score, t)),
      );
      const got = projectiveTree(score) as number[];
      expect(crossing(got)).toBe(false);
      expect(got.slice(1).filter((h) => h === 0)).toHaveLength(1);
      expect(scoreOf(score, got)).toBeCloseTo(best, 9);
    }
  });

  it("equals the spanning tree when that has no crossing arcs, and returns null when nothing is possible", () => {
    const L = Math.log;
    // the dog barks: the→dog, dog→barks, barks→root
    const score = [
      [-Infinity, -Infinity, -Infinity, -Infinity],
      [L(0.01), -Infinity, L(0.98), L(0.01)],
      [L(0.01), L(0.01), -Infinity, L(0.98)],
      [L(0.98), L(0.01), L(0.01), -Infinity],
    ];
    expect(projectiveTree(score)).toEqual(maxSpanningTree(score));
    const none = [
      [-Infinity, -Infinity],
      [-Infinity, -Infinity],
    ];
    expect(projectiveTree(none)).toBeNull();
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
    const t = decodeArcTree(
      [
        [3, 0, 0],
        [0, 3, 0],
      ],
      [rel("nsubj"), rel(ROOT_RELATION)],
    );
    expect(t.relations).toEqual([ROOT_RELATION, REPAIR_RELATION]);
  });

  it("rejects malformed input", () => {
    expect(() => decodeArcTree([[0, 0]], [])).toThrow(/lengths differ/);
    expect(() => decodeArcTree([[0]], [rel("root")])).toThrow(/columns/);
    expect(decodeArcTree([], []).heads).toEqual([]);
  });
});

describe("spanConfidence", () => {
  // The red dog barks . — heads: The→dog, red→dog, dog→barks, barks→root, .→barks
  const heads = [3, 3, 4, 0, 4];
  const upos = ["DET", "ADJ", "NOUN", "VERB", "PUNCT"];
  const rels = ["det", "amod", "nsubj", "root", "punct"];
  const items = buildPhrases(heads, upos, rels);
  const np = items[0] as PhraseNode; // [The red dog]
  const isPunct = (w: number): boolean => upos[w] === "PUNCT";

  /** Point-mass distributions on the chosen heads, with overrides per word: [column, probability][]. */
  const tree = (over: Record<number, [number, number][]> = {}) => {
    const headDist = heads.map((h, w) => {
      const row = new Array<number>(heads.length + 1).fill(0);
      row[h] = 1;
      for (const [col, p] of over[w] ?? []) row[col] = p;
      return row;
    });
    return { heads, headProbs: headDist.map((row, w) => row[heads[w] as number] as number), headDist };
  };

  it("is 1 when every word is sure of its head", () => {
    expect(spanConfidence(np, tree(), isPunct)).toBe(1);
  });

  it("ignores an unsure attachment whose alternatives stay inside the bracket", () => {
    // "red": 0.6 dog, 0.4 The — both inside [The red dog].
    expect(
      spanConfidence(
        np,
        tree({
          1: [
            [3, 0.6],
            [1, 0.4],
          ],
        }),
        isPunct,
      ),
    ).toBeCloseTo(1, 9);
  });

  it("counts an inside word that may attach outside, the head word that may attach inside, and an outside word that may attach inside", () => {
    // "red" may attach to "barks" (outside).
    expect(
      spanConfidence(
        np,
        tree({
          1: [
            [3, 0.6],
            [4, 0.4],
          ],
        }),
        isPunct,
      ),
    ).toBeCloseTo(0.6, 9);
    // "dog" (the head word) may attach to "The" (inside).
    expect(
      spanConfidence(
        np,
        tree({
          2: [
            [4, 0.7],
            [1, 0.3],
          ],
        }),
        isPunct,
      ),
    ).toBeCloseTo(0.7, 9);
    // "barks" (outside, head outside) may attach to "dog" (inside).
    expect(
      spanConfidence(
        np,
        tree({
          3: [
            [0, 0.8],
            [3, 0.2],
          ],
        }),
        isPunct,
      ),
    ).toBeCloseTo(0.8, 9);
  });

  it("does not count punctuation or outside words attached into the bracket", () => {
    const clause = { children: items.filter((x) => !("word" in x && x.word === 4)) }; // every word but "."
    const predicateLike = { children: [{ word: 3 }] }; // "barks" alone: "dog" attaches into it
    expect(
      spanConfidence(
        predicateLike,
        tree({
          2: [
            [4, 0.5],
            [0, 0.5],
          ],
        }),
        isPunct,
      ),
    ).toBe(1);
    expect(
      spanConfidence(
        clause,
        tree({
          4: [
            [4, 0.5],
            [0, 0.5],
          ],
        }),
        isPunct,
      ),
    ).toBe(1);
  });

  it("falls back to the chosen-head probabilities of the inside words without distributions", () => {
    expect(spanConfidence(np, { heads, headProbs: [0.5, 0.8, 1, 1, 1] })).toBeCloseTo(0.4, 9);
  });
});
