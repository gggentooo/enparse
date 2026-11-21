/**
 * src/services/subwordService.test.ts — subword service: lazy known words, cache, retry (T41)
 */

import { describe, expect, it, vi } from "vitest";
import { createSubwordService } from "./subwordService";

describe("subwordService", () => {
  it("loads the known-word list once and caches results", async () => {
    const load = vi.fn<() => Promise<{ isKnownWord: (w: string) => boolean }>>(async () => ({
      isKnownWord: (w: string) => ["happy", "happiness", "unhappy"].includes(w),
    }));
    const s = createSubwordService(load);
    const a = await s.segmentWord("unhappiness", null);
    const b = await s.segmentWord("unhappiness", null);
    expect(a).toBe(b);
    expect(a.segments.map((x) => x.text)).toEqual(["un", "happy", "ness"]);
    await s.segmentWord("happy", null);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries loading after a failure", async () => {
    let calls = 0;
    const s = createSubwordService(async () => {
      if (calls++ === 0) throw new Error("chunk failed");
      return { isKnownWord: () => false };
    });
    await expect(s.segmentWord("x", null)).rejects.toThrow("chunk failed");
    expect((await s.segmentWord("x", null)).segments).toHaveLength(1);
  });

  it("uses the bundled NGSL list by default", async () => {
    const { createSubwordService: create } = await import("./subwordService");
    expect((await create().segmentWord("teachers", "teacher")).segments.map((x) => x.kind)).toEqual([
      "base",
      "suffix",
      "inflection",
    ]);
  });
});
