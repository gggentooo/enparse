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
 *   1. getModelStates(catalog): Promise<Record<ModelId, ModelState>> — which
 *      files of each model are cached (core/environment listCached) and their
 *      size on disk; partial downloads count as not downloaded.
 *   2. downloadModel(entry, variant, onProgress, signal): Promise<void> —
 *      download every missing file with core/environment downloadToCache
 *      (byte progress, AbortSignal); verify bytes and SHA-256 of each file
 *      against labels.json → files; on mismatch delete the file and retry
 *      once, then ModelDownloadError("integrity") and state "corrupted".
 *   3. cancelDownload(id): abort and delete partial files.
 *   4. deleteModel(entry): delete all of the model's cached files
 *      (core/environment deleteCachedFiles). The caller unloads it first if
 *      it is the active model.
 *   5. Any number of models may stay cached; storage is shown per model and
 *      pre-flight warns when free storage is low.
 *   6. Unit tests in downloads.test.ts with a stubbed core/environment.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./catalog.ts; core/environment.ts (listCached,
 *             downloadToCache, deleteCachedFiles, digestCachedFiles).
 *   Used by: ./index.ts.
 *
 * Network: static assets from the app's own host only.
 *
 * Status: header only; not implemented.
 */
