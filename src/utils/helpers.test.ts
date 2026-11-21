/**
 * src/utils/helpers.test.ts — unit tests for string, date, and timing helpers (T28)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collapseWhitespace,
  debounce,
  foldCase,
  formatIsoDate,
  formatIsoTimestamp,
  lookupKey,
  throttle,
} from "./helpers";

describe("strings", () => {
  it("collapses all whitespace, including Unicode spaces and line breaks", () => {
    expect(collapseWhitespace("  a \t b\n\n c  d  ")).toBe("a b c d");
    expect(collapseWhitespace("   ")).toBe("");
  });

  it("folds case with NFKC (full-width, ligatures) and keeps non-Latin text", () => {
    expect(foldCase("ＦＩＬＥ")).toBe("file");
    expect(foldCase("ﬁle")).toBe("file");
    expect(foldCase("Straße")).toBe("straße");
    expect(foldCase("한국어")).toBe("한국어");
    expect(lookupKey("  Run   Away ")).toBe("run away");
  });
});

describe("dates", () => {
  it("formats UTC ISO dates and timestamps and rejects invalid dates", () => {
    const d = new Date(Date.UTC(2026, 0, 5, 3, 4, 5, 678));
    expect(formatIsoDate(d)).toBe("2026-01-05");
    expect(formatIsoTimestamp(d)).toBe("2026-01-05T03:04:05Z");
    expect(() => formatIsoDate(new Date("nope"))).toThrow(RangeError);
  });
});

describe("debounce and throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounce calls once after the last call, with the last arguments; cancel drops it", () => {
    const fn = vi.fn<(x: number) => void>();
    const d = debounce(fn, 100);
    d(1);
    vi.advanceTimersByTime(50);
    d(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
    d(3);
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throttle fires on the leading edge and once more at the end of the window", () => {
    const fn = vi.fn<(x: number) => void>();
    const t = throttle(fn, 100);
    t(1);
    t(2);
    t(3);
    expect(fn.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([[1], [3]]);
    vi.advanceTimersByTime(100);
    t(4);
    expect(fn.mock.calls).toEqual([[1], [3], [4]]);
    t(5);
    t.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
