/**
 * src/core/environment.test.ts — unit tests for probes and model-cache functions (T30, T38)
 *
 * Browser globals (navigator, location, caches, fetch, crossOriginIsolated) are stubbed;
 * Node provides crypto.subtle, Blob, Response, and WebAssembly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheNames,
  deleteCache,
  deleteCachedFiles,
  digestCachedFiles,
  downloadToCache,
  fetchStaticJson,
  listCached,
  MODEL_CACHE_NAME,
  probeEnvironment,
  putCached,
  readCached,
  requestPersistentStorage,
  sameOriginUrl,
  AssetError,
} from "./environment";

const ORIGIN = "https://app.test";

/** In-memory CacheStorage with string keys (absolute URLs). */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name) as Map<string, Response>;
    return {
      match: async (k: string) => m.get(k)?.clone(),
      put: async (k: string, r: Response) => void m.set(k, r),
      delete: async (k: string) => m.delete(k),
    };
  };
  const keys = async () => [...stores.keys()];
  const del = async (name: string) => stores.delete(name);
  return { stores, caches: { open, keys, delete: del } };
}

async function hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => {
  vi.stubGlobal("location", { href: `${ORIGIN}/#/input`, origin: ORIGIN });
});
afterEach(() => vi.unstubAllGlobals());

