/**
 * src/core/environment.ts — browser capability probes and model-file cache access
 *
 * Description:
 *   Thin wrappers around browser APIs that the pre-flight checks need. Returns
 *   plain data; makes no decisions (the rules live in modules/preflight).
 *   Infrastructure layer: imports no other layer. Works on the main thread
 *   and in workers (uses `globalThis`, not `window`).
 *
 * Layer: core/
 *
 * Tasks:
 *   1. probeEnvironment(): Promise<EnvironmentProbe> — one snapshot of:
 *      - moduleWorkers: module Web Workers supported.
 *      - webAssembly: WebAssembly present; wasmSimd: SIMD validated with a
 *        tiny module (WebAssembly.validate); wasmThreads: crossOriginIsolated
 *        and SharedArrayBuffer available.
 *      - webgpu: adapter found (navigator.gpu.requestAdapter()), with
 *        maxBufferSize, maxStorageBufferBindingSize, and shaderF16 (the
 *        `shader-f16` feature the fp16 models need; T67); null if unavailable.
 *      - deviceMemoryGb: navigator.deviceMemory (Chromium only; coarse,
 *        as reported; Chrome 158 reports up to 32) or null; hardwareConcurrency.
 *      - cacheStorage: Cache API available; storage: navigator.storage.estimate()
 *        quota and usage (null if unavailable); persisted (storage.persisted()).
 *      Every probe catches its own errors and reports "unknown" instead of
 *      throwing.
 *   2. requestPersistentStorage(): Promise<boolean> — navigator.storage.persist().
 *   3. fetchStaticJson(url): Promise<unknown> — GET a JSON asset from the
 *      app's own static host (labels.json). Rejects other origins.
 *   4. digestCachedFiles(urls): Promise<Record<url, { bytes, sha256 } | null>>
 *      — read entries from Cache Storage (the cache Transformers.js uses),
 *      SHA-256 via crypto.subtle; null for files not cached.
 *   5. deleteCachedFiles(urls): Promise<void> — drop cache entries (after an
 *      integrity mismatch, or when the user deletes a model).
 *   5b. listCached(urls): Promise<Record<url, number | null>> — cached size per
 *      file (null if absent), without hashing.
 *   5c. downloadToCache(url, expected { bytes, sha256 }, onProgress, signal):
 *      Promise<void> — stream the file with byte progress, check size and
 *      SHA-256, then store it in the model cache; abortable. A failing
 *      cache.put becomes AssetError("cache") (storage, not network).
 *   T31 spike (2026-11-21; training/reports/benchmark.md): MODEL_CACHE_NAME is
 *   "transformers-cache" and entries are keyed by the absolute URL
 *   <origin>/models/<model-id>/<file>; Transformers.js 4.3.2 then loads them
 *   without fetching. Whole-file crypto.subtle.digest is fast enough (302 MB
 *   in ≤ 0.26 s), so downloadToCache hashes the assembled Blob once.
 *   5d. Every cache function takes an optional cache name (default
 *      MODEL_CACHE_NAME), so the dictionary keeps its files in its own
 *      versioned cache (T46); readCached, putCached, cacheNames, deleteCache.
 *   6. Constants: MODEL_CACHE_NAME (the Transformers.js cache name; checked
 *      against the pinned version), PROBE_TIMEOUT_MS for slow adapters.
 *   7. Unit tests in environment.test.ts with stubbed globals.
 *
 * Dependencies:
 *   Browser APIs: navigator (gpu, deviceMemory, hardwareConcurrency, storage),
 *     WebAssembly, caches, crypto.subtle, fetch, crossOriginIsolated.
 *   No external libraries; no other layers.
 *   Used by: modules/preflight (preflight.ts), modules/modelLibrary
 *            (catalog.ts, downloads.ts), modules/dictionary (staticDb.ts).
 *
 * Network: fetchStaticJson only loads assets from the app's own static host
 *   (agents.md → Parser and worker code). No telemetry; results stay local.
 *
 * Errors: AssetError with a reason (origin, http, size, sha256, cache) for
 *   fetchStaticJson and the model-cache functions; aborts surface as the
 *   fetch AbortError (DOMException).
 *
 * Open items (todo.md): pre-flight thresholds (T65).
 *
 * Status: implemented (T30 probes, T38 cache functions; cache names and dictionary helpers T46).
 *   Tests: environment.test.ts.
 */

/** Cache Storage name Transformers.js 4.3.2 uses (`env.cacheKey`); model files live here (T31). */
export const MODEL_CACHE_NAME = "transformers-cache";
/** Longest wait for slow probes (WebGPU adapter, storage estimate). */
export const PROBE_TIMEOUT_MS = 3000;

/** Unknown when a probe failed or timed out. */
export type Probe<T> = T | "unknown";

export type WebGpuProbe = {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  /** The adapter supports `shader-f16` (needed by the fp16 model variants). */
  shaderF16: boolean;
};

