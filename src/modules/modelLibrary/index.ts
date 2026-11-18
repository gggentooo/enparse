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
 *   2. Re-export from ./downloads.ts: getModelStates, downloadModel,
 *      cancelDownload, deleteModel.
 *   3. Re-export from ./selection.ts: getSavedChoice, saveChoice,
 *      clearChoice, recommendModel.
 *   4. Re-export public types and errors from ./types.ts.
 *
 * Dependencies:
 *   Internal: ./catalog.ts, ./downloads.ts, ./selection.ts, ./types.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: header only; not implemented.
 */
