/**
 * src/services/dictionaryService.ts — dictionary lookup and offline service
 *
 * Description:
 *   Async lookup API for the UI over modules/dictionary, and the state of the
 *   opt-in offline download (T42, T46) for the offline control (T72).
 *
 * Layer: services/
 *
 * Tasks:
 *   1. lookupWord(query): LookupResult (entries with how they matched).
 *      Concurrent lookups of the same word share one request (the module
 *      keeps recent results).
 *   2. Offline option: refreshOfflineState(), downloadAll() (one at a time,
 *      byte progress, cancelDownload()), deleteAll().
 *   3. Shared state via subscribe()/getSnapshot(): offline state, download
 *      progress (updated at most every PROGRESS_NOTIFY_STEP), the last error
 *      reason.
 *   4. sources(): license and attributions from the manifest.
 *   5. Tests in dictionaryService.test.ts with a mocked module.
 *
 * Dependencies:
 *   Internal: modules/dictionary (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useDictionary.ts (T53), the offline control (T72).
 *
 * Status: implemented (T46). Tests: dictionaryService.test.ts.
 */

import {
  DictionaryLoadError,
  type DictionaryLoadReason,
  type DictionaryModule,
  type DictionaryQuery,
  type DictionarySource,
  type LookupResult,
  type OfflineState,
  createDictionaryModule,
} from "../modules/dictionary";

export type {
  DictionaryEntry,
  DictionaryLoadReason,
  DictionaryQuery,
  DictionarySource,
  Example,
  KoreanGroup,
  LookupResult,
  MatchKind,
  OfflineState,
  PosGroup,
  Sense,
} from "../modules/dictionary";
export { DictionaryLoadError } from "../modules/dictionary";

/** Download progress updates the snapshot at most once per this share of the total. */
export const PROGRESS_NOTIFY_STEP = 0.01;

export type DictionarySnapshot = {
  /** Offline availability; null until first checked. */
  offline: OfflineState | null;
  /** Running offline download, or null. */
  download: { bytesDone: number; bytesTotal: number } | null;
  /** Reason of the last failed action (cleared by the next success), or null. */
  error: DictionaryLoadReason | null;
};

export type DictionaryService = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DictionarySnapshot;
  lookupWord(query: DictionaryQuery): Promise<LookupResult>;
  refreshOfflineState(): Promise<OfflineState>;
  /** Store every dictionary file for offline use (user action only); resolves when done or cancelled. */
  downloadAll(): Promise<void>;
  cancelDownload(): void;
  deleteAll(): Promise<void>;
  sources(): Promise<{ license: { name: string; url: string }; sources: DictionarySource[] }>;
};

const reasonOf = (e: unknown): DictionaryLoadReason => (e instanceof DictionaryLoadError ? e.reason : "network");

/** Create the service; tests pass a module over a fake cache. */
export function createDictionaryService(module: DictionaryModule = createDictionaryModule()): DictionaryService {
  let snapshot: DictionarySnapshot = { offline: null, download: null, error: null };
  const listeners = new Set<() => void>();
  let running: { controller: AbortController; done: Promise<void> } | null = null;

  const set = (patch: Partial<DictionarySnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const l of listeners) l();
  };
  const fail = (e: unknown): never => {
    set({ error: reasonOf(e) });
    throw e;
  };

  async function refreshOfflineState(): Promise<OfflineState> {
    try {
      const offline = await module.offlineState();
      set({ offline });
      return offline;
    } catch (e) {
      return fail(e);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    async lookupWord(query) {
      try {
        const result = await module.lookup(query);
        if (snapshot.error !== null && snapshot.download === null) set({ error: null });
        return result;
      } catch (e) {
        return fail(e);
      }
    },

    refreshOfflineState,

    downloadAll() {
      if (running) return running.done;
      const controller = new AbortController();
      let notified = -1;
      set({ download: { bytesDone: 0, bytesTotal: 0 }, error: null });
      const done = module
        .downloadAll((bytesDone, bytesTotal) => {
          const share = bytesTotal > 0 ? bytesDone / bytesTotal : 0;
          if (share - notified >= PROGRESS_NOTIFY_STEP || bytesDone === bytesTotal) {
            notified = share;
            set({ download: { bytesDone, bytesTotal } });
          }
        }, controller.signal)
        .catch((e: unknown) => {
          if (!(e instanceof DictionaryLoadError && e.reason === "cancelled")) set({ error: reasonOf(e) });
        })
        .finally(async () => {
          running = null;
          set({ download: null });
          await refreshOfflineState().catch(() => undefined);
        });
      running = { controller, done };
      return done;
    },

    cancelDownload() {
      running?.controller.abort();
    },

    async deleteAll() {
      running?.controller.abort();
      await running?.done;
      try {
        await module.deleteAll();
        set({ error: null });
      } catch (e) {
        fail(e);
      }
      await refreshOfflineState().catch(() => undefined);
    },

    sources: () => module.sources(),
  };
}

let shared: DictionaryService | null = null;
/** The app's dictionary service (created on first use). */
export function dictionaryService(): DictionaryService {
  shared ??= createDictionaryService();
  return shared;
}
