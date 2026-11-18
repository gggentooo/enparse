/**
 * src/modules/modelLibrary/catalog.ts — load and validate the model catalog
 *
 * Description:
 *   Fetches public/models/catalog.json from the app's own static host and
 *   checks it before anything is shown or downloaded. Only models listed in
 *   the catalog can be chosen; training lists only models that meet the
 *   acceptance thresholds (plan-training.md → Phase 11).
 *
 * Layer: modules/ (modelLibrary)
 *
 * Tasks:
 *   1. loadCatalog(): Promise<Catalog> — core/environment fetchStaticJson
 *      (CATALOG_URL); narrow unknown → Catalog; reject unknown
 *      schema_version, duplicate ids, missing files or sizes
 *      (CatalogLoadError).
 *   2. variantFor(entry, backend: "webgpu" | "wasm"): which ONNX file to use
 *      (fp16 for WebGPU, int8 for WASM).
 *   3. modelFiles(entry, variant): Array<{ url, bytes, sha256 }> — every file
 *      the model needs (shared files + the variant's ONNX file + labels.json);
 *      sizes and hashes come from the model's labels.json → files and the
 *      catalog.
 *   4. Constants: CATALOG_URL ("models/catalog.json", relative to the app
 *      base), CATALOG_SCHEMA_VERSION = 1.
 *   5. Unit tests in catalog.test.ts (valid, unknown version, bad entries).
 *
 * Dependencies:
 *   Internal: ./types.ts; core/environment.ts (fetchStaticJson).
 *   Used by: ./index.ts, ./downloads.ts, ./selection.ts.
 *
 * Network: static assets from the app's own host only.
 *
 * Status: header only; not implemented.
 */
