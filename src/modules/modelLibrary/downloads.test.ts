/**
 * src/modules/modelLibrary/downloads.test.ts — model states, verified downloads, retry, cancel, delete (T47)
 */

import { describe, expect, it } from "vitest";
import { AssetError, type FileDigest } from "../../core/environment";
import { downloadBytes, modelFiles, parseCatalog } from "./catalog";
import fixture from "./catalog.fixture.json";
import { createDownloads, type ModelCacheApi } from "./downloads";
import { type CatalogEntry, ModelDownloadError } from "./types";

const catalog = parseCatalog(fixture);
const entry = catalog.models[0] as CatalogEntry;
const int8 = modelFiles(entry, "int8");
const fp16 = modelFiles(entry, "fp16");

/** Per-URL behavior of the next downloadToCache call; default: store the file. */
type Step = "ok" | Error | ((signal?: AbortSignal) => Promise<void>);

/** In-memory model cache with scripted download outcomes. */
function fakeCache(): ModelCacheApi & {
  files: Map<string, number>;
  steps: Map<string, Step[]>;
  fetched: string[];
  deleted: string[];
} {
  const files = new Map<string, number>();
  const steps = new Map<string, Step[]>();
  const fetched: string[] = [];
  const deleted: string[] = [];
  return {
    files,
    steps,
    fetched,
    deleted,
    async listCached(urls) {
      return Object.fromEntries(urls.map((u) => [u, files.get(u) ?? null]));
    },
    async downloadToCache(url: string, expected: FileDigest, onProgress, signal) {
      fetched.push(url);
      const step = steps.get(url)?.shift() ?? "ok";
      if (step instanceof Error) throw step;
      onProgress?.(Math.floor(expected.bytes / 2), expected.bytes);
      if (typeof step === "function") await step(signal);
      onProgress?.(expected.bytes, expected.bytes);
      files.set(url, expected.bytes);
      return expected;
    },
    async deleteCachedFiles(urls) {
      for (const u of urls) {
        deleted.push(u);
        files.delete(u);
      }
    },
  };
}

const cacheAll = (c: ReturnType<typeof fakeCache>, list: typeof int8): void => {
  for (const f of list) c.files.set(f.url, f.bytes);
};
const sha = (url: string): AssetError => new AssetError("sha256", url, "SHA-256 mismatch");
/** A download step that waits until the signal aborts. */
const hang: Step = (signal) =>
  new Promise((_, reject) =>
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }),
  );
const rejection = async (p: Promise<unknown>): Promise<ModelDownloadError> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ModelDownloadError) return e;
    throw e;
  }
  throw new Error("expected a rejection");
};

describe("getModelStates", () => {
  it("reports not-downloaded, downloaded (size on disk), and treats partial or wrong-size files as missing", async () => {
    const c = fakeCache();
    const d = createDownloads(c);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "not-downloaded" });

    cacheAll(c, int8.slice(0, -1));
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "not-downloaded" });

    cacheAll(c, int8);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({
      state: "downloaded",
      bytesOnDisk: downloadBytes(entry, "int8"),
      variant: "int8",
    });

    c.files.set(int8[1]!.url, 1);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "not-downloaded" });
  });

  it("checks the preferred variant first when both are cached", async () => {
    const c = fakeCache();
    cacheAll(c, int8);
    cacheAll(c, fp16);
    const d = createDownloads(c);
    expect((await d.getModelStates(catalog))[entry.id]).toMatchObject({ variant: "int8" });
    expect((await d.getModelStates(catalog, "fp16"))[entry.id]).toMatchObject({ variant: "fp16" });
  });
});

