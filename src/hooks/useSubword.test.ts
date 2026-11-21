// @vitest-environment jsdom
/**
 * src/hooks/useSubword.test.ts — useSubword over a mocked subwordService (T49)
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubwordSegmentation, SubwordService } from "../services/subwordService";
import { useSubword } from "./useSubword";

afterEach(cleanup);

const seg = (word: string): SubwordSegmentation => ({ word }) as unknown as SubwordSegmentation;

/** Service whose responses the test resolves in any order. */
function mockService() {
  const pending = new Map<string, { resolve: (s: SubwordSegmentation) => void; reject: (e: Error) => void }>();
  const service: SubwordService = {
    segmentWord: vi.fn<SubwordService["segmentWord"]>(
      (word) => new Promise((resolve, reject) => pending.set(word, { resolve, reject })),
    ),
  };
  const settle = async (word: string, outcome: SubwordSegmentation | Error): Promise<void> => {
    await act(async () => {
      const p = pending.get(word);
      if (outcome instanceof Error) p?.reject(outcome);
      else p?.resolve(outcome);
    });
  };
  return { service, settle };
}

describe("useSubword", () => {
  it("segments a word with loading state", async () => {
    const m = mockService();
    const { result } = renderHook(() => useSubword(m.service));
    expect(result.current).toMatchObject({ segmentation: null, isLoading: false, error: null });
    act(() => result.current.segment("unhappiness", "unhappiness"));
    expect(result.current.isLoading).toBe(true);
    expect(m.service.segmentWord).toHaveBeenCalledWith("unhappiness", "unhappiness");
    await m.settle("unhappiness", seg("unhappiness"));
    expect(result.current).toMatchObject({ segmentation: seg("unhappiness"), isLoading: false, error: null });
  });

  it("ignores a stale response when the selection changes", async () => {
    const m = mockService();
    const { result } = renderHook(() => useSubword(m.service));
    act(() => result.current.segment("first", null));
    act(() => result.current.segment("second", null));
    await m.settle("second", seg("second"));
    await m.settle("first", seg("first"));
    expect(result.current.segmentation).toEqual(seg("second"));
  });

  it("keeps errors, and clear() drops the result and any running request", async () => {
    const m = mockService();
    const { result } = renderHook(() => useSubword(m.service));
    act(() => result.current.segment("bad", null));
    await m.settle("bad", new Error("known words failed to load"));
    expect(result.current.error?.message).toBe("known words failed to load");

    act(() => result.current.segment("late", null));
    act(() => result.current.clear());
    await m.settle("late", seg("late"));
    expect(result.current).toMatchObject({ segmentation: null, isLoading: false, error: null });
  });
});
