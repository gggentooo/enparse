/**
 * src/modules/parser/ambiguity.test.ts — unit tests for alternative parses (T60)
 *
 * Covers: label alternatives from close group A candidates (BIO-valid only, ranked,
 * capped at MAX_ALTERNATIVES), PP-attachment alternatives (MST with the head fixed),
 * probabilities as shares with the primary parse, no alternatives when margins are clear.
 */

import { describe, expect, it } from "vitest";
import { MAX_ALTERNATIVES, buildAlternatives } from "./ambiguity";
import { repairBio } from "./bio";
import { arcFor } from "./testFixtures";
import { decodeArcTree } from "./treeDecoder";
import type { TaggedSentence, TaggedWord } from "./types";

const THRESHOLDS = { bracket: 0.5, role: 0.4 };

/** A word with group A candidates [label, prob][] (best first) and one relation. */
const word = (cands: [string, number][], relation: string): TaggedWord => {
  const [upos, chunkTag] = (cands[0]?.[0] ?? "X|O").split("|") as [string, string];
  return {
    upos,
    uposProb: cands[0]?.[1] ?? 1,
    chunkTag,
    chunkProb: cands[0]?.[1] ?? 1,
    candidates: cands.map(([l, prob]) => {
      const [u, c] = l.split("|") as [string, string];
      return { upos: u, chunkTag: c, prob };
    }),
    relations: [{ relation, prob: 0.9 }],
  };
};

function input(tagged: TaggedSentence, margins = { label: 0.3, attachment: 0.3 }) {
  const tree = decodeArcTree(
    tagged.arc,
    tagged.words.map((w) => w.relations),
  );
  return {
    tagged,
    tree,
    upos: tagged.words.map((w) => w.upos),
    chunkTags: repairBio(tagged.words.map((w) => w.chunkTag)),
    margins,
    thresholds: THRESHOLDS,
  };
}

describe("label alternatives", () => {
  // "Time flies": flies VERB (0.55) vs NOUN (0.45); Time NOUN certain.
  const tagged: TaggedSentence = {
    words: [
      word([["NOUN|B-NP", 0.95]], "nsubj"),
      word(
        [
          ["VERB|B-VP", 0.55],
          ["NOUN|I-NP", 0.45],
        ],
        "root",
      ),
    ],
    arc: arcFor([2, 0]),
  };

  it("switches a close word to its second label, with changes, chunks, and phrases", () => {
    const [alt, ...rest] = buildAlternatives(input(tagged));
    expect(rest).toEqual([]);
    expect(alt?.reason).toBe("probability");
    expect(alt?.changes).toEqual([{ index: 1, upos: "NOUN", chunkTag: "I-NP" }]);
    expect(alt?.chunks).toEqual([{ type: "NP", start: 0, end: 1 }]);
    expect(alt?.phrases).not.toBeNull();
    // Share among {primary, alt}: ratio 0.45/0.55 over 1 + ratio.
    const r = 0.45 / 0.55;
    expect(alt?.probability).toBeCloseTo(r / (1 + r), 9);
  });

  it("gives no alternatives when the top label is clear, and none without a nested view still lists chunks", () => {
    expect(buildAlternatives(input(tagged, { label: 0.05, attachment: 0.3 }))).toEqual([]);
    const flat = buildAlternatives({ ...input(tagged), thresholds: null });
    expect(flat[0]?.phrases).toBeNull();
    expect(flat[0]?.chunks.length).toBe(1);
  });

  it("drops BIO-invalid combinations and caps the list at MAX_ALTERNATIVES", () => {
    // Word 0's second label I-NP at the sentence start is invalid alone (a stray I-X).
    const w = (): TaggedWord =>
      word(
        [
          ["NOUN|B-NP", 0.5],
          ["VERB|B-VP", 0.4],
        ],
        "dep",
      );
    const invalidFirst: TaggedSentence = {
      words: [
        word(
          [
            ["NOUN|B-NP", 0.5],
            ["NOUN|I-NP", 0.45],
          ],
          "root",
        ),
      ],
      arc: arcFor([0]),
    };
    expect(buildAlternatives(input(invalidFirst))).toEqual([]);
    const many: TaggedSentence = { words: [w(), w(), w(), w()], arc: arcFor([0, 1, 1, 1]) };
    const alts = buildAlternatives(input(many));
    expect(alts).toHaveLength(MAX_ALTERNATIVES); // 2^4 − 1 = 15 candidates
    expect(alts.map((a) => a.rank)).toEqual([1, 2, 3, 4, 5]);
    const probs = alts.map((a) => a.probability);
    expect([...probs].sort((a, b) => b - a)).toEqual(probs);
    expect(probs.reduce((a, b) => a + b, 0)).toBeLessThan(1);
  });
});

describe("attachment alternatives", () => {
  // I saw the man with the telescope: "telescope" (obl, case "with") → saw 0.5 vs man 0.4.
  const heads = [2, 0, 4, 2, 7, 7, 2];
  const rels = ["nsubj", "root", "det", "obj", "case", "det", "obl"];
  const upos = ["PRON", "VERB", "DET", "NOUN", "ADP", "DET", "NOUN"];
  const chunks = ["B-NP", "B-VP", "B-NP", "I-NP", "B-PP", "I-PP", "I-PP"];
  const arc = arcFor(heads).map((row, i) =>
    i === 6
      ? row.map((_, j) => (j === 7 ? -1e9 : j === 2 ? Math.log(0.5) : j === 4 ? Math.log(0.4) : Math.log(0.02)))
      : row,
  );
  const tagged: TaggedSentence = {
    words: upos.map((u, i) => word([[`${u}|${chunks[i]}`, 0.99]], rels[i] as string)),
    arc,
  };

  it("offers the other head of a close PP attachment as an alternative tree", () => {
    const alts = buildAlternatives(input(tagged));
    expect(alts).toHaveLength(1);
    const [alt] = alts;
    expect(alt?.reason).toBe("attachment");
    expect(alt?.changes).toEqual([{ index: 6, head: 3 }]); // telescope → man (0-based 3)
    expect(alt?.probability).toBeCloseTo(0.4 / 0.5 / (1 + 0.4 / 0.5), 6);
    expect(alt?.phrases).not.toBeNull();
  });

  it("ignores words that are not PPs or whose heads are clear", () => {
    expect(buildAlternatives(input(tagged, { label: 0.3, attachment: 0.05 }))).toEqual([]);
    const noCase = {
      ...tagged,
      words: tagged.words.map((w, i) => (i === 4 ? { ...w, relations: [{ relation: "det", prob: 0.9 }] } : w)),
    };
    expect(buildAlternatives(input(noCase))).toEqual([]);
  });
});
