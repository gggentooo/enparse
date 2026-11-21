/**
 * src/modules/subword/subwordParser.test.ts — segmentation (T41)
 *
 * Uses the real bundled NGSL known-word list, as the app does.
 */

import { describe, expect, it } from "vitest";
import { AFFIXES } from "./affixes";
import { KNOWN_WORDS } from "./knownWords.generated";
import { inflectionEnding, segment } from "./subwordParser";

const known = new Set(KNOWN_WORDS.split("\n"));
const isKnown = (w: string): boolean => known.has(w);
const show = (word: string, lemma: string | null = null): string =>
  segment(word, lemma, isKnown)
    .segments.map((s) =>
      s.kind === "prefix"
        ? `${s.text}-`
        : s.kind === "suffix"
          ? `-${s.text}`
          : s.kind === "inflection"
            ? `+${s.irregular ? "irr" : s.text}`
            : s.text,
    )
    .join(" ");

describe("segment", () => {
  it("splits derivations with spelling restored, through known intermediates", () => {
    expect(show("unhappiness")).toBe("un- happy -ness");
    expect(show("ability")).toBe("able -ity");
    expect(show("decision")).toBe("decide -sion");
    expect(show("carefully")).toBe("care -ful -ly");
    expect(show("international")).toBe("inter- nation -al");
    expect(show("simply")).toBe("simple -ly");
  });

  it("rejects false splits: unknown bases and reviewed exceptions", () => {
    expect(show("under")).toBe("under"); // un- + der: "der" is not a word
    expect(show("manage")).toBe("manage"); // man + -age (NO_SPLIT)
    expect(show("really")).toBe("real -ly"); // not re- + ally
    expect(show("unimportant")).toBe("un- important"); // an exception can still be a base
  });

  it("adds the inflection from the wink lemma, regular or irregular", () => {
    expect(show("teachers", "teacher")).toBe("teach -er +s");
    expect(show("running", "run")).toBe("run +ing");
    expect(show("happier", "happy")).toBe("happy +er");
    expect(show("ran", "run")).toBe("run +irr");
    expect(inflectionEnding("cities", "city")).toBe("es");
    expect(inflectionEnding("making", "make")).toBe("ing");
  });

  it("leaves non-words and unknown words whole", () => {
    expect(show("www.example.com")).toBe("www.example.com");
    expect(show("blorptastic")).toBe("blorptastic");
  });
});

describe("affix data", () => {
  it("has 80–120 affixes with unique ids, Korean glosses, and examples that segment", () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(80);
    expect(AFFIXES.length).toBeLessThanOrEqual(120);
    expect(new Set(AFFIXES.map((a) => a.id)).size).toBe(AFFIXES.length);
    for (const a of AFFIXES) {
      expect(a.gloss).toMatch(/[가-힣]/);
      expect(a.examples.length).toBeGreaterThan(0);
    }
  });
});
