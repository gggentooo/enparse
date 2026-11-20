/**
 * src/modules/modelLibrary/types.ts — types for the model library module
 *
 * Description:
 *   Shapes of the model catalog (public/models/catalog.json, schema v1,
 *   written by training Phase 11) and of each model's state on this device.
 *   The catalog type is this module's own; it does not import modules/parser
 *   or modules/preflight (no cross-module imports).
 *
 * Layer: modules/ (modelLibrary)
 *
 * Tasks:
 *   1. ModelId: catalog id, e.g. "distilbert_base_cased".
 *   2. CatalogEntry (catalog.json → models[]):
 *      id, display_name, description (plain text from
 *      training/configs/catalog.yaml), base_model, license, model_version,
 *      folder (path under public/models/), labels (labels.json path),
 *      variants: { int8: { file, bytes }, fp16: { file, bytes } } (int8 for
 *      WASM, fp16 for WebGPU), shared_files (config and tokenizer files with
 *      bytes and sha256), metrics: { upos, chunk_f1, uas, las } (EWT test),
 *      nested_view (true if the model meets the nested-view targets:
 *      UAS excl. punctuation, multi-word bracket F1, shown-bracket precision;
 *      plan-training.md → Nested phrase structure),
 *      performance: { first_load_s, parse_5000_chars_s: { wasm, webgpu },
 *      peak_memory_mb: { wasm, webgpu } } (Phase 10), requirements:
 *      { min_device_memory_gb } (Phase 10).
 *   3. Catalog: { schema_version: 1, generated_at, models: CatalogEntry[] }.
 *   4. ModelState per id: "not-downloaded" | { downloading, bytesDone,
 *      bytesTotal } | { downloaded, bytesOnDisk, variant } | "corrupted"
 *      (verification failed; files deleted).
 *   5. LibrarySnapshot: catalog, states by id, recommendedId, savedChoice.
 *   6. Errors: CatalogLoadError, ModelDownloadError (network, quota,
 *      integrity, cancelled).
 *
 * Dependencies:
 *   Internal: core/environment.ts (cache result types only).
 *   Used by: all files in modules/modelLibrary/.
 *
 * Open items (todo.md): model library (catalog contents and
 *   description language).
 *
 * Status: header only; not implemented.
 */
