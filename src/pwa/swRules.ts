/**
 * src/pwa/swRules.ts — what the service worker may handle, and how (pure; T69)
 *
 * Description:
 *   Rules shared by the service worker (./sw.ts) and its tests: the app-shell cache name
 *   (versioned), which requests the worker may answer (GET, same origin, inside the app's
 *   scope; never /models/* or /dict/*, whose files live in their own caches and keep their
 *   own headers), and the cross-origin isolation headers re-applied to cached pages.
 *
 * Layer: pwa (no imports). Used by: ./sw.ts, vite.config.ts (cache prefix), tests.
 * Status: implemented (T69). Tests: swRules.test.ts.
 */

/** App-shell caches start with this; other caches (transformers-cache, enparse-dict-*) are never touched. */
export const SHELL_CACHE_PREFIX = "enparse-shell-";

/** Paths the service worker never answers (model and dictionary files; dev and bench tooling). */
export const EXCLUDED_PATH_PREFIXES: readonly string[] = ["/models/", "/dict/", "/__"];

/** Headers of public/_headers that cached HTML must keep (multi-threaded WASM needs isolation). */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export function shellCacheName(version: string): string {
  return SHELL_CACHE_PREFIX + version;
}

/** Whether the worker may answer this request (otherwise the browser fetches it normally). */
export function shouldHandle(method: string, url: URL, scope: URL): boolean {
  if (method !== "GET") return false;
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return false;
  return !EXCLUDED_PATH_PREFIXES.some((p) => url.pathname.startsWith(p));
}

/** Old app-shell caches to delete when a new version activates. */
export function staleShellCaches(cacheNames: readonly string[], current: string): string[] {
  return cacheNames.filter((n) => n.startsWith(SHELL_CACHE_PREFIX) && n !== current);
}

/** A copy of a response with the isolation headers set (cached pages served offline). */
export function withIsolationHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
