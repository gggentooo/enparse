/**
 * src/modules/dictionary/index.ts — public API of the dictionary module
 *
 * Description:
 *   Word lookup against the static dictionary data (/dict/v<N>/, T70) and the
 *   opt-in offline download. Other layers import only from this file
 *   (agents.md → Module public API).
 *
 * Layer: modules/ (dictionary)
 *
 * Exports: createDictionaryModule (lookup, glosses (T102), offline state, download all,
 *   delete all, sources); DictionaryLoadError; constants; types.
 *
 * Dependencies:
 *   Internal: ./dictionary.ts, ./staticDb.ts, ./types.ts.
 *   Used by: services/dictionaryService.ts.
 *
 * Status: implemented (T46).
 */

import { type Dictionary, createDictionary } from "./dictionary";
import { type DictCacheApi, type StaticDb, createStaticDb } from "./staticDb";
import type { DictionarySource, DownloadProgress, OfflineState } from "./types";

export type DictionaryModule = Dictionary & {
  offlineState(): Promise<OfflineState>;
  downloadAll(onProgress?: DownloadProgress, signal?: AbortSignal): Promise<void>;
  deleteAll(): Promise<void>;
  /** Sources with licenses and attributions, and the data license (from the manifest). */
  sources(): Promise<{ license: { name: string; url: string }; sources: DictionarySource[] }>;
};

/** The dictionary over the static data (tests inject the cache API or a database). */
export function createDictionaryModule(options: { api?: DictCacheApi; db?: StaticDb } = {}): DictionaryModule {
  const db = options.db ?? createStaticDb(options.api ? { api: options.api } : {});
  const dict = createDictionary(db);
  return {
    lookup: dict.lookup,
    glosses: dict.glosses,
    offlineState: db.offlineState,
    downloadAll: db.downloadAll,
    deleteAll: db.deleteAll,
    async sources() {
      const m = await db.manifest();
      return { license: m.license, sources: m.sources };
    },
  };
}

export { GLOSS_KOREAN_WORDS, LOOKUP_CACHE_SIZE, PHRASAL_PARTICLES, glossOf, orderPos } from "./dictionary";
export type { Gloss, GlossResult } from "./dictionary";
export {
  BULK_CONCURRENCY,
  DICTIONARY_CACHE_PREFIX,
  DICTIONARY_VERSION,
  DICT_INTEGRITY_RETRIES,
  SHARD_CACHE_SIZE,
  fnv1a32,
  shardPath,
} from "./staticDb";
export type { BulkOptions, DictCacheApi } from "./staticDb";
export { DICTIONARY_SCHEMA, DictionaryLoadError } from "./types";
export type {
  DictionaryEntry,
  DictionaryLoadReason,
  DictionaryQuery,
  DictionarySource,
  DownloadProgress,
  Example,
  KoreanGroup,
  LookupResult,
  MatchKind,
  OfflineState,
  PosGroup,
  Sense,
} from "./types";
