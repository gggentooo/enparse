/**
 * functions/dict/[[path]].test.ts — tests for the R2 dictionary Function (T70)
 *
 * Fake R2 bucket; covers the "dict/" key prefix, cache headers, ranges, HEAD, 304, 404, 405.
 */

import { describe, expect, it } from "vitest";
import type { R2BucketLike } from "../models/[[path]]";
import { DICT_PREFIX, onRequest } from "./[[path]]";

const FILES: Record<string, string> = {
  "dict/v1/manifest.json": '{"version":1}',
  "dict/v1/shards/042.json": '{"run":{}}',
  "v1/shards/042.json": "model-bucket root, not dictionary",
};

const bucket: R2BucketLike = {
  async head(key) {
    const f = FILES[key];
    return f === undefined ? null : { size: f.length, httpEtag: `"${key}"` };
  },
  async get(key, options) {
    const f = FILES[key];
    if (f === undefined) return null;
    const r = options?.range;
    return {
      size: f.length,
      httpEtag: `"${key}"`,
      body: new Response(r ? f.slice(r.offset, r.offset + r.length) : f).body,
    };
  },
};

const call = (path: string, init: RequestInit = {}) =>
  onRequest({
    request: new Request(`https://app.test/dict/${path}`, init),
    env: { MODELS: bucket },
    params: { path: path.split("/") },
  });

describe("dict onRequest", () => {
  it("serves files under the dict/ prefix; versioned files are immutable, the manifest revalidates", async () => {
    expect(DICT_PREFIX).toBe("dict/");
    const s = await call("v1/shards/042.json");
    expect(s.status).toBe(200);
    expect(await s.text()).toBe('{"run":{}}');
    expect(s.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(s.headers.get("Cache-Control")).toMatch(/immutable/);
    const m = await call("v1/manifest.json");
    expect(m.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("answers ranges, HEAD, and If-None-Match", async () => {
    const r = await call("v1/shards/042.json", { headers: { Range: "bytes=0-3" } });
    expect(r.status).toBe(206);
    expect(await r.text()).toBe('{"ru');
    const h = await call("v1/manifest.json", { method: "HEAD" });
    expect(h.status).toBe(200);
    expect(h.headers.get("Content-Length")).toBe("13");
    const n = await call("v1/manifest.json", { headers: { "If-None-Match": '"dict/v1/manifest.json"' } });
    expect(n.status).toBe(304);
  });

  it("rejects unknown files, traversal, and other methods", async () => {
    expect((await call("v1/shards/999.json")).status).toBe(404);
    expect((await call("../catalog.json")).status).toBe(404);
    expect((await call("v1/manifest.json", { method: "POST" })).status).toBe(405);
  });
});
