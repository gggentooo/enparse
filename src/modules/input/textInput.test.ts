/**
 * src/modules/input/textInput.test.ts — unit tests for the preprocessor
 *
 * Covers: empty input, max length, non-Latin removal, emoji removal, control
 * characters, quote/dash mapping, NFKC, whitespace and paragraph handling.
 */

import { describe, expect, it } from "vitest";
import { InputTooLongError, MAX_INPUT_CHARS, normalizeChars, preprocess } from "./index";

describe("preprocess", () => {
  it("returns empty text for empty input", () => {
    const r = preprocess("");
    expect(r.text).toBe("");
    expect(r.hasRemovals).toBe(false);
  });

  it("accepts exactly MAX_INPUT_CHARS and rejects one more without truncating", () => {
    expect(preprocess("a".repeat(MAX_INPUT_CHARS)).cleanLength).toBe(MAX_INPUT_CHARS);
    expect(() => preprocess("a".repeat(MAX_INPUT_CHARS + 1))).toThrow(InputTooLongError);
    const err = ((): unknown => {
      try {
        preprocess("a".repeat(MAX_INPUT_CHARS + 1));
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(InputTooLongError);
    expect((err as InputTooLongError).length).toBe(MAX_INPUT_CHARS + 1);
  });

  it("counts length in code points, not UTF-16 units", () => {
    expect(() => preprocess("😀".repeat(10), 10)).not.toThrow();
  });

  it("removes Hangul, CJK, Cyrillic, and Greek and reports them", () => {
    const r = preprocess("I love 서울 and 東京 and Москва and αβ.");
    expect(r.text).toBe("I love and and and .");
    expect(r.removed.nonLatin.count).toBe(12);
    expect(r.removed.nonLatin.samples).toEqual(["서울", "東京", "Москва", "αβ"]);
    expect(r.hasRemovals).toBe(true);
  });

  it("keeps Latin letters with diacritics", () => {
    expect(preprocess("café naïve Ångström").text).toBe("café naïve Ångström");
  });

  it("removes emoji including skin tones, joiners, and flags", () => {
    const r = preprocess("Great 👍🏽 job 👨‍👩‍👧 from 🇰🇷 !");
    expect(r.text).toBe("Great job from !");
    expect(r.removed.emoji.samples).toEqual(["👍🏽", "👨‍👩‍👧", "🇰🇷"]);
  });

  it("strips control and zero-width characters", () => {
    const r = preprocess("zero​width\u0007 bell");
    expect(r.text).toBe("zerowidth bell");
    expect(r.removed.control.count).toBe(2);
  });

  it("maps curly quotes and dashes to ASCII", () => {
    expect(preprocess("“It’s 1990–2000—maybe”").text).toBe('"It\'s 1990-2000--maybe"');
  });

  it("applies NFKC (full-width forms, ligatures)", () => {
    expect(preprocess("ＡＢＣ ﬁne").text).toBe("ABC fine");
  });

  it("collapses spaces, joins single line breaks, keeps paragraph breaks", () => {
    expect(preprocess("  one   two\nthree\r\n\r\n\n four  ").text).toBe("one two three\n\nfour");
  });
});

describe("normalizeChars", () => {
  it("normalizes characters without removing anything", () => {
    expect(normalizeChars("Kerry’s ＡＢ 서울")).toBe("Kerry's AB 서울");
  });
});
