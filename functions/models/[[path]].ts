/**
 * functions/models/[[path]].ts — Cloudflare Pages Function: model files from R2 on the app's origin
 *
 * Description:
 *   Serves GET/HEAD /models/<path> from the R2 bucket bound as MODELS (key =
 *   <path>, e.g. "catalog.json", "deberta_v3_xsmall/onnx/model_fp16.onnx",
 *   "_ort/ort-wasm-simd-threaded.asyncify.wasm" for ONNX Runtime Web),
 *   so model files stay on the app's own origin (agents.md → Parser and worker
 *   code) while ONNX files larger than Pages' 25 MiB per-file limit live in
 *   R2 (owner, 2026-11-21; T12). Supports single byte ranges (206) for
 *   streaming downloads; integrity is checked by the app (SHA-256 in
 *   labels.json → files), not here.
 *
 * Layer: deployment (not an app layer; runs on Cloudflare, never in the browser).
 *
 * Read-only (owner, 2026-11-24; T99): visitors must never be able to put data
 *   in the bucket. Only GET and HEAD are answered (405 otherwise), and
 *   R2BucketLike has no write method, so a write cannot be typed here by
 *   accident. Do not add one; a test fails if any Function calls put/delete.
 *
 * Bindings: MODELS (R2 bucket). Configured in the Cloudflare Pages project
 *   settings (no wrangler dependency in this repo).
 *
 * Status: implemented (T12). Tests: [[path]].test.ts (fake bucket). Range
 *   behavior on real R2 and Cache Storage interplay are verified in T31.
 */

/** The part of an R2 object the function uses (subset of @cloudflare/workers-types). */
export interface R2ObjectLike {
  size: number;
  httpEtag: string;
  body?: ReadableStream | null;
}

/** The part of an R2 bucket the function uses: reads only (never add put or delete; see the header). */
export interface R2BucketLike {
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
}

export type Env = { MODELS: R2BucketLike };

type Context = { request: Request; env: Env; params: { path?: string | string[] } };

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: "application/json; charset=utf-8",
  onnx: "application/octet-stream",
  onnx_data: "application/octet-stream",
  model: "application/octet-stream",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  wasm: "application/wasm",
};

/** Seconds a client may reuse a file without revalidating (catalog.json always revalidates). */
export const MODEL_FILE_MAX_AGE = 86_400;

/**
 * catalog.json and every labels.json always revalidate (ETag → 304): a new release changes them at
 * the same URL, and the worker reads labels.json over the network (T66).
 */
export const revalidates = (key: string): boolean => key === "catalog.json" || key.endsWith("/labels.json");

/** R2 key for the request path, or null if it is not a safe relative path. */
export function keyOf(path: string | string[] | undefined): string | null {
  const parts = (Array.isArray(path) ? path : (path ?? "").split("/")).filter((p) => p !== "");
  if (parts.length === 0 || parts.some((p) => p === "." || p === ".." || p.includes("\\"))) return null;
  return parts.join("/");
}

/** Single byte range from a Range header ("bytes=a-b", "bytes=a-", "bytes=-n"); null = whole file; "invalid" = 416. */
export function parseRange(header: string | null, size: number): { offset: number; length: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}

function headersFor(key: string, obj: R2ObjectLike): Headers {
  const ext = key.split(".").pop() ?? "";
  const h = new Headers();
  h.set("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  h.set("ETag", obj.httpEtag);
  h.set("Accept-Ranges", "bytes");
  h.set("Cache-Control", revalidates(key) ? "no-cache" : `public, max-age=${MODEL_FILE_MAX_AGE}`);
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

/** Pages Function entry (named export; Pages routes /models/* here). */
export async function onRequest({ request, env, params }: Context): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const key = keyOf(params.path);
  if (key === null) return new Response("Not Found", { status: 404 });
  const meta = await env.MODELS.head(key);
  if (!meta) return new Response("Not Found", { status: 404 });
  const headers = headersFor(key, meta);
  if (request.headers.get("If-None-Match") === meta.httpEtag) return new Response(null, { status: 304, headers });

  const range = parseRange(request.headers.get("Range"), meta.size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${meta.size}`);
    return new Response("Range Not Satisfiable", { status: 416, headers });
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${meta.size}`);
    headers.set("Content-Length", String(range.length));
  } else headers.set("Content-Length", String(meta.size));
  const status = range ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });

  const obj = await env.MODELS.get(key, range ? { range } : undefined);
  if (!obj?.body) return new Response("Not Found", { status: 404 });
  return new Response(obj.body, { status, headers });
}
