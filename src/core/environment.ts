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
 *        maxBufferSize and maxStorageBufferBindingSize; null if unavailable.
 *      - deviceMemoryGb: navigator.deviceMemory (Chromium only; rounded,
 *        capped at 8) or null; hardwareConcurrency.
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
 *   5. deleteCachedFiles(urls): Promise<void> — drop cache entries (used after
 *      an integrity mismatch so the files are downloaded again).
 *   6. Constants: MODEL_CACHE_NAME (the Transformers.js cache name; checked
 *      against the pinned version), PROBE_TIMEOUT_MS for slow adapters.
 *   7. Unit tests in environment.test.ts with stubbed globals.
 *
 * Dependencies:
 *   Browser APIs: navigator (gpu, deviceMemory, hardwareConcurrency, storage),
 *     WebAssembly, caches, crypto.subtle, fetch, crossOriginIsolated.
 *   No external libraries; no other layers.
 *   Used by: modules/preflight (preflight.ts).
 *
 * Network: fetchStaticJson only loads assets from the app's own static host
 *   (agents.md → Parser and worker code). No telemetry; results stay local.
 *
 * Open items (plan.md → Undecided): pre-flight checks (scope, thresholds);
 *   deployment target (COOP/COEP headers decide wasmThreads).
 *
 * Status: header only; not implemented.
 */
