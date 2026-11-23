/**
 * src/modules/dictionary/staticDb.ts — static dictionary database adapter
 *
 * Description:
 *   Reads the dictionary data built by training/dictionary/ (T70; format:
 *   training/dictionary/DATA_CARD.md) from the app's own origin
 *   (/dict/v<N>/, served from R2; no other hosts, no live APIs; owner, T42):
 *     - manifest.json: fetched on first use (the server revalidates it); a
 *       copy is kept in the cache for offline use; schema checked.
 *     - index.json and shards/NNN.json: read from the versioned Cache Storage
 *       cache (enparse-dict-v<N>) if present, else downloaded into it with
 *       their size and SHA-256 checked against the manifest (core/environment
 *       T38 functions); an integrity failure is retried once.
 *     - A small in-memory LRU of parsed shards (SHARD_CACHE_SIZE).
 *     - Offline option (T42): downloadAll(onProgress, signal) stores every
 *       file with byte progress; deleteAll() removes the cache;
 *       offlineState() reports how much is stored.
 *     - Caches of other data versions (enparse-dict-v<M>) are deleted once a
 *       manifest of this version has loaded.
 *
 * Layer: modules/ (dictionary)
 *
 * Errors: DictionaryLoadError — network (no connection and nothing cached),
 *   integrity (size or SHA-256 wrong twice), storage (Cache Storage missing
 *   or full), format (unexpected data), cancelled (aborted download).
 *
 * Dependencies:
 *   Internal: ./types.ts; core/environment.ts (fetchStaticJson, listCached,
 *   downloadToCache, readCached, putCached, cacheNames, deleteCache),
 *   injected for tests (createStaticDb).
 *   Used by: ./dictionary.ts, ./index.ts.
 *
 * Status: implemented (T46). Tests: staticDb.test.ts.
 */

import {
  type FileDigest,
  cacheNames,
  deleteCache,
  downloadToCache,
  fetchStaticJson,
  listCached,
  putCached,
  readCached,
} from "../../core/environment";
import {
  DICTIONARY_SCHEMA,
  type DictFile,
  type DictionaryEntry,
  type DictionaryIndex,
  DictionaryLoadError,
  type DictionaryManifest,
  type DownloadProgress,
  type KoreanGroup,
  type OfflineState,
  type PosGroup,
} from "./types";

/** Data version this app reads (served at /dict/v<N>/; owner, T70). */
export const DICTIONARY_VERSION = 1;
/** Cache Storage name prefix; the version is appended (enparse-dict-v1). */
export const DICTIONARY_CACHE_PREFIX = "enparse-dict-v";
/** Parsed shards kept in memory (each ~80 kB of JSON). */
export const SHARD_CACHE_SIZE = 16;
/** Re-downloads of a file after an integrity failure before giving up (same policy as models, T24). */
export const DICT_INTEGRITY_RETRIES = 1;

/** The core functions the database uses (injected in tests). */
export interface DictCacheApi {
  fetchJson(url: string): Promise<unknown>;
  listCached(urls: readonly string[], cacheName: string): Promise<Record<string, number | null>>;
  downloadToCache(
    url: string,
    expected: FileDigest,
    onProgress: ((loaded: number, total: number) => void) | undefined,
    signal: AbortSignal | undefined,
    cacheName: string,
  ): Promise<FileDigest>;
  readCached(url: string, cacheName: string): Promise<ArrayBuffer | null>;
  putCached(url: string, body: string, contentType: string, cacheName: string): Promise<void>;
  cacheNames(): Promise<string[]>;
  deleteCache(cacheName: string): Promise<boolean>;
}

const defaultApi: DictCacheApi = {
  fetchJson: fetchStaticJson,
  listCached,
  downloadToCache,
  readCached,
  putCached,
  cacheNames,
  deleteCache,
};

/** FNV-1a 32-bit hash of the UTF-8 bytes (identical to training/dictionary/common.py → fnv1a32). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Relative path of the shard that holds a key. */
export function shardPath(key: string, shards: number): string {
  return `shards/${String(fnv1a32(key) % shards).padStart(3, "0")}.json`;
}

export interface StaticDb {
  manifest(): Promise<DictionaryManifest>;
  index(): Promise<DictionaryIndex>;
  /** The entry of a key, or null if the key is not a headword. */
  entry(key: string): Promise<DictionaryEntry | null>;
  offlineState(): Promise<OfflineState>;
  downloadAll(onProgress?: DownloadProgress, signal?: AbortSignal): Promise<void>;
  deleteAll(): Promise<void>;
}

// -- narrowing (the data is JSON from the network) ---------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
const bad = (what: string): DictionaryLoadError =>
  new DictionaryLoadError("format", `unexpected dictionary data: ${what}`);

