/**
 * src/modules/dictionary/staticDb.test.ts — dictionary data access (T46)
 *
 * Fake server and Cache Storage (testDictionary.ts): shard hash, manifest checks and its
 * offline copy, files downloaded once into the versioned cache, integrity retry, error
 * reasons, the offline download (progress, cancel, delete), and old-version cleanup.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DICTIONARY_CACHE_PREFIX, SHARD_CACHE_SIZE, asManifest, createStaticDb, fnv1a32, shardPath } from "./staticDb";
import { BASE, ENTRIES, fakeApi, serverFiles } from "./testDictionary";
import { DictionaryLoadError } from "./types";

const CACHE = `${DICTIONARY_CACHE_PREFIX}1`;

describe("shard hash", () => {
  it("matches the FNV-1a 32 reference values and the build's shard file names", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
    expect(fnv1a32("한국")).toBe(fnv1a32("한국")); // UTF-8 bytes, deterministic
    expect(shardPath("run", 128)).toBe(`shards/${String(fnv1a32("run") % 128).padStart(3, "0")}.json`);
  });

  const built = new URL("../../../training/data/dict/v1/manifest.json", import.meta.url);
  it.skipIf(!existsSync(built))("agrees with the built data (manifest → hash.example)", () => {
    const m = JSON.parse(readFileSync(built, "utf8")) as {
      hash: { shards: number; example: { key: string; shard: number } };
    };
    expect(fnv1a32(m.hash.example.key) % m.hash.shards).toBe(m.hash.example.shard);
  });
});

describe("manifest", () => {
  it("rejects data of another schema or without the index", () => {
    expect(() => asManifest({ schema: 2 })).toThrow(DictionaryLoadError);
    const m = JSON.parse(serverFiles()["manifest.json"] as string) as { files: Record<string, unknown> };
    delete m.files["index.json"];
    expect(() => asManifest(m)).toThrow(/no index/);
  });

  it("keeps a copy for offline use and falls back to it; without one, offline is a network error", async () => {
    const api = fakeApi();
    expect((await createStaticDb({ api }).manifest()).hash.shards).toBe(4);
    expect(api.caches.get(CACHE)?.has(`${BASE}manifest.json`)).toBe(true);
    api.offline = true;
    expect((await createStaticDb({ api }).manifest()).version).toBe(1);
    const fresh = fakeApi();
    fresh.offline = true;
    await expect(createStaticDb({ api: fresh }).manifest()).rejects.toMatchObject({ reason: "network" });
  });

  it("deletes caches of other data versions", async () => {
    const api = fakeApi();
    api.caches.set(`${DICTIONARY_CACHE_PREFIX}0`, new Map());
    api.caches.set("transformers-cache", new Map());
    await createStaticDb({ api }).manifest();
    await new Promise((r) => setTimeout(r, 0));
    expect([...api.caches.keys()].sort()).toEqual([CACHE, "transformers-cache"]);
  });
});

describe("entries", () => {
  it("downloads the index and a shard once into the versioned cache, then reads them from it", async () => {
    const api = fakeApi();
    const db = createStaticDb({ api });
    const run = await db.entry("run");
    expect(run).toMatchObject({
      key: "run",
      headword: "run",
      examples: [{ ko: "우유가 떨어졌다.", tatoeba: [2, 102] }],
    });
    expect(run?.pos[0]).toEqual({
      upos: "VERB",
      from: "wordnet",
      senses: [{ definition: "move fast", examples: ["move fast (example)"] }],
      korean: [{ sense: "to move quickly", words: ["달리다", "뛰다"] }],
    });
    expect(api.downloads).toEqual([`${BASE}index.json`, `${BASE}${shardPath("run", 4)}`]);
    expect(await db.entry("nope")).toBeNull();
    // A new instance (next visit) reads the cache: no downloads.
    const again = createStaticDb({ api });
    api.downloads.length = 0;
    expect((await again.entry("look up"))?.headword).toBe("look up");
    expect(api.downloads.filter((u) => u.endsWith("index.json"))).toEqual([]);
  });

  it("keeps the most recently used shards in memory and reads the others from the cache again", async () => {
    expect(SHARD_CACHE_SIZE).toBe(16);
    const api = fakeApi();
    const reads: string[] = [];
    const read = api.readCached;
    api.readCached = async (url, name) => {
      reads.push(url);
      return read(url, name);
    };
    const db = createStaticDb({ api, shardCacheSize: 1 });
    const [a, b] = ["run", "see"];
    expect(shardPath(a, 4)).not.toBe(shardPath(b, 4));
    await db.entry(a);
    await db.entry(a);
    const shardReads = (): number => reads.filter((u) => u.endsWith(shardPath(a, 4))).length;
    const once = shardReads();
    await db.entry(b); // evicts a's shard
    await db.entry(a);
    expect(shardReads()).toBe(once + 1);
  });

  it("retries a corrupt download once, then reports an integrity error", async () => {
    const api = fakeApi();
    api.corrupt.set(`${BASE}index.json`, 1);
    expect((await createStaticDb({ api }).entry("saw"))?.headword).toBe("saw");
    const bad = fakeApi();
    bad.corrupt.set(`${BASE}index.json`, 2);
    await expect(createStaticDb({ api: bad }).entry("saw")).rejects.toMatchObject({ reason: "integrity" });
    expect(bad.caches.get(CACHE)?.has(`${BASE}index.json`)).toBe(false);
  });

  it("reports a full cache as storage and malformed data as format", async () => {
    const api = fakeApi();
    api.full = true;
    await expect(createStaticDb({ api }).entry("run")).rejects.toMatchObject({ reason: "storage" });
    const files = serverFiles();
    files["manifest.json"] = '{"schema": 1, "version": 1}';
    await expect(createStaticDb({ api: fakeApi(files) }).entry("run")).rejects.toMatchObject({ reason: "format" });
  });
});

describe("offline download", () => {
  it("reports none, partial, and complete, with byte progress and nothing downloaded twice", async () => {
    const api = fakeApi();
    const db = createStaticDb({ api });
    expect((await db.offlineState()).state).toBe("none");
    await db.entry("run");
    const partial = await db.offlineState();
    expect(partial).toMatchObject({ state: "partial", cachedFiles: 2, totalFiles: 5 });
    const progress: Array<[number, number]> = [];
    api.downloads.length = 0;
    await db.downloadAll((done, total) => progress.push([done, total]));
    expect(api.downloads).toHaveLength(3);
    const [first, last] = [progress[0], progress.at(-1)];
    expect(first?.[0]).toBe(partial.cachedBytes);
    expect(last?.[0]).toBe(last?.[1]);
    expect(await db.offlineState()).toMatchObject({ state: "complete", cachedFiles: 5 });
    expect(Object.keys(ENTRIES)).toHaveLength(5);
  });

  it("stops on cancel, and deleteAll empties the cache", async () => {
    const api = fakeApi();
    const db = createStaticDb({ api });
    const ac = new AbortController();
    ac.abort();
    await expect(db.downloadAll(undefined, ac.signal)).rejects.toMatchObject({ reason: "cancelled" });
    await db.downloadAll();
    await db.deleteAll();
    expect(api.caches.has(CACHE)).toBe(false);
    expect((await db.offlineState()).state).toBe("none");
    // Lookups still work after deleting: files are downloaded again on demand.
    expect((await db.entry("run"))?.headword).toBe("run");
  });
});
