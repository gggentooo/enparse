/**
 * src/modules/dictionary/testDictionary.ts — test-only dictionary data and a fake cache API
 *
 * A small dictionary in the T70 format (manifest, index, 4 shards) on a fake server, and an
 * in-memory Cache Storage with the core functions' behaviour (size and SHA-256 checks,
 * AbortError, AssetError reasons). Imported only by *.test.ts files (not bundled).
 */

import { createHash } from "node:crypto";
import { AssetError } from "../../core/environment";
import type { DictCacheApi } from "./staticDb";
import { shardPath } from "./staticDb";

export const BASE = "/dict/v1/";
export const SHARDS = 4;

const pos = (upos: string, defs: string[], ko: Array<[string, string[]]> = [], from = "wordnet") => ({
  upos,
  from,
  senses: defs.map((def) => ({ def, examples: [`${def} (example)`] })),
  ko: ko.map(([sense, words]) => ({ sense, words })),
});

/** Raw entries as the build writes them (key → entry). */
export const ENTRIES: Record<string, unknown> = {
  run: {
    headword: "run",
    pos: [pos("VERB", ["move fast"], [["to move quickly", ["달리다", "뛰다"]]]), pos("NOUN", ["a score"])],
    examples: [{ en: "We ran out of milk.", ko: "우유가 떨어졌다.", tatoeba: [2, 102] }],
  },
  saw: { headword: "saw", pos: [pos("NOUN", ["a cutting tool"], [["tool", ["톱"]]])], examples: [] },
  see: { headword: "see", pos: [pos("VERB", ["perceive by sight"], [["perceive", ["보다"]]])], examples: [] },
  "look up": { headword: "look up", pos: [pos("VERB", ["seek information from"])], examples: [] },
  "run out": {
    headword: "run out",
    pos: [pos("VERB", ["be used up"], [["to have none left", ["떨어지다"]]])],
    examples: [],
  },
  look: {
    headword: "look",
    pos: [
      pos("NOUN", ["the act of looking"]),
      pos("VERB", ["perceive with attention", "appear"], [["to try to see", ["보다"]]]),
    ],
    examples: [],
  },
  i: {
    headword: "I",
    pos: [pos("NOUN", ["the letter"]), pos("PRON", ["the speaker"], [["self", ["나"]]], "wiktionary")],
    examples: [],
  },
};
export const FORMS: Record<string, string[]> = {
  ran: ["run"],
  saw: ["see"],
  me: ["i"],
  "looked up": ["look up"],
  runs: ["run"],
};

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Server files of version 1 (relative path → body), including manifest.json. */
export function serverFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const byShard: Record<string, Record<string, unknown>> = {};
  for (let n = 0; n < SHARDS; n++) byShard[`shards/${String(n).padStart(3, "0")}.json`] = {};
  for (const [k, e] of Object.entries(ENTRIES)) (byShard[shardPath(k, SHARDS)] as Record<string, unknown>)[k] = e;
  for (const [rel, obj] of Object.entries(byShard)) files[rel] = JSON.stringify(obj);
  files["index.json"] = JSON.stringify({
    schema: 1,
    version: 1,
    headwords: Object.keys(ENTRIES).sort(),
    forms: FORMS,
  });
  const meta = Object.fromEntries(
    Object.entries(files).map(([rel, body]) => [
      rel,
      { bytes: new TextEncoder().encode(body).length, sha256: sha(body) },
    ]),
  );
  files["manifest.json"] = JSON.stringify({
    schema: 1,
    version: 1,
    built: "2026-11-23",
    license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
    hash: { name: "fnv1a32-utf8", shards: SHARDS },
    sources: [
      {
        key: "wordnet",
        name: "Open English WordNet 2025",
        url: "https://en-word.net/",
        license: "CC BY 4.0",
        license_url: "https://creativecommons.org/licenses/by/4.0/",
        attribution: "Open English WordNet",
      },
    ],
    files: meta,
  });
  return files;
}

export type FakeApi = DictCacheApi & {
  server: Map<string, string>;
  caches: Map<string, Map<string, string>>;
  downloads: string[];
  /** Fail fetchJson (offline). */
  offline: boolean;
  /** URL → number of corrupt downloads still to serve. */
  corrupt: Map<string, number>;
  /** Fail cache writes (quota). */
  full: boolean;
};

export function fakeApi(files: Record<string, string> = serverFiles()): FakeApi {
  const server = new Map(Object.entries(files).map(([rel, body]) => [`${BASE}${rel}`, body]));
  const caches = new Map<string, Map<string, string>>();
  const cache = (name: string): Map<string, string> => {
    if (!caches.has(name)) caches.set(name, new Map());
    return caches.get(name) as Map<string, string>;
  };
  const api: FakeApi = {
    server,
    caches,
    downloads: [],
    offline: false,
    corrupt: new Map(),
    full: false,
    async fetchJson(url) {
      if (api.offline) throw new TypeError("Failed to fetch");
      const body = server.get(url);
      if (body === undefined) throw new AssetError("http", url, `HTTP 404 for ${url}`);
      return JSON.parse(body);
    },
    async listCached(urls, name) {
      return Object.fromEntries(
        urls.map((u) => [u, cache(name).has(u) ? (cache(name).get(u) as string).length : null]),
      );
    },
    async downloadToCache(url, expected, onProgress, signal, name) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (api.offline) throw new TypeError("Failed to fetch");
      api.downloads.push(url);
      let body = server.get(url);
      if (body === undefined) throw new AssetError("http", url, `HTTP 404 for ${url}`);
      const bad = api.corrupt.get(url) ?? 0;
      if (bad > 0) {
        api.corrupt.set(url, bad - 1);
        body = `${body} `;
      }
      const bytes = new TextEncoder().encode(body).length;
      onProgress?.(bytes, expected.bytes);
      if (bytes !== expected.bytes) throw new AssetError("size", url, "size mismatch");
      if (sha(body) !== expected.sha256) throw new AssetError("sha256", url, "SHA-256 mismatch");
      if (api.full) throw new AssetError("cache", url, "quota exceeded");
      cache(name).set(url, body);
      return { bytes, sha256: expected.sha256 };
    },
    async readCached(url, name) {
      const body = cache(name).get(url);
      return body === undefined ? null : (new TextEncoder().encode(body).buffer as ArrayBuffer);
    },
    async putCached(url, body, _type, name) {
      if (api.full) throw new AssetError("cache", url, "quota exceeded");
      cache(name).set(url, body);
    },
    async cacheNames() {
      return [...caches.keys()];
    },
    async deleteCache(name) {
      return caches.delete(name);
    },
  };
  return api;
}
