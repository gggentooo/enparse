/**
 * src/modules/modelLibrary/downloads.ts — download, verify, and delete model files
 *
 * Description:
 *   Manages model files in Cache Storage (the cache Transformers.js reads,
 *   so the worker loads from it without downloading again). Downloads are
 *   explicit user actions; nothing is downloaded until the user chooses a
 *   model (plan.md → model library decisions).
 *
 * Layer: modules/ (modelLibrary)
 *
 * Tasks:
 *   1. getModelStates(catalog, preferred?): Promise<Record<ModelId, ModelState>>
 *      — which files of each model are cached (core/environment listCached)
 *      and their size on disk; partial downloads count as not downloaded.
 *      A model downloading now reports its live progress; a model whose last
 *      download failed verification reports "corrupted" until it is
 *      downloaded or deleted. `preferred` picks the variant checked first
 *      when both are cached.
 *   2. downloadModel(entry, variant, onProgress, signal): Promise<void> —
 *      download every missing file with core/environment downloadToCache
 *      (byte progress, AbortSignal), which checks bytes and SHA-256 against
 *      the catalog (labels.json → files) before storing. On a mismatch the
 *      file is deleted and fetched once more; a second mismatch deletes the
 *      variant's files and rejects with ModelDownloadError("integrity")
 *      (state "corrupted"). A call for a model already downloading the same
 *      variant returns the running download; another variant cancels it first.
 *   3. cancelDownload(id): abort and delete the files this download stored;
 *      resolves once the download has stopped. The download rejects with
 *      ModelDownloadError("cancelled").
 *   4. deleteModel(entry): delete all of the model's cached files (every
 *      variant; core/environment deleteCachedFiles), cancelling a running
 *      download first. The caller unloads it first if it is the active model.
 *   5. Any number of models may stay cached; storage is shown per model and
 *      pre-flight warns when free storage is low. storage.persist() after the
 *      first download is the caller's step (parserService, T24/T52).
 *   6. createDownloads(cache) builds an instance over an injected cache API
 *      (tests); the exported functions use core/environment.
 *   7. Unit tests in downloads.test.ts with a fake cache API.
 *
 * Error mapping (ModelDownloadError.reason):
 *   AssetError size/sha256 (twice) → integrity; AbortError → cancelled;
 *   QuotaExceededError or AssetError("cache") (no Cache Storage) → quota;
 *   anything else (fetch TypeError, AssetError http/origin) → network.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./catalog.ts; core/environment.ts (listCached,
 *             downloadToCache, deleteCachedFiles).
 *   Used by: ./index.ts.
 *
 * Network: static assets from the app's own host only.
 *
 * Status: implemented (T47). Tests: downloads.test.ts.
 */

import { AssetError, deleteCachedFiles, downloadToCache, type FileDigest, listCached } from "../../core/environment";
import { modelFiles } from "./catalog";
import {
  type Catalog,
  type CatalogEntry,
  type DownloadFailure,
  ModelDownloadError,
  type ModelId,
  type ModelState,
  type VariantName,
} from "./types";

/** Times a file that fails verification is fetched again before the download fails (T24). */
export const INTEGRITY_RETRIES = 1;

