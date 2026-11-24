// @vitest-environment jsdom
/**
 * src/hooks/useWordGlosses.test.ts — glosses of a word list (T102, T105, T106)
 *
 * The real dictionary service over the fake server: automatic lookup once per word list,
 * glosses by word key, failures as a reason, and cancel.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDictionaryModule } from "../modules/dictionary";
import { fakeApi } from "../modules/dictionary/testDictionary";
import { createDictionaryService } from "../services/dictionaryService";
import type { WordEntry } from "../services/parserService";
import { useWordGlosses } from "./useWordGlosses";

const entry = (word: string, upos: string): WordEntry => ({
  key: `${word}\u0000${upos}`,
  word,
  lemma: word,
  upos,
  count: 1,
  forms: [word],
  sentence: "",
  phrasal: false,
  query: { word, lemma: word, upos },
});
const WORDS = [entry("run", "VERB"), entry("run", "NOUN"), entry("xyzzy", "NOUN")];

const service = (offline = false) => {
  const api = fakeApi();
  api.offline = offline;
  const s = createDictionaryService(createDictionaryModule({ api }), async () => null);
  return { s, spy: vi.spyOn(s, "lookupGlosses") };
};

describe("useWordGlosses", () => {
  it("looks up once per word list by itself and keys the glosses by word", async () => {
    const { s, spy } = service();
    const { result, rerender } = renderHook(({ words }) => useWordGlosses(words, true, s), {
      initialProps: { words: WORDS },
    });
    await waitFor(() => expect(result.current.glosses).not.toBeNull());
    expect(result.current.glosses?.get("run\u0000VERB")).toEqual({
      headword: "run",
      ko: "달리다, 뛰다",
      en: "move fast",
    });
    expect(result.current.glosses?.get("run\u0000NOUN")?.ko).toBeNull();
    expect(result.current.glosses?.get("xyzzy\u0000NOUN")).toBeNull();
    expect(result.current).toMatchObject({ error: null, isLoading: false });
    rerender({ words: WORDS });
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    // A new text: looked up again.
    rerender({ words: [WORDS[0] as WordEntry] });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("waits for load() without auto, reports failures, and resolves null when cancelled", async () => {
    const { s, spy } = service(true);
    const { result } = renderHook(() => useWordGlosses(WORDS, false, s));
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
    let out: Awaited<ReturnType<typeof result.current.load>> = null;
    await act(async () => {
      out = await result.current.load();
    });
    expect(out).toMatchObject({ error: "network" });
    expect(result.current.error).toBe("network");

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.load();
      result.current.cancel();
    });
    expect(await pending).toBeNull();
  });
});
