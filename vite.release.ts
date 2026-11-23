/**
 * vite.release.ts — local preview of the deployed site (`npm run preview:release`; T66)
 *
 * Description:
 *   `vite preview --mode release` serves the production build (dist/) like
 *   Cloudflare Pages, and /models/* and /dict/* through the real Pages
 *   Functions (functions/models/[[path]].ts, functions/dict/[[path]].ts) with
 *   a file-system stand-in for the R2 bucket MODELS whose keys are exactly
 *   what scripts/r2.ts uploads (public/models/, ONNX Runtime Web, the built
 *   dictionary). So the release can be checked end to end — downloads with
 *   ranges and ETags, integrity, loading, the service worker — before
 *   uploading (e2e/release.spec.ts runs on it: `npm run test:e2e:release`).
 *
 * Layer: build tooling (Vite plugin; preview server only). Never in builds.
 *
 * Status: implemented (T66).
 */

import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Plugin } from "vite";
import { onRequest as dictFunction } from "./functions/dict/[[path]].ts";
import { type R2BucketLike, onRequest as modelsFunction } from "./functions/models/[[path]].ts";
import { releaseObjects } from "./scripts/r2.ts";

/** R2 stand-in: the release objects read from disk (key → local file). */
export function fileBucket(files: ReadonlyMap<string, string>): R2BucketLike {
  const meta = (key: string) => {
    const path = files.get(key);
    if (!path) return null;
    const st = statSync(path);
    return { path, size: st.size, httpEtag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
  };
  return {
    async head(key) {
      const m = meta(key);
      return m && { size: m.size, httpEtag: m.httpEtag };
    },
    async get(key, options) {
      const m = meta(key);
      if (!m) return null;
      const r = options?.range;
      const stream = createReadStream(m.path, r ? { start: r.offset, end: r.offset + r.length - 1 } : undefined);
      return { size: m.size, httpEtag: m.httpEtag, body: Readable.toWeb(stream) as ReadableStream };
    },
  };
}

async function respond(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) return void res.end();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
  res.end();
}

/** Vite plugin: /models/* and /dict/* in `vite preview --mode release`. */
export function releasePreview(): Plugin {
  return {
    name: "enparse-release-preview",
    configurePreviewServer(server) {
      const { objects, missing } = releaseObjects();
      for (const m of missing) server.config.logger.warn(`[release] missing: ${m}`);
      const bucket = fileBucket(new Map(objects.map((o) => [o.key, o.path])));
      server.config.logger.info(`[release] /models and /dict from ${objects.length} release files (scripts/r2.ts)`);
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const [, route, ...rest] = url.pathname.split("/");
        const handler = route === "models" ? modelsFunction : route === "dict" ? dictFunction : null;
        if (!handler) return next();
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const request = new Request(url, { method: req.method, headers });
        const path = rest.map((p) => decodeURIComponent(p));
        handler({ request, env: { MODELS: bucket }, params: { path } }).then(
          (response) => respond(res, response),
          (e: unknown) => {
            res.statusCode = 500;
            res.end(String(e));
          },
        );
      });
    },
  };
}