/** The model-cache functions downloads.ts needs (core/environment; injectable for tests). */
export interface ModelCacheApi {
  listCached(urls: readonly string[]): Promise<Record<string, number | null>>;
  downloadToCache(
    url: string,
    expected: FileDigest,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<FileDigest>;
  deleteCachedFiles(urls: readonly string[]): Promise<void>;
}

/** Byte progress over all files of a model (already cached files count as done). */
export type DownloadProgress = (bytesDone: number, bytesTotal: number) => void;

export type Downloads = {
  getModelStates(catalog: Catalog, preferred?: VariantName): Promise<Record<ModelId, ModelState>>;
  downloadModel(
    entry: CatalogEntry,
    variant: VariantName,
    onProgress?: DownloadProgress,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelDownload(id: ModelId): Promise<void>;
  deleteModel(entry: CatalogEntry): Promise<void>;
};

type Active = {
  variant: VariantName;
  controller: AbortController;
  promise: Promise<void>;
  bytesDone: number;
  bytesTotal: number;
};

const VARIANTS: readonly VariantName[] = ["int8", "fp16"];

const isAbort = (e: unknown): boolean => (e instanceof DOMException || e instanceof Error) && e.name === "AbortError";
const isIntegrity = (e: unknown): boolean => e instanceof AssetError && (e.reason === "size" || e.reason === "sha256");

function failureOf(e: unknown): DownloadFailure {
  if (isAbort(e)) return "cancelled";
  if (isIntegrity(e)) return "integrity";
  if ((e instanceof DOMException || e instanceof Error) && e.name === "QuotaExceededError") return "quota";
  if (e instanceof AssetError && e.reason === "cache") return "quota";
  return "network";
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Every URL the model may have cached, across its variants (shared files once). */
function allUrls(entry: CatalogEntry): string[] {
  const urls = new Set<string>();
  for (const v of VARIANTS) if (entry.variants[v]) for (const f of modelFiles(entry, v)) urls.add(f.url);
  return [...urls];
}

/** A downloads instance over a model-cache API (default: core/environment). */
export function createDownloads(cache: ModelCacheApi): Downloads {
  const active = new Map<ModelId, Active>();
  const corrupted = new Set<ModelId>();

  async function getModelStates(catalog: Catalog, preferred?: VariantName): Promise<Record<ModelId, ModelState>> {
    const out: Record<ModelId, ModelState> = {};
    const order = preferred ? [preferred, ...VARIANTS.filter((v) => v !== preferred)] : VARIANTS;
    for (const entry of catalog.models) {
      const running = active.get(entry.id);
      if (running) {
        out[entry.id] = {
          state: "downloading",
          bytesDone: running.bytesDone,
          bytesTotal: running.bytesTotal,
          variant: running.variant,
        };
        continue;
      }
      const sizes = await cache.listCached(allUrls(entry));
      let state: ModelState = corrupted.has(entry.id) ? { state: "corrupted" } : { state: "not-downloaded" };
      for (const v of order) {
        if (!entry.variants[v]) continue;
        const files = modelFiles(entry, v);
        // A file counts only at its exact expected size; anything else is partial or stale.
        if (files.every((f) => sizes[f.url] === f.bytes)) {
          state = { state: "downloaded", bytesOnDisk: files.reduce((s, f) => s + f.bytes, 0), variant: v };
          break;
        }
      }
      out[entry.id] = state;
    }
    return out;
  }

  async function run(
    entry: CatalogEntry,
    variant: VariantName,
    record: Active,
    onProgress: DownloadProgress | undefined,
  ): Promise<void> {
    const signal = record.controller.signal;
    const files = modelFiles(entry, variant);
    const stored: string[] = [];
    let current: string | null = null;
    const report = (): void => onProgress?.(record.bytesDone, record.bytesTotal);
    try {
      const sizes = await cache.listCached(files.map((f) => f.url));
      const missing = files.filter((f) => sizes[f.url] !== f.bytes);
      record.bytesDone = record.bytesTotal - missing.reduce((s, f) => s + f.bytes, 0);
      report();
      for (const f of missing) {
        current = f.url;
        const before = record.bytesDone;
        const expected: FileDigest = { bytes: f.bytes, sha256: f.sha256 };
        for (let attempt = 0; ; attempt++) {
          if (signal.aborted) throw new DOMException("download cancelled", "AbortError");
          try {
            await cache.downloadToCache(
              f.url,
              expected,
              (loaded) => {
                record.bytesDone = before + Math.min(loaded, f.bytes);
                report();
              },
              signal,
            );
            break;
          } catch (e) {
            if (!isIntegrity(e) || attempt >= INTEGRITY_RETRIES) throw e;
            await cache.deleteCachedFiles([f.url]);
            record.bytesDone = before;
            report();
          }
        }
        stored.push(f.url);
        current = null;
        record.bytesDone = before + f.bytes;
        report();
      }
      corrupted.delete(entry.id);
    } catch (e) {
      const reason = failureOf(e);
      if (reason === "integrity") {
        // Drop this run's files and the bad one; files from earlier downloads (e.g. shared
        // tokenizer files another cached variant uses) stay, since they were verified then.
        await cache.deleteCachedFiles(current ? [...stored, current] : stored).catch(() => undefined);
        corrupted.add(entry.id);
      } else if (reason === "cancelled") {
        await cache.deleteCachedFiles(stored).catch(() => undefined);
      }
      throw new ModelDownloadError(reason, `${entry.id} (${variant}): ${messageOf(e)}`);
    }
  }

  async function downloadModel(
    entry: CatalogEntry,
    variant: VariantName,
    onProgress?: DownloadProgress,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = active.get(entry.id);
    if (current) {
      if (current.variant === variant) return current.promise;
      await cancelDownload(entry.id);
    }
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const record: Active = {
      variant,
      controller,
      promise: Promise.resolve(),
      bytesDone: 0,
      bytesTotal: modelFiles(entry, variant).reduce((s, f) => s + f.bytes, 0),
    };
    record.promise = run(entry, variant, record, onProgress).finally(() => {
      if (active.get(entry.id) === record) active.delete(entry.id);
    });
    active.set(entry.id, record);
    return record.promise;
  }

  async function cancelDownload(id: ModelId): Promise<void> {
    const current = active.get(id);
    if (!current) return;
    current.controller.abort();
    await current.promise.catch(() => undefined);
  }

  async function deleteModel(entry: CatalogEntry): Promise<void> {
    await cancelDownload(entry.id);
    await cache.deleteCachedFiles(allUrls(entry));
    corrupted.delete(entry.id);
  }

  return { getModelStates, downloadModel, cancelDownload, deleteModel };
}

const defaultDownloads = createDownloads({ listCached, downloadToCache, deleteCachedFiles });

/** Download state of every catalog model on this device. */
export const getModelStates: Downloads["getModelStates"] = defaultDownloads.getModelStates;
/** Download and verify a model variant into the model cache (user action only). */
export const downloadModel: Downloads["downloadModel"] = defaultDownloads.downloadModel;
/** Abort a running download and delete the files it stored. */
export const cancelDownload: Downloads["cancelDownload"] = defaultDownloads.cancelDownload;
/** Delete all of a model's cached files (unload it first if active). */
export const deleteModel: Downloads["deleteModel"] = defaultDownloads.deleteModel;
