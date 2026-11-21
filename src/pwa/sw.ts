/**
 * src/pwa/sw.ts — the app's service worker (hand-written; owner, T69)
 *
 * Description:
 *   Makes the app installable and its shell work offline (T15). Built into dist/sw.js
 *   by vite.config.ts (pwaServiceWorker), which injects __PRECACHE__: the build's files
 *   and a version hash.
 *   - install: cache every app-shell file in enparse-shell-<version>; the new version
 *     then waits (no automatic takeover).
 *   - activate: delete older enparse-shell-* caches only, then control open pages.
 *   - message "skip-waiting": the page's update prompt accepted the new version.
 *   - fetch: only requests allowed by ./swRules.ts (never /models/* or /dict/*).
 *     Page loads go to the network first and fall back to the cached shell offline,
 *     with COOP/COEP re-applied; other shell files are served from the cache first.
 *
 * Layer: pwa (runs in the service worker scope, not in the page).
 * Status: implemented (T69). Rules tested in swRules.test.ts; checked in Chrome
 *   (offline reload, cross-origin isolation, /models not intercepted).
 */

/// <reference lib="webworker" />

import { shellCacheName, shouldHandle, staleShellCaches, withIsolationHeaders } from "./swRules";

// oxlint-disable-next-line no-underscore-dangle -- build-time constant injected by vite.config.ts
declare const __PRECACHE__: { version: string; files: string[] };

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = shellCacheName(__PRECACHE__.version);
const scope = (): URL => new URL(sw.registration.scope);

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(__PRECACHE__.files.map((f) => new URL(f, scope()).href))),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleShellCaches(names, CACHE).map((n) => caches.delete(n))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void sw.skipWaiting();
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!shouldHandle(request.method, url, scope())) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await caches.match(new URL("index.html", scope()).href, { cacheName: CACHE, ignoreVary: true });
        return shell ? withIsolationHeaders(shell) : Response.error();
      }),
    );
    return;
  }
  // ignoreVary: shell files were cached without an Origin header, but module scripts are
  // requested with one, and servers send "Vary: Origin" (Vite preview does).
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit ?? fetch(request)));
});
