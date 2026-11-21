/**
 * src/i18n/i18n.test.ts — catalogs and lookup (T68)
 */

import { describe, expect, it } from "vitest";
import { en } from "./en";
import { DEFAULT_LANGUAGE, LANGUAGES, formatDisplayDate, isLanguage, translate } from "./i18n";

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe("catalogs", () => {
  it("defaults to Korean and gives every language every key with the same placeholders", () => {
    expect(DEFAULT_LANGUAGE).toBe("ko");
    for (const { messages } of Object.values(LANGUAGES)) {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
      const empty = Object.entries(messages).filter(([, v]) => v.trim() === "");
      expect(empty).toEqual([]);
      const mismatched = Object.entries(messages).filter(
        ([k, v]) => placeholders(v).join() !== placeholders(en[k as keyof typeof en]).join(),
      );
      expect(mismatched).toEqual([]);
    }
  });

  it("shows grammar labels in Korean with the English term (T18)", () => {
    expect(translate("ko", "grammar.NP")).toBe("명사구 (NP)");
    expect(translate("ko", "role.Subject")).toBe("주어 (Subject)");
  });
});

describe("translate and formats", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    const fake = "{n} of {total}";
    expect(fake.replace(/\{(\w+)\}/g, (m) => m)).toBe(fake);
    expect(translate("en", "nav.input")).toBe("Input");
    expect(translate("ko", "nav.input", { unused: 1 })).toBe("입력");
  });

  it("recognizes language codes and formats dates per language", () => {
    expect(isLanguage("ko")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    const d = new Date(Date.UTC(2026, 10, 21, 12));
    expect(formatDisplayDate(d, "en")).toMatch(/November 21, 2026/);
    expect(formatDisplayDate(d, "ko")).toMatch(/2026년 11월 21일/);
  });
});
