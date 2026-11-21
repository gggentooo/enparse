// @vitest-environment jsdom
/**
 * src/hooks/useModelLibrary.test.ts — useModelLibrary over a mocked parserService (T52)
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelUnavailableError } from "../services/parserService";
import { library, mockService } from "./testParserService";
import { useModelLibrary } from "./useModelLibrary";

afterEach(cleanup);

describe("useModelLibrary", () => {
  it("keeps the models array stable across status-only changes", () => {
    const m = mockService();
    const { result } = renderHook(() => useModelLibrary(m.service));
    const before = result.current.models;
    act(() => m.update({ status: { state: "checking" } }));
    expect(result.current.models).toBe(before);
    act(() => m.update({ library: { ...library, activeId: "a" } }));
    expect(result.current.activeId).toBe("a");
  });

  it("calls the service and keeps action errors instead of throwing", async () => {
    const m = mockService();
    vi.mocked(m.service.chooseModel).mockRejectedValueOnce(new ModelUnavailableError("b", "blocked"));
    const { result } = renderHook(() => useModelLibrary(m.service));
    await act(() => result.current.chooseModel("b"));
    expect(m.service.chooseModel).toHaveBeenCalledWith("b");
    expect(result.current.error).toBeInstanceOf(ModelUnavailableError);
    await act(() => result.current.deleteModel("b"));
    expect(result.current.error).toBeNull();
  });
});
