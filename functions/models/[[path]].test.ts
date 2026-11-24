/**
 * functions/models/[[path]].test.ts — tests for the R2 model-file Function (T12)
 *
 * Fake R2 bucket; covers keys, whole files, byte ranges, HEAD, 304, 404, 405, 416, and the
 * read-only rule for every Function (no visitor can write to the bucket; owner, 2026-11-24; T99).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { onRequest as dictOnRequest } from "../dict/[[path]]";
import { type R2BucketLike, keyOf, onRequest, parseRange } from "./[[path]]";

const FILES: Record<string, string> = {
  "catalog.json": '{"models":[]}',
  "m/labels.json": '{"model_version":"1.0.0"}',
  "m/onnx/model_fp16.onnx": "0123456789",
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
    const text = r ? f.slice(r.offset, r.offset + r.length) : f;
    return { size: f.length, httpEtag: `"${key}"`, body: new Response(text).body };
  },
};

const call = (path: string, init: RequestInit = {}) =>
  onRequest({
    request: new Request(`https://app.test/models/${path}`, init),
    env: { MODELS: bucket },
    params: { path: path.split("/") },
  });

describe("keyOf and parseRange", () => {
  it("joins safe segments and rejects traversal", () => {
    expect(keyOf(["m", "onnx", "model.onnx"])).toBe("m/onnx/model.onnx");
    expect(keyOf(["..", "secret"])).toBeNull();
    expect(keyOf([])).toBeNull();
  });

  it("parses single byte ranges", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=2-5", 10)).toEqual({ offset: 2, length: 4 });
    expect(parseRange("bytes=7-", 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange("bytes=20-", 10)).toBe("invalid");
    expect(parseRange("bytes=1-2,4-5", 10)).toBe("invalid");
  });
});

describe("onRequest", () => {
  it("serves a whole file with type, length, ETag, and cache headers", async () => {
    const r = await call("m/onnx/model_fp16.onnx");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("0123456789");
    expect(r.headers.get("Content-Length")).toBe("10");
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Cache-Control")).toMatch(/max-age/);
    const c = await call("catalog.json");
    expect(c.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(c.headers.get("Cache-Control")).toBe("no-cache");
    expect((await call("m/labels.json")).headers.get("Cache-Control")).toBe("no-cache"); // T66
  });

  it("serves byte ranges (206) and rejects unsatisfiable ones (416)", async () => {
    const r = await call("m/onnx/model_fp16.onnx", { headers: { Range: "bytes=2-4" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(await r.text()).toBe("234");
    const bad = await call("m/onnx/model_fp16.onnx", { headers: { Range: "bytes=50-" } });
    expect(bad.status).toBe(416);
  });

  it("answers HEAD, conditional requests, missing files, and other methods", async () => {
    const h = await call("catalog.json", { method: "HEAD" });
    expect(h.status).toBe(200);
    expect(await h.text()).toBe("");
    expect((await call("catalog.json", { headers: { "If-None-Match": '"catalog.json"' } })).status).toBe(304);
    expect((await call("nope.json")).status).toBe(404);
    expect((await call("../x")).status).toBe(404);
    expect((await call("catalog.json", { method: "POST" })).status).toBe(405);
  });
});

describe("the bucket is read-only for visitors (owner, 2026-11-24; T99)", () => {
  const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  it("every Function refuses write methods without touching the bucket", async () => {
    const spied = {
      head: vi.fn<R2BucketLike["head"]>(async () => ({ size: 1, httpEtag: '"x"' })),
      get: vi.fn<R2BucketLike["get"]>(async () => ({ size: 1, httpEtag: '"x"', body: new Response("x").body })),
      put: vi.fn<() => Promise<void>>(async () => undefined),
      delete: vi.fn<() => Promise<void>>(async () => undefined),
      createMultipartUpload: vi.fn<() => Promise<void>>(async () => undefined),
    };
    for (const [prefix, handler] of [
      ["models", onRequest],
      ["dict", dictOnRequest],
    ] as const) {
      for (const method of WRITE_METHODS) {
        for (const path of ["catalog.json", "new/file.json"]) {
          const res = await handler({
            request: new Request(`https://app.test/${prefix}/${path}`, { method, body: "data" }),
            env: { MODELS: spied },
            params: { path: path.split("/") },
          });
          expect({ prefix, method, path, status: res.status }).toEqual({ prefix, method, path, status: 405 });
          expect(res.headers.get("Allow")).toBe("GET, HEAD");
        }
      }
    }
    for (const fn of Object.values(spied)) expect(fn).not.toHaveBeenCalled();
  });

  it("no Function's code calls a bucket write (put, delete, multipart upload)", () => {
    const root = join(import.meta.dirname, "..");
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const code = readFileSync(join(root, f), "utf8");
      expect({ f, writes: code.match(/\.(put|delete|createMultipartUpload|resumeMultipartUpload)\s*\(/g) }).toEqual({
        f,
        writes: null,
      });
    }
  });
});