describe("downloadModel", () => {
  it("fetches only missing files, with monotonic byte progress up to the total", async () => {
    const c = fakeCache();
    cacheAll(c, int8.slice(0, 2));
    const d = createDownloads(c);
    const progress: Array<[number, number]> = [];
    await d.downloadModel(entry, "int8", (done, total) => progress.push([done, total]));

    expect(c.fetched).toEqual(int8.slice(2).map((f) => f.url));
    const total = downloadBytes(entry, "int8");
    expect(progress.every(([, t]) => t === total)).toBe(true);
    expect(progress[0]![0]).toBe(int8[0]!.bytes + int8[1]!.bytes);
    expect(progress.at(-1)).toEqual([total, total]);
    for (let i = 1; i < progress.length; i++) expect(progress[i]![0]).toBeGreaterThanOrEqual(progress[i - 1]![0]);
    expect((await d.getModelStates(catalog))[entry.id]).toMatchObject({ state: "downloaded", variant: "int8" });
  });

  it("deletes a file that fails verification and fetches it once more", async () => {
    const c = fakeCache();
    const bad = int8.at(-1)!.url;
    c.steps.set(bad, [sha(bad), "ok"]);
    const d = createDownloads(c);
    await d.downloadModel(entry, "int8");
    expect(c.fetched.filter((u) => u === bad)).toHaveLength(2);
    expect(c.deleted).toEqual([bad]);
    expect((await d.getModelStates(catalog))[entry.id]).toMatchObject({ state: "downloaded" });
  });

  it("fails with integrity after the retry, deletes this run's files, keeps earlier ones, and reports corrupted", async () => {
    const c = fakeCache();
    const earlier = int8[0]!.url;
    c.files.set(earlier, int8[0]!.bytes);
    const bad = int8.at(-1)!.url;
    c.steps.set(bad, [sha(bad), new AssetError("size", bad, "short")]);
    const d = createDownloads(c);

    const err = await rejection(d.downloadModel(entry, "int8"));
    expect(err.reason).toBe("integrity");
    expect([...c.files.keys()]).toEqual([earlier]);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "corrupted" });

    await d.downloadModel(entry, "int8");
    expect((await d.getModelStates(catalog))[entry.id]).toMatchObject({ state: "downloaded" });
  });

  it("maps quota and network failures without retrying", async () => {
    const c = fakeCache();
    const first = int8[0]!.url;
    c.steps.set(first, [new DOMException("full", "QuotaExceededError"), new TypeError("Failed to fetch")]);
    const d = createDownloads(c);
    expect((await rejection(d.downloadModel(entry, "int8"))).reason).toBe("quota");
    expect((await rejection(d.downloadModel(entry, "int8"))).reason).toBe("network");
    expect(c.fetched).toEqual([first, first]);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "not-downloaded" });
  });

  it("returns the running download for the same variant", async () => {
    const c = fakeCache();
    const d = createDownloads(c);
    await Promise.all([d.downloadModel(entry, "int8"), d.downloadModel(entry, "int8")]);
    expect(c.fetched).toEqual(int8.map((f) => f.url));
  });
});

describe("cancel and delete", () => {
  it("cancelDownload aborts, deletes the files this run stored, and reports progress while running", async () => {
    const c = fakeCache();
    const last = int8.at(-1)!.url;
    c.steps.set(last, [hang]);
    const d = createDownloads(c);
    const running = rejection(d.downloadModel(entry, "int8"));
    await new Promise((r) => setTimeout(r, 0));

    const state = (await d.getModelStates(catalog))[entry.id];
    expect(state).toMatchObject({ state: "downloading", variant: "int8", bytesTotal: downloadBytes(entry, "int8") });

    await d.cancelDownload(entry.id);
    expect((await running).reason).toBe("cancelled");
    expect(c.files.size).toBe(0);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "not-downloaded" });
  });

  it("an aborted caller signal cancels the download", async () => {
    const c = fakeCache();
    c.steps.set(int8[1]!.url, [hang]);
    const d = createDownloads(c);
    const ac = new AbortController();
    const running = rejection(d.downloadModel(entry, "int8", undefined, ac.signal));
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect((await running).reason).toBe("cancelled");
    expect(c.files.size).toBe(0);
  });

  it("a different variant cancels the running download first", async () => {
    const c = fakeCache();
    c.steps.set(int8.at(-1)!.url, [hang]);
    const d = createDownloads(c);
    const first = rejection(d.downloadModel(entry, "int8"));
    await new Promise((r) => setTimeout(r, 0));
    await d.downloadModel(entry, "fp16");
    expect((await first).reason).toBe("cancelled");
    expect((await d.getModelStates(catalog))[entry.id]).toMatchObject({ state: "downloaded", variant: "fp16" });
  });

  it("deleteModel removes every variant's files", async () => {
    const c = fakeCache();
    cacheAll(c, int8);
    cacheAll(c, fp16);
    const d = createDownloads(c);
    await d.deleteModel(entry);
    expect(c.files.size).toBe(0);
    expect((await d.getModelStates(catalog))[entry.id]).toEqual({ state: "not-downloaded" });
  });
});
