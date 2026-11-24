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
 *   2. Offline option: refreshOfflineState() (with the storage check:
 *      blocked if the rest cannot fit, warn if tight; T24, T72), downloadAll()
 *      (one at a time, byte progress, cancelDownload(); refused when it
 *      cannot fit), deleteAll().
 *   3. Shared state via subscribe()/getSnapshot(): offline state, download
 *      progress (updated at most every PROGRESS_NOTIFY_STEP), the last error
 *      reason.
 *   4. sources(): license and attributions from the manifest.
 *   4a. lookupGlosses(queries, options): short definitions of many words at
 *      once (T102), with progress and cancel; a failed shard gives null
 *      glosses and an error reason instead of a failed call.
 *   5. Tests in dictionaryService.test.ts with a mocked module.
 *
 * Dependencies:
 *   Internal: modules/dictionary (index.ts only), modules/preflight
 *   (STORAGE_MARGIN_BYTES), core/environment (estimateStorage).
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
  type BulkOptions,
  type GlossResult,
  type LookupResult,
  type OfflineState,
  createDictionaryModule,
} from "../modules/dictionary";
import { estimateStorage } from "../core/environment";
import { STORAGE_MARGIN_BYTES } from "../modules/preflight";

export type {
  DictionaryEntry,
  DictionaryLoadReason,
  DictionaryQuery,
  DictionarySource,
  BulkOptions,
  Example,
  Gloss,
  GlossResult,
  KoreanGroup,
  LookupResult,
  MatchKind,
  OfflineState,
  PosGroup,
  Sense,
} from "../modules/dictionary";
export { DictionaryLoadError, GLOSS_KOREAN_WORDS, PHRASAL_PARTICLES } from "../modules/dictionary";

/** Download progress updates the snapshot at most once per this share of the total. */
export const PROGRESS_NOTIFY_STEP = 0.01;

/**
 * Whether the rest of the dictionary fits the free storage (pre-flight policy, T24, T72): the
 * download is blocked if it cannot fit, and "tight" (warn) with less than STORAGE_MARGIN_BYTES
 * left afterwards.
 */
export type StorageFit = {
  verdict: "fits" | "tight" | "no-space" | "unknown";
  /** Bytes still to download. */
  needBytes: number;
  /** Free quota, or null if the browser does not tell. */
  freeBytes: number | null;
};

export function storageFit(needBytes: number, estimate: { quotaBytes: number; usageBytes: number } | null): StorageFit {
  if (!estimate) return { verdict: "unknown", needBytes, freeBytes: null };
  const freeBytes = Math.max(0, estimate.quotaBytes - estimate.usageBytes);
  const verdict = freeBytes < needBytes ? "no-space" : freeBytes < needBytes + STORAGE_MARGIN_BYTES ? "tight" : "fits";
  return { verdict, needBytes, freeBytes };
}

export type DictionarySnapshot = {
  /** Offline availability; null until first checked. */
  offline: OfflineState | null;
  /** Storage check for the rest of the download; null until first checked. */
  fit: StorageFit | null;
  /** Running offline download, or null. */
  download: { bytesDone: number; bytesTotal: number } | null;
  /** Reason of the last failed action (cleared by the next success), or null. */
  error: DictionaryLoadReason | null;
};

export type { DictionaryModule };

export type DictionaryService = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DictionarySnapshot;
  lookupWord(query: DictionaryQuery): Promise<LookupResult>;
  /** Short definitions of many words (T102); rejects only when cancelled. */
  lookupGlosses(queries: readonly DictionaryQuery[], options?: BulkOptions): Promise<GlossResult>;
  refreshOfflineState(): Promise<OfflineState>;
  /** Store every dictionary file for offline use (user action only); resolves when done or cancelled. */
  downloadAll(): Promise<void>;
  cancelDownload(): void;
  deleteAll(): Promise<void>;
  sources(): Promise<{ license: { name: string; url: string }; sources: DictionarySource[] }>;
};

const reasonOf = (e: unknown): DictionaryLoadReason => (e instanceof DictionaryLoadError ? e.reason : "network");

/** Create the service; tests pass a module over a fake cache. */
export function createDictionaryService(
  module: DictionaryModule = createDictionaryModule(),
  estimate: () => Promise<{ quotaBytes: number; usageBytes: number } | null> = estimateStorage,
): DictionaryService {
  let snapshot: DictionarySnapshot = { offline: null, fit: null, download: null, error: null };
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
      const fit = storageFit(offline.totalBytes - offline.cachedBytes, await estimate().catch(() => null));
      set({ offline, fit });
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

    lookupGlosses: (queries, options) => module.glosses(queries, options),

    refreshOfflineState,

    downloadAll() {
      if (running) return running.done;
      if (snapshot.fit?.verdict === "no-space") {
        // Blocked by pre-flight (T24): it would fail part-way.
        set({ error: "storage" });
        return Promise.resolve();
      }
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