/** One snapshot of the browser's capabilities (plain data; modules/preflight decides). */
export type EnvironmentProbe = {
  moduleWorkers: Probe<boolean>;
  webAssembly: boolean;
  wasmSimd: Probe<boolean>;
  /** crossOriginIsolated and SharedArrayBuffer (multi-threaded WASM). */
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  webgpu: Probe<WebGpuProbe | null>;
  /** navigator.deviceMemory (Chromium; coarse) or null. */
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  cacheStorage: boolean;
  storage: Probe<{ quotaBytes: number; usageBytes: number } | null>;
  persisted: Probe<boolean | null>;
};

/** Why an asset request or a model-cache operation failed. */
export type AssetErrorReason = "origin" | "http" | "size" | "sha256" | "cache";

/** A static asset or model file could not be fetched, verified, or cached. */
export class AssetError extends Error {
  readonly reason: AssetErrorReason;
  readonly url: string;
  constructor(reason: AssetErrorReason, url: string, message: string) {
    super(message);
    this.name = "AssetError";
    this.reason = reason;
    this.url = url;
  }
}

// -- probes (T30) --------------------------------------------------------------------------

type NavigatorLike = {
  gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> };
  deviceMemory?: number;
  hardwareConcurrency?: number;
  storage?: {
    estimate?(): Promise<{ quota?: number; usage?: number }>;
    persisted?(): Promise<boolean>;
    persist?(): Promise<boolean>;
  };
};
type GpuAdapterLike = {
  limits: { maxBufferSize: number; maxStorageBufferBindingSize: number };
  features: { has(f: string): boolean };
};

const nav = (): NavigatorLike | undefined => (globalThis as { navigator?: NavigatorLike }).navigator;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<Probe<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("unknown"), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve("unknown");
      },
    );
  });
}

/** Smallest module using a SIMD instruction (v128 const + i8x16 splat); from wasm-feature-detect. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

function probeModuleWorkers(): Probe<boolean> {
  const W = (globalThis as { Worker?: new (url: string | URL, options?: WorkerOptions) => Worker }).Worker;
  if (typeof W !== "function") return false;
  let supported = false;
  // The constructor reads options.type only if it supports module workers.
  const options = {
    get type(): WorkerType {
      supported = true;
      return "module";
    },
  };
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
    new W(url, options).terminate();
  } catch {
    if (!supported) return "unknown";
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
  return supported;
}

async function probeWebGpu(): Promise<WebGpuProbe | null> {
  const gpu = nav()?.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter();
  if (!adapter) return null;
  return {
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    shaderF16: adapter.features.has("shader-f16"),
  };
}

/** One snapshot of the environment; every probe catches its own errors. */
export async function probeEnvironment(): Promise<EnvironmentProbe> {
  const g = globalThis as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown; caches?: unknown };
  const n = nav();
  const webAssembly = typeof WebAssembly === "object" && typeof WebAssembly.validate === "function";
  let wasmSimd: Probe<boolean> = false;
  if (webAssembly) {
    try {
      wasmSimd = WebAssembly.validate(SIMD_PROBE);
    } catch {
      wasmSimd = "unknown";
    }
  }
  const isolated = g.crossOriginIsolated === true;
  const store = n?.storage;
  const [webgpu, storage, persisted] = await Promise.all([
    withTimeout(probeWebGpu(), PROBE_TIMEOUT_MS),
    store?.estimate
      ? withTimeout(
          store.estimate().then((e) => ({ quotaBytes: e.quota ?? 0, usageBytes: e.usage ?? 0 })),
          PROBE_TIMEOUT_MS,
        )
      : Promise.resolve(null),
    store?.persisted ? withTimeout(store.persisted(), PROBE_TIMEOUT_MS) : Promise.resolve(null),
  ]);
  const memory = n?.deviceMemory;
  return {
    moduleWorkers: probeModuleWorkers(),
    webAssembly,
    wasmSimd,
    wasmThreads: isolated && typeof g.SharedArrayBuffer === "function",
    crossOriginIsolated: isolated,
    webgpu,
    deviceMemoryGb: typeof memory === "number" ? memory : null,
    hardwareConcurrency: typeof n?.hardwareConcurrency === "number" ? n.hardwareConcurrency : null,
    cacheStorage: typeof g.caches === "object" && g.caches !== null,
    storage,
    persisted,
  };
}

/** Ask the browser to keep this site's storage (models, vocab) under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await nav()?.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// -- same-origin assets --------------------------------------------------------------------

/** Absolute URL of a same-origin asset; throws AssetError("origin") for other origins. */
export function sameOriginUrl(url: string): string {
  const base = (globalThis as { location?: { href: string } }).location?.href;
  if (!base) throw new AssetError("origin", url, "no page location to resolve the asset URL against");
  const abs = new URL(url, base);
  if (abs.origin !== new URL(base).origin) {
    throw new AssetError("origin", url, `assets may only come from this site's origin, not ${abs.origin}`);
  }
  return abs.href;
}

/** GET a JSON asset from the app's own origin (labels.json, catalog.json). */
export async function fetchStaticJson(url: string): Promise<unknown> {
  const abs = sameOriginUrl(url);
  const res = await fetch(abs);
  if (!res.ok) throw new AssetError("http", abs, `HTTP ${res.status} for ${abs}`);
  return res.json();
}

