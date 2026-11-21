// @vitest-environment jsdom
/**
 * src/hooks/useParser.test.ts — useParser over a mocked parserService (T52)
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ParseOutcome, ParseSupersededError, ParserNotReadyError } from "../services/parserService";
import { mockService } from "./testParserService";
import { useParser } from "./useParser";

afterEach(cleanup);

describe("useParser", () => {
  it("follows the service status; canParse only when ready", () => {
    const m = mockService();
    const { result } = renderHook(() => useParser(m.service));
    expect(result.current.canParse).toBe(false);
    act(() => m.update({ status: { state: "ready", modelId: "a", backend: "wasm", modelVersion: "1" } }));
    expect(result.current.canParse).toBe(true);
    expect(result.current.status).toMatchObject({ state: "ready", modelId: "a" });
  });

  it("keeps the error of a failed parse and ignores a superseded one", async () => {
    const m = mockService();
    const { result } = renderHook(() => useParser(m.service));
    await act(async () => {
      await expect(result.current.parseText("x")).rejects.toBeInstanceOf(ParserNotReadyError);
    });
    expect(result.current.error).toBeInstanceOf(ParserNotReadyError);
    expect(result.current.isParsing).toBe(false);

    vi.mocked(m.service.parseText).mockRejectedValueOnce(new ParseSupersededError());
    await act(async () => {
      expect(await result.current.parseText("y")).toBeNull();
    });
    expect(result.current.error).toBeNull();
  });

  it("reports isParsing while a parse runs", async () => {
    const m = mockService();
    let finish!: (o: ParseOutcome) => void;
    vi.mocked(m.service.parseText).mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const { result } = renderHook(() => useParser(m.service));
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.parseText("z");
    });
    expect(result.current.isParsing).toBe(true);
    await act(async () => {
      finish({
        result: { sentences: [], modelId: "a", modelVersion: "1", backend: "wasm" },
      } as unknown as ParseOutcome);
      await pending;
    });
    expect(result.current.isParsing).toBe(false);
  });
});
