/**
 * src/modules/parser/winkBackend.test.ts — unit tests for runtime word splitting
 *
 * Covers: empty input, offsets, sentence split, contraction splitting (always),
 * hyphenated words (always one word), URLs and e-mail addresses (one word, no
 * sentence break inside), symbol runs, non-contraction apostrophes.
 */

import { describe, expect, it } from "vitest";
import { protectedSpans, tokenize } from "./winkBackend";

const words = (text: string): string[] => tokenize(text).flatMap((s) => s.words.map((w) => w.text));

describe("tokenize", () => {
  it("returns no sentences for empty or blank input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("gives offsets that slice back to each word", () => {
    const text = "I'm sure it's fine, isn't it? Here's John's AK-47.";
    for (const s of tokenize(text)) {
      for (const w of s.words) expect(text.slice(w.start, w.end)).toBe(w.text);
      expect(s.start).toBe(s.words[0]?.start);
    }
  });

  it("splits sentences", () => {
    expect(tokenize("He left. She stayed.").map((s) => s.words.map((w) => w.text))).toEqual([
      ["He", "left", "."],
      ["She", "stayed", "."],
    ]);
  });

  it("always splits contractions, including ones wink keeps whole", () => {
    expect(words("I'm sure it's fine, isn't it? Here's one.")).toEqual([
      "I", "'m", "sure", "it", "'s", "fine", ",", "is", "n't", "it", "?", "Here", "'s", "one", ".",
    ]);
    expect(words("You'll see they'd gone; we've said I can't and won't.")).toEqual([
      "You", "'ll", "see", "they", "'d", "gone", ";", "we", "'ve", "said", "I", "ca", "n't", "and",
      "wo", "n't", ".",
    ]);
  });

  it("splits possessive 's", () => {
    expect(words("John's AK-47's sights")).toEqual(["John", "'s", "AK-47", "'s", "sights"]);
  });

  it("keeps hyphenated words as one word, even when wink splits them", () => {
    expect(words("These mis-matches are well-known F-16-launched cases.")).toEqual([
      "These", "mis-matches", "are", "well-known", "F-16-launched", "cases", ".",
    ]);
  });

  it("does not merge spaced or doubled dashes", () => {
    expect(words("yes - no -- maybe")).toEqual(["yes", "-", "no", "--", "maybe"]);
  });

  it("leaves non-contraction apostrophes alone", () => {
    expect(words("y'all O'Neil")).toEqual(["y'all", "O'Neil"]);
  });

  it("keeps an e-mail address whole", () => {
    expect(words("mail a@b.com now")).toEqual(["mail", "a@b.com", "now"]);
  });
});

describe("URLs, e-mail addresses, and symbol runs", () => {
  it("keeps URLs whole and does not end a sentence inside them", () => {
    const text = "Visit www.juancole.com or http://digon_va.tripod.com/Chernobyl.htm today.";
    const sents = tokenize(text);
    expect(sents).toHaveLength(1);
    expect(sents[0]?.words.map((w) => w.text)).toEqual([
      "Visit", "www.juancole.com", "or", "http://digon_va.tripod.com/Chernobyl.htm", "today", ".",
    ]);
  });

  it("leaves sentence-final punctuation outside a URL", () => {
    expect(words("See http://home.enron.com/meeting.")).toEqual(["See", "http://home.enron.com/meeting", "."]);
  });

  it("keeps bare domains and e-mail addresses, including hosts without a dot", () => {
    expect(words("Write to Warner@ENRON or bob@paulhastings.com via paulhastings.com now")).toEqual([
      "Write", "to", "Warner@ENRON", "or", "bob@paulhastings.com", "via", "paulhastings.com", "now",
    ]);
  });

  it("does not treat missing-space typos as URLs", () => {
    expect(protectedSpans("I was done.It was late. Seoul.Com is not one.")).toEqual([]);
  });

  it("keeps runs of one repeated symbol as one word", () => {
    expect(words("Wait ......... then *** and ---------")).toEqual(["Wait", ".........", "then", "***", "and", "---------"]);
  });

  it("does not join different symbols", () => {
    expect(words("Really?! Yes.")).toEqual(["Really", "?", "!", "Yes", "."]);
  });
});
