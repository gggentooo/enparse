/**
 * src/core/storage.ts — persistent storage wrapper
 *
 * Description:
 *   Async key-value persistence for the app. LocalStorage for small data,
 *   IndexedDB for larger datasets. Infrastructure layer: imports no other layer.
 *
 * Layer: core/
 *
 * Tasks:
 *   1. Async API: get<T>(key), set<T>(key, value), remove(key), keys(prefix).
 *   2. Pick backend per call site or by size threshold (STORAGE_SIZE_THRESHOLD, proposed).
 *   3. Values serialized as JSON; validate on read (unknown → narrowed by caller).
 *   4. Typed errors: StorageUnavailableError, StorageQuotaError.
 *   5. Namespace keys with an app prefix and schema version.
 *
 * Dependencies:
 *   Browser APIs: localStorage, indexedDB. No external libraries.
 *   Used by: modules/vocab (vocabManager), services (via modules).
 *
 * Design:
 *   - Keys are stored as `${namespace}:v${schemaVersion}:${key}` (default
 *     "enparse:v1:…"), so a schema change can migrate or ignore old data.
 *   - set() picks LocalStorage for small values and IndexedDB (database
 *     "enparse", store "kv") for values whose JSON is longer than
 *     STORAGE_SIZE_THRESHOLD characters, unless the caller names a backend;
 *     the key is removed from the other backend so one copy exists. get()
 *     checks LocalStorage, then IndexedDB.
 *   - If one backend is unavailable (blocked storage, private modes), the
 *     other is used; if neither is, calls throw StorageUnavailableError.
 *     Quota errors from either backend become StorageQuotaError.
 *   - Values are JSON; get() returns `unknown` and callers narrow it
 *     (agents.md: no `any`).
 *
 * Open items (todo.md): threshold (T27); backup and data-loss warnings.
 *
 * Status: implemented (T29). Tests: storage.test.ts (jsdom + fake-indexeddb).
 */

/** Prefix of every key the app stores. */
export const STORAGE_NAMESPACE = "enparse";
/** Storage schema version in every key; bump when stored shapes change incompatibly. */
export const STORAGE_SCHEMA_VERSION = 1;
/** Values whose JSON exceeds this many characters go to IndexedDB. (proposed; T27) */
export const STORAGE_SIZE_THRESHOLD = 100_000;
const IDB_NAME = "enparse";
const IDB_STORE = "kv";

/** Neither LocalStorage nor IndexedDB can be used (blocked or unsupported). */
export class StorageUnavailableError extends Error {
  constructor(message = "Browser storage is not available.") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

/** The browser refused to store more data (quota exceeded). */
export class StorageQuotaError extends Error {
  constructor(message = "Browser storage is full.") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

export type StorageBackendName = "local" | "indexeddb";

/** A string key-value backend. */
interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const isQuota = (e: unknown): boolean =>
  e instanceof DOMException &&
  (e.name === "QuotaExceededError" || e.code === 22 || e.name === "NS_ERROR_DOM_QUOTA_REACHED");

function localBackend(store: Storage): KvBackend {
  return {
    get: async (k) => store.getItem(k),
    set: async (k, v) => {
      try {
        store.setItem(k, v);
      } catch (e) {
        if (isQuota(e)) throw new StorageQuotaError();
        throw e;
      }
    },
    remove: async (k) => store.removeItem(k),
    keys: async () =>
      Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k !== null),
  };
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function indexedDbBackend(factory: IDBFactory): KvBackend {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const req = factory.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageUnavailableError(`IndexedDB: ${req.error?.message ?? "open failed"}`));
      req.onblocked = () => reject(new StorageUnavailableError("IndexedDB: open blocked"));
    });
    return db;
  };
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = (await open()).transaction(IDB_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new StorageUnavailableError("IndexedDB: transaction aborted"));
    });
    try {
      const result = await idbRequest(op(tx.objectStore(IDB_STORE)));
      await done;
      return result;
    } catch (e) {
      if (isQuota(e)) throw new StorageQuotaError();
      throw e;
    }
  };
  return {
    get: async (k) => {
      const v = await run("readonly", (s) => s.get(k) as IDBRequest<string | undefined>);
      return typeof v === "string" ? v : null;
    },
    set: async (k, v) => {
      await run("readwrite", (s) => s.put(v, k));
    },
    remove: async (k) => {
      await run("readwrite", (s) => s.delete(k));
    },
    keys: async () => (await run("readonly", (s) => s.getAllKeys())).map(String),
  };
}

/** Where the default storage finds its backends (tests pass their own). */
export type StorageOptions = {
  local?: Storage | null;
  indexedDB?: IDBFactory | null;
  namespace?: string;
  schemaVersion?: number;
};

/** The app's key-value storage. */
export type AppStorage = {
  /** Stored value (parsed JSON), or undefined if absent; narrow it before use. */
  get(key: string): Promise<unknown>;
  /** Store a JSON-serializable value; `backend` overrides the size rule. */
  set(key: string, value: unknown, options?: { backend?: StorageBackendName }): Promise<void>;
  remove(key: string): Promise<void>;
  /** Stored keys (without the namespace prefix) that start with `prefix`, sorted. */
  keys(prefix?: string): Promise<string[]>;
};

/** LocalStorage if usable (access can throw when storage is blocked). */
function defaultLocal(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${STORAGE_NAMESPACE}:probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Create a storage over the given (or the browser's) backends. */
export function createStorage(options: StorageOptions = {}): AppStorage {
  const localStore = options.local === undefined ? defaultLocal() : options.local;
  const factory = options.indexedDB === undefined ? (globalThis.indexedDB ?? null) : options.indexedDB;
  const backends: Partial<Record<StorageBackendName, KvBackend>> = {};
  if (localStore) backends.local = localBackend(localStore);
  if (factory) backends.indexeddb = indexedDbBackend(factory);
  const prefix = `${options.namespace ?? STORAGE_NAMESPACE}:v${options.schemaVersion ?? STORAGE_SCHEMA_VERSION}:`;
  const full = (key: string): string => {
    if (!key) throw new TypeError("storage key must not be empty");
    return prefix + key;
  };
  const available = (): KvBackend[] => {
    const list = [backends.local, backends.indexeddb].filter((b): b is KvBackend => b !== undefined);
    if (list.length === 0) throw new StorageUnavailableError();
    return list;
  };

  return {
    async get(key) {
      for (const b of available()) {
        const raw = await b.get(full(key));
        if (raw !== null) return JSON.parse(raw) as unknown;
      }
      return undefined;
    },
    async set(key, value, opts = {}) {
      available();
      const json = JSON.stringify(value);
      if (json === undefined) throw new TypeError("value is not JSON-serializable");
      const wanted: StorageBackendName = opts.backend ?? (json.length > STORAGE_SIZE_THRESHOLD ? "indexeddb" : "local");
      const target = backends[wanted] ?? backends[wanted === "local" ? "indexeddb" : "local"];
      if (!target) throw new StorageUnavailableError();
      await target.set(full(key), json);
      for (const b of available()) if (b !== target) await b.remove(full(key));
    },
    async remove(key) {
      for (const b of available()) await b.remove(full(key));
    },
    async keys(p = "") {
      const all = new Set<string>();
      for (const b of available())
        for (const k of await b.keys()) if (k.startsWith(prefix + p)) all.add(k.slice(prefix.length));
      return [...all].sort();
    },
  };
}

/** The app's storage (browser LocalStorage and IndexedDB), created on first use. */
let shared: AppStorage | null = null;
export function appStorage(): AppStorage {
  shared ??= createStorage();
  return shared;
}