export function asManifest(json: unknown): DictionaryManifest {
  if (!isObj(json) || json.schema !== DICTIONARY_SCHEMA) throw bad("manifest schema");
  const { version, license, hash, sources, files } = json;
  if (typeof version !== "number" || !isObj(hash) || typeof hash.shards !== "number" || hash.shards < 1) {
    throw bad("manifest version or hash");
  }
  if (!isObj(files)) throw bad("manifest files");
  const out: Record<string, DictFile> = {};
  for (const [rel, f] of Object.entries(files)) {
    if (!isObj(f) || typeof f.bytes !== "number" || typeof f.sha256 !== "string") throw bad(`file ${rel}`);
    out[rel] = { bytes: f.bytes, sha256: f.sha256 };
  }
  if (!out["index.json"]) throw bad("no index.json");
  return {
    schema: DICTIONARY_SCHEMA,
    version,
    license: isObj(license)
      ? { name: String(license.name ?? ""), url: String(license.url ?? "") }
      : { name: "", url: "" },
    hash: { name: String(hash.name ?? ""), shards: hash.shards },
    sources: (Array.isArray(sources) ? sources : []).filter(isObj).map((s) => ({
      key: String(s.key ?? ""),
      name: String(s.name ?? ""),
      url: String(s.url ?? ""),
      license: String(s.license ?? ""),
      license_url: String(s.license_url ?? ""),
      attribution: String(s.attribution ?? ""),
    })),
    files: out,
  };
}

export function asIndex(json: unknown): DictionaryIndex {
  if (!isObj(json) || !Array.isArray(json.headwords) || !isObj(json.forms)) throw bad("index");
  const forms = new Map<string, readonly string[]>();
  for (const [form, heads] of Object.entries(json.forms)) forms.set(form, strings(heads));
  return { headwords: new Set(strings(json.headwords)), forms };
}

export function asEntry(key: string, raw: unknown): DictionaryEntry {
  if (!isObj(raw) || typeof raw.headword !== "string" || !Array.isArray(raw.pos)) throw bad(`entry ${key}`);
  const pos: PosGroup[] = raw.pos.filter(isObj).map((g) => ({
    upos: String(g.upos ?? "X"),
    from: g.from === "wordnet" || g.from === "wiktionary" ? g.from : null,
    senses: (Array.isArray(g.senses) ? g.senses : [])
      .filter(isObj)
      .map((s) => ({ definition: String(s.def ?? ""), examples: strings(s.examples) })),
    korean: (Array.isArray(g.ko) ? g.ko : [])
      .filter(isObj)
      .map((k): KoreanGroup => ({ sense: String(k.sense ?? ""), words: strings(k.words) })),
  }));
  const examples = (Array.isArray(raw.examples) ? raw.examples : []).filter(isObj).flatMap((x) => {
    const ids = Array.isArray(x.tatoeba) ? x.tatoeba : [];
    return typeof x.en === "string" && typeof x.ko === "string"
      ? [{ en: x.en, ko: x.ko, tatoeba: [Number(ids[0] ?? 0), Number(ids[1] ?? 0)] as [number, number] }]
      : [];
  });
  return { key, headword: raw.headword, pos, examples };
}

/** Map any failure to a DictionaryLoadError. */
export function toLoadError(e: unknown): DictionaryLoadError {
  if (e instanceof DictionaryLoadError) return e;
  const name = (e as { name?: unknown } | null)?.name;
  const reason = (e as { reason?: unknown } | null)?.reason;
  const message = e instanceof Error ? e.message : String(e);
  if (name === "AbortError") return new DictionaryLoadError("cancelled", "dictionary download cancelled", { cause: e });
  if (reason === "size" || reason === "sha256") return new DictionaryLoadError("integrity", message, { cause: e });
  if (reason === "cache" || name === "QuotaExceededError")
    return new DictionaryLoadError("storage", message, { cause: e });
  if (e instanceof SyntaxError) return new DictionaryLoadError("format", message, { cause: e });
  return new DictionaryLoadError("network", message, { cause: e });
}

// -- database --------------------------------------------------------------------------------

