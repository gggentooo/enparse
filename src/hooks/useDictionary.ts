/**
 * src/hooks/useDictionary.ts — React hooks for dictionary lookup and the offline option
 *
 * Description:
 *   useDictionary(): lookup(query) with the result, loading, and error state;
 *   a newer lookup replaces a running one (stale responses are ignored).
 *   useGlosses(): short definitions of many words at once (T102) with
 *   progress, cancel, and the error reason of failed parts.
 *   useDictionaryOffline(): the shared offline state of dictionaryService
 *   (stored size, storage check, download progress, last error) and its
 *   actions (download all, cancel, delete, refresh).
 *
 * Layer: hooks/
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/dictionaryService.ts. Must not import modules directly.
 *   Used by: DictionaryPage, WordDetails (OutputPage), DictionaryOffline (ModelsPage; T72),
 *   WordStats and CreateWordList (OutputPage; T105, T106).
 *
 * Status: implemented (T53, T72). Tests: useDictionary.test.ts.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DictionaryLoadError,
  type DictionaryLoadReason,
  type DictionaryQuery,
  type DictionaryService,
  type DictionarySnapshot,
  type GlossResult,
  type LookupResult,
  dictionaryService,
} from "../services/dictionaryService";

export type {
  DictionaryEntry,
  DictionaryLoadReason,
  DictionaryQuery,
  DictionarySnapshot,
  Example,
  Gloss,
  GlossResult,
  KoreanGroup,
  LookupResult,
  MatchKind,
  OfflineState,
  PosGroup,
  Sense,
  StorageFit,
} from "../services/dictionaryService";
export { GLOSS_KOREAN_WORDS, PHRASAL_PARTICLES } from "../services/dictionaryService";

export type UseDictionary = {
  result: LookupResult | null;
  isLoading: boolean;
  /** Why the last lookup failed, or null. */
  error: DictionaryLoadReason | null;
  lookup: (query: DictionaryQuery) => void;
  clear: () => void;
};

type State = { result: LookupResult | null; isLoading: boolean; error: DictionaryLoadReason | null };
const IDLE: State = { result: null, isLoading: false, error: null };

export function useDictionary(service: DictionaryService = dictionaryService()): UseDictionary {
  const [state, setState] = useState<State>(IDLE);
  const seq = useRef(0);

  const lookup = useCallback(
    (query: DictionaryQuery): void => {
      const mine = ++seq.current;
      setState((s) => ({ ...s, isLoading: true, error: null }));
      service.lookupWord(query).then(
        (result) => {
          if (mine === seq.current) setState({ result, isLoading: false, error: null });
        },
        (e: unknown) => {
          if (mine === seq.current) {
            setState({
              result: null,
              isLoading: false,
              error: e instanceof DictionaryLoadError ? e.reason : "network",
            });
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

  return { ...state, lookup, clear };
}

export type UseGlosses = {
  /** Glosses of the last finished load in query order, or null. */
  result: GlossResult | null;
  isLoading: boolean;
  /** Shards read of shards needed by the running load. */
  progress: { done: number; total: number } | null;
  /**
   * Load glosses; a newer load or cancel() replaces a running one (it resolves null). Resolves
   * with the result (also kept in `result`); parts that failed have null glosses and `error`.
   */
  load: (queries: readonly DictionaryQuery[]) => Promise<GlossResult | null>;
  cancel: () => void;
};

export function useGlosses(service: DictionaryService = dictionaryService()): UseGlosses {
  const [result, setResult] = useState<GlossResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const running = useRef<AbortController | null>(null);

  const cancel = useCallback((): void => {
    running.current?.abort();
    running.current = null;
    setProgress(null);
  }, []);

  const load = useCallback(
    async (queries: readonly DictionaryQuery[]): Promise<GlossResult | null> => {
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      setProgress({ done: 0, total: 0 });
      try {
        const r = await service.lookupGlosses(queries, {
          signal: controller.signal,
          onProgress: (done, total) => {
            if (running.current === controller) setProgress({ done, total });
          },
        });
        if (running.current !== controller) return null;
        setResult(r);
        return r;
      } catch (e) {
        if (controller.signal.aborted) return null;
        const r: GlossResult = {
          glosses: queries.map(() => null),
          error: e instanceof DictionaryLoadError ? e.reason : "network",
        };
        if (running.current === controller) setResult(r);
        return r;
      } finally {
        if (running.current === controller) {
          running.current = null;
          setProgress(null);
        }
      }
    },
    [service],
  );

  useEffect(() => () => running.current?.abort(), []);

  return { result, isLoading: progress !== null, progress, load, cancel };
}

export type UseDictionaryOffline = DictionarySnapshot & {
  downloadAll: () => void;
  cancelDownload: () => void;
  deleteAll: () => void;
  refresh: () => void;
};

export function useDictionaryOffline(service: DictionaryService = dictionaryService()): UseDictionaryOffline {
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => {
    void service.refreshOfflineState().catch(() => undefined); // the error is in the snapshot
  }, [service]);
  return {
    ...snapshot,
    downloadAll: useCallback(() => void service.downloadAll(), [service]),
    cancelDownload: useCallback(() => service.cancelDownload(), [service]),
    deleteAll: useCallback(() => void service.deleteAll().catch(() => undefined), [service]),
    refresh: useCallback(() => void service.refreshOfflineState().catch(() => undefined), [service]),
  };
}
