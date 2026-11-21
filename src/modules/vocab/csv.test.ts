/**
 * src/modules/vocab/csv.test.ts — CSV codec (T40)
 */

import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes, and line breaks, and round-trips Korean text", () => {
    const rows = [
      ["word", "notes"],
      ["run", 'says "hi", then\nleaves'],
      ["달리다", ""],
    ];
    const text = toCsv(rows);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain('"says ""hi"", then\nleaves"');
    expect(parseCsv(text)).toEqual(rows);
  });

  it("accepts LF line ends and skips blank lines; rejects an unterminated quote", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(() => parseCsv('a,"b\n')).toThrow(SyntaxError);
  });
});