export function createStaticDb(
  options: { api?: DictCacheApi; version?: number; baseUrl?: string; shardCacheSize?: number } = {},
): StaticDb {
  const api = options.api ?? defaultApi;
  const version = options.version ?? DICTIONARY_VERSION;
  const base = options.baseUrl ?? `/dict/v${version}/`;
  const cacheName = `${DICTIONARY_CACHE_PREFIX}${version}`;
  const shardCacheSize = options.shardCacheSize ?? SHARD_CACHE_SIZE;
  const manifestUrl = `${base}manifest.json`;
  const decoder = new TextDecoder();

  let manifestP: Promise<DictionaryManifest> | null = null;
  let indexP: Promise<DictionaryIndex> | null = null;
  const shards = new Map<string, Promise<Record<string, unknown>>>();

  /** Drop caches of other data versions (best effort). */
  const dropOldVersions = async (): Promise<void> => {
    for (const name of await api.cacheNames()) {
      if (name.startsWith(DICTIONARY_CACHE_PREFIX) && name !== cacheName) await api.deleteCache(name);
    }
  };

  async function loadManifest(): Promise<DictionaryManifest> {
    let json: unknown;
    try {
      json = await api.fetchJson(manifestUrl);
    } catch (e) {
      // Offline (or the server failed): use the copy kept with the stored files.
      const copy = await api.readCached(manifestUrl, cacheName).catch(() => null);
      if (!copy) throw toLoadError(e);
      json = JSON.parse(decoder.decode(copy));
      return asManifest(json);
    }
    const m = asManifest(json);
    await api.putCached(manifestUrl, JSON.stringify(json), "application/json", cacheName).catch(() => undefined);
    void dropOldVersions().catch(() => undefined);
    return m;
  }

  function manifest(): Promise<DictionaryManifest> {
    manifestP ??= loadManifest().catch((e: unknown) => {
      manifestP = null; // retry on the next call
      throw toLoadError(e);
    });
    return manifestP;
  }

  /** Download one file into the cache (integrity failures retried once). */
  async function store(
    rel: string,
    expected: DictFile,
    onProgress?: (loaded: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await api.downloadToCache(`${base}${rel}`, expected, onProgress, signal, cacheName);
        return;
      } catch (e) {
        const err = toLoadError(e);
        if (err.reason !== "integrity" || attempt >= DICT_INTEGRITY_RETRIES) throw err;
      }
    }
  }

  /** Parsed JSON of a file of this version: from the cache, else downloaded into it. */
  async function file(rel: string): Promise<unknown> {
    const m = await manifest();
    const expected = m.files[rel];
    if (!expected) throw bad(`unknown file ${rel}`);
    try {
      let data = await api.readCached(`${base}${rel}`, cacheName);
      if (!data) {
        await store(rel, expected);
        data = await api.readCached(`${base}${rel}`, cacheName);
        if (!data) throw new DictionaryLoadError("storage", `${rel} was not stored`);
      }
      return JSON.parse(decoder.decode(data));
    } catch (e) {
      throw toLoadError(e);
    }
  }

  function index(): Promise<DictionaryIndex> {
    indexP ??= file("index.json")
      .then(asIndex)
      .catch((e: unknown) => {
        indexP = null;
        throw toLoadError(e);
      });
    return indexP;
  }

  async function shard(rel: string): Promise<Record<string, unknown>> {
    const hit = shards.get(rel);
    if (hit) {
      shards.delete(rel); // most recently used last
      shards.set(rel, hit);
      return hit;
    }
    const p = file(rel).then((json) => {
      if (!isObj(json)) throw bad(rel);
      return json;
    });
    shards.set(rel, p);
    p.catch(() => shards.delete(rel));
    while (shards.size > shardCacheSize) shards.delete(shards.keys().next().value as string);
    return p;
  }

  async function entry(key: string): Promise<DictionaryEntry | null> {
    const idx = await index();
    if (!idx.headwords.has(key)) return null;
    const m = await manifest();
    const raw = (await shard(shardPath(key, m.hash.shards)))[key];
    return raw === undefined ? null : asEntry(key, raw);
  }

  async function offlineState(): Promise<OfflineState> {
    const m = await manifest();
    const rels = Object.keys(m.files);
    const sizes = await api
      .listCached(
        rels.map((r) => `${base}${r}`),
        cacheName,
      )
      .catch(() => ({}) as Record<string, number | null>);
    let cachedFiles = 0;
    let cachedBytes = 0;
    let totalBytes = 0;
    for (const r of rels) {
      const f = m.files[r] as DictFile;
      totalBytes += f.bytes;
      if (sizes[`${base}${r}`] != null) {
        cachedFiles++;
        cachedBytes += f.bytes;
      }
    }
    const state = cachedFiles === 0 ? "none" : cachedFiles === rels.length ? "complete" : "partial";
    return { state, cachedFiles, totalFiles: rels.length, cachedBytes, totalBytes };
  }

  async function downloadAll(onProgress?: DownloadProgress, signal?: AbortSignal): Promise<void> {
    const m = await manifest();
    const rels = Object.keys(m.files);
    const urls = rels.map((r) => `${base}${r}`);
    let cached: Record<string, number | null>;
    try {
      cached = await api.listCached(urls, cacheName);
    } catch (e) {
      throw toLoadError(e);
    }
    const total = rels.reduce((s, r) => s + (m.files[r] as DictFile).bytes, 0);
    let done = rels.reduce((s, r) => s + (cached[`${base}${r}`] != null ? (m.files[r] as DictFile).bytes : 0), 0);
    onProgress?.(done, total);
    for (const rel of rels) {
      if (cached[`${base}${rel}`] != null) continue;
      if (signal?.aborted) throw new DictionaryLoadError("cancelled", "dictionary download cancelled");
      const size = (m.files[rel] as DictFile).bytes;
      await store(
        rel,
        m.files[rel] as DictFile,
        (loaded) => onProgress?.(done + Math.min(loaded, size), total),
        signal,
      );
      done += size;
      onProgress?.(done, total);
    }
  }

  async function deleteAll(): Promise<void> {
    shards.clear();
    indexP = null;
    try {
      await api.deleteCache(cacheName);
    } catch (e) {
      throw toLoadError(e);
    }
  }

  return { manifest, index, entry, offlineState, downloadAll, deleteAll };
}