describe("probeEnvironment", () => {
  it("reports capabilities, WebGPU limits with shader-f16, and storage", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("caches", {});
    vi.stubGlobal("navigator", {
      deviceMemory: 8,
      hardwareConcurrency: 4,
      gpu: {
        requestAdapter: async () => ({
          limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28 },
          features: new Set(["shader-f16"]),
        }),
      },
      storage: { estimate: async () => ({ quota: 10e9, usage: 1e6 }), persisted: async () => false },
    });
    const p = await probeEnvironment();
    expect(p).toMatchObject({
      webAssembly: true,
      wasmSimd: true,
      wasmThreads: true,
      crossOriginIsolated: true,
      webgpu: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28, shaderF16: true },
      deviceMemoryGb: 8,
      hardwareConcurrency: 4,
      cacheStorage: true,
      storage: { quotaBytes: 10e9, usageBytes: 1e6 },
      persisted: false,
    });
    expect(p.moduleWorkers).toBe(false); // Node has no Worker
  });

  it("reports missing features, an adapter without shader-f16, and failures as unknown", async () => {
    vi.stubGlobal("crossOriginIsolated", false);
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: async () => ({
          limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1 },
          features: new Set(),
        }),
      },
      storage: { estimate: async () => Promise.reject(new Error("denied")) },
    });
    const p = await probeEnvironment();
    expect(p.wasmThreads).toBe(false);
    expect(p.webgpu).toMatchObject({ shaderF16: false });
    expect(p.storage).toBe("unknown");
    expect(p.persisted).toBeNull();
    expect(p.cacheStorage).toBe(false);
    expect(p.deviceMemoryGb).toBeNull();
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    expect((await probeEnvironment()).webgpu).toBeNull();
  });

  it("requests persistent storage and returns false when unavailable", async () => {
    vi.stubGlobal("navigator", { storage: { persist: async () => true } });
    expect(await requestPersistentStorage()).toBe(true);
    vi.stubGlobal("navigator", {});
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe("same-origin assets", () => {
  it("resolves relative URLs and rejects other origins", async () => {
    expect(sameOriginUrl("/models/catalog.json")).toBe(`${ORIGIN}/models/catalog.json`);
    expect(() => sameOriginUrl("https://cdn.example.com/x.json")).toThrow(AssetError);
    vi.stubGlobal("fetch", async (u: string) => new Response(JSON.stringify({ url: u }), { status: 200 }));
    expect(await fetchStaticJson("/models/catalog.json")).toEqual({ url: `${ORIGIN}/models/catalog.json` });
    vi.stubGlobal("fetch", async () => new Response("no", { status: 404 }));
    await expect(fetchStaticJson("/x.json")).rejects.toMatchObject({ reason: "http" });
  });
});

describe("model cache", () => {
  const url = "/models/m/onnx/model_quantized.onnx";
  const abs = `${ORIGIN}${url}`;
  const body = "0123456789".repeat(100);

  it("downloads with progress, verifies, and stores under the absolute URL in the Transformers.js cache", async () => {
    const { stores, caches } = fakeCaches();
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("fetch", async () => new Response(body, { headers: { "Content-Type": "application/octet-stream" } }));
    const progress: number[] = [];
    const d = await downloadToCache(url, { bytes: body.length, sha256: await hex(body) }, (loaded) =>
      progress.push(loaded),
    );
    expect(d).toEqual({ bytes: 1000, sha256: await hex(body) });
    expect(progress.at(-1)).toBe(1000);
    expect([...(stores.get(MODEL_CACHE_NAME)?.keys() ?? [])]).toEqual([abs]);
    expect(await listCached([url, "/models/m/other.json"])).toEqual({ [url]: 1000, "/models/m/other.json": null });
    expect(await digestCachedFiles([url])).toEqual({ [url]: { bytes: 1000, sha256: await hex(body) } });
    await deleteCachedFiles([url]);
    expect(await listCached([url])).toEqual({ [url]: null });
  });

  it("stores nothing when the size or SHA-256 is wrong, or the server fails", async () => {
    const { stores, caches } = fakeCaches();
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("fetch", async () => new Response(body));
    await expect(downloadToCache(url, { bytes: 999, sha256: await hex(body) })).rejects.toMatchObject({
      reason: "size",
    });
    await expect(downloadToCache(url, { bytes: 1000, sha256: "00" })).rejects.toMatchObject({ reason: "sha256" });
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(downloadToCache(url, { bytes: 1000, sha256: "00" })).rejects.toMatchObject({ reason: "http" });
    expect(stores.get(MODEL_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it("reports a failing cache.put as a storage (cache) error, not a download error", async () => {
    // Chrome's private windows reject large entries with "Unexpected internal error" (T31 spike).
    const open = async () => ({
      match: async () => undefined,
      put: async () => {
        throw new DOMException("Unexpected internal error.", "UnknownError");
      },
      delete: async () => false,
    });
    vi.stubGlobal("caches", { open });
    vi.stubGlobal("fetch", async () => new Response(body));
    await expect(downloadToCache(url, { bytes: 1000, sha256: await hex(body) })).rejects.toMatchObject({
      name: "AssetError",
      reason: "cache",
    });
  });

  it("uses another cache by name: read, store, list names, delete (dictionary, T46)", async () => {
    const { stores, caches } = fakeCaches();
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("fetch", async () => new Response(body));
    await downloadToCache("/dict/v1/a.json", { bytes: 1000, sha256: await hex(body) }, undefined, undefined, "dict-v1");
    expect(stores.get(MODEL_CACHE_NAME)).toBeUndefined();
    expect(await listCached(["/dict/v1/a.json"], "dict-v1")).toEqual({ "/dict/v1/a.json": 1000 });
    expect(new TextDecoder().decode((await readCached("/dict/v1/a.json", "dict-v1")) as ArrayBuffer)).toBe(body);
    expect(await readCached("/dict/v1/none.json", "dict-v1")).toBeNull();
    await putCached("/dict/v1/manifest.json", '{"v":1}', "application/json", "dict-v1");
    expect(new TextDecoder().decode((await readCached("/dict/v1/manifest.json", "dict-v1")) as ArrayBuffer)).toBe(
      '{"v":1}',
    );
    expect(await digestCachedFiles(["/dict/v1/a.json"], "dict-v1")).toEqual({
      "/dict/v1/a.json": { bytes: 1000, sha256: await hex(body) },
    });
    await deleteCachedFiles(["/dict/v1/a.json"], "dict-v1");
    expect(await readCached("/dict/v1/a.json", "dict-v1")).toBeNull();
    expect(await cacheNames()).toEqual(["dict-v1"]);
    expect(await deleteCache("dict-v1")).toBe(true);
    expect(await cacheNames()).toEqual([]);
  });

  it("refuses other origins, reports a missing Cache Storage, and passes aborts through", async () => {
    vi.stubGlobal("caches", fakeCaches().caches);
    await expect(downloadToCache("https://cdn.example.com/m.onnx", { bytes: 1, sha256: "0" })).rejects.toMatchObject({
      reason: "origin",
    });
    const ac = new AbortController();
    vi.stubGlobal("fetch", async (_u: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(body);
    });
    ac.abort();
    await expect(downloadToCache(url, { bytes: 1000, sha256: "0" }, undefined, ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    vi.stubGlobal("caches", undefined);
    await expect(listCached([url])).rejects.toMatchObject({ reason: "cache" });
  });
});
