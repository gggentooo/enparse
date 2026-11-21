/**
 * src/pwa/swRules.test.ts — service worker rules (T69)
 */

import { describe, expect, it } from "vitest";
import { shellCacheName, shouldHandle, staleShellCaches, withIsolationHeaders } from "./swRules";

const scope = new URL("https://app.test/");

describe("shouldHandle", () => {
  it("answers same-origin GETs in scope, never models, dictionary, other origins, or other methods", () => {
    expect(shouldHandle("GET", new URL("https://app.test/assets/index.js"), scope)).toBe(true);
    expect(shouldHandle("GET", new URL("https://app.test/"), scope)).toBe(true);
    expect(shouldHandle("GET", new URL("https://app.test/models/catalog.json"), scope)).toBe(false);
    expect(shouldHandle("GET", new URL("https://app.test/models/_ort/ort.wasm"), scope)).toBe(false);
    expect(shouldHandle("GET", new URL("https://app.test/dict/v1/index.json"), scope)).toBe(false);
    expect(shouldHandle("GET", new URL("https://cdn.example.com/x.js"), scope)).toBe(false);
    expect(shouldHandle("POST", new URL("https://app.test/assets/index.js"), scope)).toBe(false);
    expect(shouldHandle("GET", new URL("https://app.test/other/x"), new URL("https://app.test/app/"))).toBe(false);
  });
});

describe("caches and headers", () => {
  it("deletes only older app-shell caches", () => {
    const current = shellCacheName("v2");
    expect(staleShellCaches(["enparse-shell-v1", current, "transformers-cache", "enparse-dict-v1"], current)).toEqual([
      "enparse-shell-v1",
    ]);
  });

  it("re-applies the isolation headers to cached pages", async () => {
    const res = withIsolationHeaders(new Response("<html></html>", { headers: { "Content-Type": "text/html" } }));
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Content-Type")).toBe("text/html");
    expect(await res.text()).toBe("<html></html>");
  });
});
