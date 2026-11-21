// @vitest-environment jsdom
/**
 * src/hooks/useVocab.test.ts — useVocab over a mocked vocabService (T48)
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VocabList, VocabService, VocabSnapshot } from "../services/vocabService";
import { useVocab } from "./useVocab";

afterEach(cleanup);

function mockService() {
  let snap: VocabSnapshot = { status: "idle", lists: [], error: null, backupDue: false };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<VocabSnapshot>): void => {
    snap = { ...snap, ...patch };
    for (const l of listeners) l();
  };
  const list: VocabList = { id: "l1", name: "L", createdAt: "", updatedAt: "", items: [] };
  const service = {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snap,
    ensureLoaded: vi.fn<VocabService["ensureLoaded"]>(async () => update({ status: "ready" })),
    createList: vi.fn<VocabService["createList"]>(async () => {
      update({ lists: [list] });
      return list;
    }),
  } as unknown as VocabService;
  return { service, update };
}

describe("useVocab", () => {
  it("loads on first use and follows the service snapshot", async () => {
    const m = mockService();
    const { result } = renderHook(() => useVocab(m.service));
    await act(async () => undefined);
    expect(m.service.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    await act(async () => {
      await result.current.createList("L");
    });
    expect(result.current.lists.map((l) => l.name)).toEqual(["L"]);
    act(() => m.update({ error: "disk full", backupDue: true }));
    expect(result.current).toMatchObject({ error: "disk full", backupDue: true });
  });

  it("does not throw when loading fails (the snapshot carries the error)", async () => {
    const m = mockService();
    vi.mocked(m.service.ensureLoaded).mockRejectedValueOnce(new Error("no IndexedDB"));
    renderHook(() => useVocab(m.service));
    await act(async () => undefined);
    expect(m.service.ensureLoaded).toHaveBeenCalled();
  });
});
