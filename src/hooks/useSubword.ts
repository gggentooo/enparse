/**
 * src/hooks/useSubword.ts — React hook for subword segmentation
 *
 * Description:
 *   Exposes subwordService to components for a selected word.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. segment(word, lemma) action; returns { segmentation, isLoading, error,
 *      segment, clear }. The known-word list loads lazily on the first call
 *      (subwordService).
 *   2. Ignore stale responses when the selection changes (or after clear()).
 *   3. Tests in useSubword.test.ts with a mocked service (optional argument).
 *   T26 bundles the known-word list in modules/subword, so no dictionary
 *   headwords are combined here.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/subwordService.ts. Must not import modules directly.
 *   Used by: OutputPage, DictionaryPage.
 *
 * Status: implemented (T49). Tests: useSubword.test.ts.
 */

import { useCallback, useRef, useState } from "react";
import { type SubwordSegmentation, type SubwordService, subwordService } from "../services/subwordService";

export type { SubwordSegmentation } from "../services/subwordService";

export type UseSubword = {
  segmentation: SubwordSegmentation | null;
  isLoading: boolean;
  error: Error | null;
  /** Segment the selected word (surface form + lemma from the parse); replaces any running request. */
  segment: (word: string, lemma: string | null) => void;
  /** Drop the current result and ignore any running request. */
  clear: () => void;
};

type State = { segmentation: SubwordSegmentation | null; isLoading: boolean; error: Error | null };
const IDLE: State = { segmentation: null, isLoading: false, error: null };

export function useSubword(service: SubwordService = subwordService()): UseSubword {
  const [state, setState] = useState<State>(IDLE);
  const seq = useRef(0);

  const segment = useCallback(
    (word: string, lemma: string | null): void => {
      const mine = ++seq.current;
      setState({ segmentation: null, isLoading: true, error: null });
      service.segmentWord(word, lemma).then(
        (segmentation) => {
          if (mine === seq.current) setState({ segmentation, isLoading: false, error: null });
        },
        (e: unknown) => {
          if (mine === seq.current) {
            setState({ segmentation: null, isLoading: false, error: e instanceof Error ? e : new Error(String(e)) });
          }
        },
      );
    },
    [service],
  );

  const clear = useCallback((): void => {
    seq.current++;
    setState(IDLE);
  }, []);

  return { ...state, segment, clear };
}