// -- model cache (T38; contract from the T31 spike) ----------------------------------------

/** Expected size and SHA-256 (hex) of a model file (labels.json → files). */
export type FileDigest = { bytes: number; sha256: string };

function cacheStorage(url: string): CacheStorage {
  const c = (globalThis as { caches?: CacheStorage }).caches;
  if (!c) throw new AssetError("cache", url, "Cache Storage is not available");
  return c;
}

async function modelCache(url: string, name: string = MODEL_CACHE_NAME): Promise<Cache> {
  return cacheStorage(url).open(name);
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cached size in bytes per URL (null if not cached), without hashing. */
export async function listCached(
  urls: readonly string[],
  cacheName: string = MODEL_CACHE_NAME,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (urls.length === 0) return out;
  const cache = await modelCache(urls[0] as string, cacheName);
  for (const url of urls) {
    const res = await cache.match(sameOriginUrl(url));
    if (!res) out[url] = null;
    else {
      const len = Number(res.headers.get("Content-Length"));
      out[url] = Number.isFinite(len) && len > 0 ? len : (await res.blob()).size;
    }
  }
  return out;
}

/**
 * Download one model file into the model cache: stream with byte progress, then check size and
 * SHA-256 against `expected` before storing (under its absolute same-origin URL, where
 * Transformers.js finds it). Nothing is stored if a check fails. Abortable with `signal`.
 */
export async function downloadToCache(
  url: string,
  expected: FileDigest,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  cacheName: string = MODEL_CACHE_NAME,
): Promise<FileDigest> {
  const abs = sameOriginUrl(url);
  const cache = await modelCache(abs, cacheName);
  const res = await fetch(abs, signal ? { signal } : {});
  if (!res.ok || !res.body) throw new AssetError("http", abs, `HTTP ${res.status} for ${abs}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, expected.bytes);
  }
  const blob = new Blob(chunks as BlobPart[]);
  if (blob.size !== expected.bytes) {
    throw new AssetError("size", abs, `expected ${expected.bytes} bytes, got ${blob.size}`);
  }
  const sha256 = await sha256Hex(await blob.arrayBuffer());
  if (sha256 !== expected.sha256.toLowerCase()) throw new AssetError("sha256", abs, `SHA-256 mismatch for ${abs}`);
  const type = res.headers.get("Content-Type") ?? "application/octet-stream";
  try {
    await cache.put(
      abs,
      new Response(blob, { headers: { "Content-Type": type, "Content-Length": String(blob.size) } }),
    );
  } catch (e) {
    // Storing failed (quota, or a private window's small storage: Chrome reports "Unexpected internal
    // error" for a 302 MB file). Report it as a storage problem, not a download problem.
    throw new AssetError("cache", abs, `could not store ${abs}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { bytes: blob.size, sha256 };
}

/** Size and SHA-256 of each cached file (null if not cached): the pre-load integrity check. */
export async function digestCachedFiles(
  urls: readonly string[],
  cacheName: string = MODEL_CACHE_NAME,
): Promise<Record<string, FileDigest | null>> {
  const out: Record<string, FileDigest | null> = {};
  if (urls.length === 0) return out;
  const cache = await modelCache(urls[0] as string, cacheName);
  for (const url of urls) {
    const res = await cache.match(sameOriginUrl(url));
    if (!res) out[url] = null;
    else {
      const data = await res.arrayBuffer();
      out[url] = { bytes: data.byteLength, sha256: await sha256Hex(data) };
    }
  }
  return out;
}

/** Remove files from the model cache (integrity mismatch, or the user deleted the model). */
export async function deleteCachedFiles(urls: readonly string[], cacheName: string = MODEL_CACHE_NAME): Promise<void> {
  if (urls.length === 0) return;
  const cache = await modelCache(urls[0] as string, cacheName);
  for (const url of urls) await cache.delete(sameOriginUrl(url));
}

// -- other caches (dictionary data, T46) -----------------------------------------------------

/** Body of a cached same-origin file, or null if it is not in the cache. */
export async function readCached(url: string, cacheName: string): Promise<ArrayBuffer | null> {
  const res = await (await modelCache(url, cacheName)).match(sameOriginUrl(url));
  return res ? res.arrayBuffer() : null;
}

/** Store a small same-origin file (e.g. a manifest kept for offline use); a failing put → AssetError("cache"). */
export async function putCached(url: string, body: string, contentType: string, cacheName: string): Promise<void> {
  const abs = sameOriginUrl(url);
  const cache = await modelCache(abs, cacheName);
  try {
    await cache.put(abs, new Response(body, { headers: { "Content-Type": contentType } }));
  } catch (e) {
    throw new AssetError("cache", abs, `could not store ${abs}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Names of the app's Cache Storage caches ([] if Cache Storage is missing). */
export async function cacheNames(): Promise<string[]> {
  const c = (globalThis as { caches?: CacheStorage }).caches;
  return c ? c.keys() : [];
}

/** Delete a whole cache (true if it existed). */
export async function deleteCache(cacheName: string): Promise<boolean> {
  const c = (globalThis as { caches?: CacheStorage }).caches;
  return c ? c.delete(cacheName) : false;
}
