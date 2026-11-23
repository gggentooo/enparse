/**
 * functions/dict/[[path]].ts — Cloudflare Pages Function: dictionary data from R2 on the app's origin
 *
 * Description:
 *   Serves GET/HEAD /dict/<path> (e.g. "v1/manifest.json", "v1/index.json",
 *   "v1/shards/042.json") from the R2 bucket bound as MODELS under the key
 *   prefix "dict/", so the dictionary stays on the app's own origin like the
 *   models (owner, 2026-11-23; T42, T70). Files of a data version never change
 *   (a new build is a new version, /dict/v<N+1>/), so they are cached for a
 *   year; manifest.json revalidates. Byte ranges and validation reuse the
 *   model route (../models/[[path]].ts); integrity is checked by the app
 *   (manifest → files: size and SHA-256).
 *
 * Layer: deployment (not an app layer; runs on Cloudflare, never in the browser).
 *
 * Bindings: MODELS (the same R2 bucket as the models; dictionary keys start with "dict/").
 *
 * Status: implemented (T70). Tests: [[path]].test.ts (fake bucket).
 */

import { type R2BucketLike, type R2ObjectLike, keyOf, parseRange } from "../models/[[path]]";

export type Env = { MODELS: R2BucketLike };

type Context = { request: Request; env: Env; params: { path?: string | string[] } };

/** R2 key prefix of the dictionary data. */
export const DICT_PREFIX = "dict/";
/** Seconds a client may reuse a versioned dictionary file (immutable; manifest.json revalidates). */
export const DICT_FILE_MAX_AGE = 31_536_000;

function headersFor(key: string, obj: R2ObjectLike): Headers {
  const h = new Headers();
  h.set("Content-Type", key.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream");
  h.set("ETag", obj.httpEtag);
  h.set("Accept-Ranges", "bytes");
  h.set(
    "Cache-Control",
    key.endsWith("/manifest.json") ? "no-cache" : `public, max-age=${DICT_FILE_MAX_AGE}, immutable`,
  );
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

/** Pages Function entry (named export; Pages routes /dict/* here). */
export async function onRequest({ request, env, params }: Context): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const rel = keyOf(params.path);
  if (rel === null) return new Response("Not Found", { status: 404 });
  const key = DICT_PREFIX + rel;
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
