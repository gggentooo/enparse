/**
 * src/modules/modelLibrary/index.ts — public API of the model library module
 *
 * Description:
 *   The models the user can choose from: the catalog of offered models, the
 *   download state of each one on this device, downloading (with progress
 *   and integrity verification) and deleting model files, the user's
 *   persisted choice, and a recommendation. Loading and unloading in memory
 *   happen in the parser worker; parserService connects the two
 *   (architecture.md → Model library). Other layers import only from this
 *   file (agents.md → Module public API).
 *
 * Layer: modules/ (modelLibrary)
 *
 * Tasks:
 *   1. Re-export from ./catalog.ts: loadCatalog, modelFiles, variantFor.
 *   2. Re-export from ./downloads.ts (T47): getModelStates, downloadModel,
 *      cancelDownload, deleteModel, createDownloads (injected cache API).
 *   3. Re-export from ./selection.ts: getSavedChoice, saveChoice,
 *      clearChoice, recommendModel.
 *   4. Re-export public types and errors from ./types.ts.
 *
 * Dependencies:
 *   Internal: ./catalog.ts, ./downloads.ts, ./selection.ts, ./types.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: implemented (T37 catalog and selection; T47 downloads).
 */

export {
  CATALOG_SCHEMA_VERSION,
  CATALOG_URL,
  downloadBytes,
  entryProblems,
  loadCatalog,
  modelFiles,
  parseCatalog,
  requirementsOf,
  variantFor,
} from "./catalog";
export {
  INTEGRITY_RETRIES,
  cancelDownload,
  createDownloads,
  deleteModel,
  downloadModel,
  getModelStates,
} from "./downloads";
export type { DownloadProgress, Downloads, ModelCacheApi } from "./downloads";
export { CHOICE_KEY, cardBadges, clearChoice, getSavedChoice, recommendModel, saveChoice } from "./selection";
export { CatalogLoadError, ModelDownloadError } from "./types";
export type {
  CardBadge,
  Catalog,
  CatalogEntry,
  DownloadFailure,
  FileRef,
  FitnessLike,
  ModelId,
  ModelState,
  VariantName,
} from "./types";
