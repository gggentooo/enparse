// @vitest-environment jsdom
/**
 * src/hooks/useDictionary.test.ts — lookup hook and offline hook (T53, T72)
 *
 * Real service and module over the fake dictionary server (modules/dictionary/testDictionary.ts); a controlled
 * service for stale responses.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDictionaryModule } from "../modules/dictionary";
import { fakeApi } from "../modules/dictionary/testDictionary";
import { type DictionaryService, type LookupResult, createDictionaryService } from "../services/dictionaryService";
import { useDictionary, useDictionaryOffline } from "./useDictionary";

const real = (api = fakeApi()): DictionaryService =>
  createDictionaryService(createDictionaryModule({ api }), async () => ({ quotaBytes: 1e12, usageBytes: 0 }));

describe("useDictionary", () => {
  it("looks a word up, with loading state, and reports the error reason", async () => {
    const api = fakeApi();
    const service = real(api); // one service for every render
    const { result } = renderHook(() => useDictionary(service));
    act(() => result.current.lookup({ word: "ran" }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.result?.entries.map((e) => e.entry.headword)).toEqual(["run"]);

    api.offline = true;
    act(() => result.current.lookup({ word: "look up" }));
    await waitFor(() => expect(result.current.error).toBe("network"));
    expect(result.current.result).toBeNull();
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ result: null, error: null, isLoading: false });
  });

  it("ignores a response that arrives after a newer lookup", async () => {
    const pending: Array<(r: LookupResult) => void> = [];
    const base = real();
    const service = {
      ...base,
      lookupWord: (q: { word: string }) =>
        new Promise<LookupResult>((resolve) => pending.push(() => resolve({ query: q, entries: [] }))),
    } as DictionaryService;
    const { result } = renderHook(() => useDictionary(service));
    act(() => result.current.lookup({ word: "old" }));
    act(() => result.current.lookup({ word: "new" }));
    await act(async () => {
      pending[1]?.({ query: { word: "new" }, entries: [] });
      pending[0]?.({ query: { word: "old" }, entries: [] });
    });
    expect(result.current.result?.query.word).toBe("new");
  });
});

describe("useDictionaryOffline", () => {
  it("checks the offline state on mount and downloads everything", async () => {
    const service = real();
    const { result } = renderHook(() => useDictionaryOffline(service));
    await waitFor(() => expect(result.current.offline?.state).toBe("none"));
    expect(result.current.fit?.verdict).toBe("fits");
    act(() => result.current.downloadAll());
    await waitFor(() => expect(result.current.offline?.state).toBe("complete"));
    expect(result.current.download).toBeNull();
    act(() => result.current.deleteAll());
    await waitFor(() => expect(result.current.offline?.state).toBe("none"));
  });
});
