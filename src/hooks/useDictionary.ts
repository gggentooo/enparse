/**
 * src/hooks/useDictionary.ts — React hooks for dictionary lookup and the offline option
 *
 * Description:
 *   useDictionary(): lookup(query) with the result, loading, and error state;
 *   a newer lookup replaces a running one (stale responses are ignored).
 *   useDictionaryOffline(): the shared offline state of dictionaryService
 *   (stored size, storage check, download progress, last error) and its
 *   actions (download all, cancel, delete, refresh).
 *
 * Layer: hooks/
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/dictionaryService.ts. Must not import modules directly.
 *   Used by: DictionaryPage, WordDetails (OutputPage), DictionaryOffline (ModelsPage; T72).
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
  type LookupResult,
  dictionaryService,
} from "../services/dictionaryService";

export type {
  DictionaryEntry,
  DictionaryLoadReason,
  DictionaryQuery,
  DictionarySnapshot,
  Example,
  KoreanGroup,
  LookupResult,
  MatchKind,
  OfflineState,
  PosGroup,
  Sense,
  StorageFit,
} from "../services/dictionaryService";
export { PHRASAL_PARTICLES } from "../services/dictionaryService";

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
