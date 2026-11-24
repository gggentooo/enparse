/**
 * src/hooks/useWordGlosses.ts — short meanings of the words of the shown text (T102, T105, T106)
 *
 * Description:
 *   Looks up the glosses of a word list (useParser().words) through
 *   useGlosses, once per word list, and keys them by word. With `auto`, the
 *   lookup starts by itself (the statistics popup when open); otherwise on
 *   load() (CreateWordList when the definitions toggle is on).
 *
 * Layer: hooks/
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./useDictionary.ts (useGlosses), services/parserService.ts (WordEntry type).
 *   Used by: components/Pages/WordStats.tsx, components/Pages/CreateWordList.tsx.
 *
 * Status: implemented (T105, T106). Tests: useWordGlosses.test.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WordEntry } from "../services/parserService";
import { type DictionaryLoadReason, type Gloss, useGlosses } from "./useDictionary";
import type { DictionaryService } from "../services/dictionaryService";

export type WordGlosses = { glosses: ReadonlyMap<string, Gloss | null>; error: DictionaryLoadReason | null };

export type UseWordGlosses = {
  /** Glosses of the current word list by word key, or null until loaded. */
  glosses: ReadonlyMap<string, Gloss | null> | null;
  /** Why some glosses could not be loaded (their words have null), or null. */
  error: DictionaryLoadReason | null;
  isLoading: boolean;
  /** Share of the lookup done (0–1), or null when not known. */
  progress: number | null;
  /** Look up (again); null when cancelled or replaced. */
  load: () => Promise<WordGlosses | null>;
  cancel: () => void;
};

export function useWordGlosses(
  words: readonly WordEntry[] | null,
  auto: boolean,
  service?: DictionaryService,
): UseWordGlosses {
  const g = useGlosses(service);
  const { load: loadGlosses, cancel, isLoading, progress } = g;
  const [loaded, setLoaded] = useState<(WordGlosses & { words: readonly WordEntry[] }) | null>(null);

  const load = useCallback(async (): Promise<WordGlosses | null> => {
    if (!words) return null;
    const r = await loadGlosses(words.map((w) => w.query));
    if (!r) return null;
    const out = { words, glosses: new Map(words.map((w, i) => [w.key, r.glosses[i] ?? null])), error: r.error };
    setLoaded(out);
    return out;
  }, [words, loadGlosses]);

  const current = loaded?.words === words ? loaded : null;
  // Started by itself once per word list (a ref: state updates of the finishing lookup must not start another).
  const requested = useRef<readonly WordEntry[] | null>(null);
  useEffect(() => {
    if (!auto || !words || words.length === 0 || requested.current === words) return;
    requested.current = words;
    void load();
  }, [auto, words, load]);

  return {
    glosses: current?.glosses ?? null,
    error: current?.error ?? null,
    isLoading,
    progress: progress && progress.total > 0 ? progress.done / progress.total : null,
    load,
    cancel,
  };
}
