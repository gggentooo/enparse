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
 *      performance: { first_load_s, parse_5000_chars_s: { wasm, wasm_2core,
 *      wasm_1thread, webgpu },
 *      peak_memory_mb: { wasm, webgpu } } (Phase 10). No per-model memory
 *      requirement (owner, T65; the former requirements.min_device_memory_gb
 *      is ignored if present).
 *   3. Catalog: { schema_version: 1, generated_at, models: CatalogEntry[] }.
 *   4. ModelState per id: "not-downloaded" | { downloading, bytesDone,
 *      bytesTotal } | { downloaded, bytesOnDisk, variant } | "corrupted"
 *      (verification failed; files deleted).
 *   5. LibrarySnapshot: catalog, states by id, recommendedId, savedChoice.
 *   6. Errors: CatalogLoadError, ModelDownloadError (network, quota,
 *      integrity, cancelled).
 *
 * Dependencies:
 *   Internal: none.
 *   Used by: all files in modules/modelLibrary/.
 *
 * Open items (todo.md): model library (catalog contents and
 *   description language).
 *
 * Status: implemented (T37; schema changes T23: optional variants, nested-view
 *   metrics, labels.json with size and SHA-256). ModelState and download errors
 *   are used by downloads.ts (T47).
 */

export type ModelId = string;

/** A file of a model with its size and SHA-256 (hex); `file` is relative to the model folder. */
export type FileRef = { file: string; bytes: number; sha256: string };

export type VariantName = "int8" | "fp16";

/** One offered model (catalog.json → models[]). */
export type CatalogEntry = {
  id: ModelId;
  display_name: string;
  description: string;
  base_model: string;
  license: string;
  model_version: string;
  /** Folder under /models/ (e.g. "deberta_v3_xsmall"). */
  folder: string;
  labels: FileRef;
  /** Each optional (T23): int8 for WASM, fp16 for WebGPU. */
  variants: { int8?: FileRef; fp16?: FileRef };
  /** Config and tokenizer files. */
  shared_files: FileRef[];
  metrics: {
    upos: number;
    chunk_f1: number;
    uas: number;
    las: number;
    /** Nested-view metrics (T23). */
    nested?: {
      uas_no_punct?: number;
      bracket_f1?: number;
      shown_precision?: number;
      shown_coverage?: number;
      role_precision?: number;
    };
  };
  nested_view: boolean;
  performance?: {
    first_load_s?: number;
    /**
     * Seconds per 5,000 characters (Phase 10): int8 on WASM with many threads (`wasm`), on two
     * cores (`wasm_2core`), and on one thread (`wasm_1thread`; no cross-origin isolation), and
     * fp16 on WebGPU (owner, T65).
     */
    parse_5000_chars_s?: { wasm?: number; wasm_2core?: number; wasm_1thread?: number; webgpu?: number };
    peak_memory_mb?: { wasm?: number; webgpu?: number };
  };
};

export type Catalog = { schema_version: number; generated_at: string; models: CatalogEntry[] };

/** Download state of one model on this device (downloads.ts, T47). */
export type ModelState =
  | { state: "not-downloaded" }
  | { state: "downloading"; bytesDone: number; bytesTotal: number; variant: VariantName }
  | { state: "downloaded"; bytesOnDisk: number; variant: VariantName }
  | { state: "corrupted" };

/** Per-model fitness from pre-flight, as plain data (structurally ModelFitness; no import). */
export type FitnessLike = {
  id: ModelId;
  verdict: "ok" | "warn" | "blocked";
  variant: VariantName | null;
  expectedParseSeconds: number | null;
  reasons: ReadonlyArray<{ id: string; status: string }>;
};

/** Labels for model cards (T22); the UI phrases them. */
export type CardBadge = "most-accurate" | "fastest-here";

export class CatalogLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogLoadError";
  }
}

export type DownloadFailure = "network" | "quota" | "integrity" | "cancelled";

export class ModelDownloadError extends Error {
  readonly reason: DownloadFailure;
  constructor(reason: DownloadFailure, message: string) {
    super(message);
    this.name = "ModelDownloadError";
    this.reason = reason;
  }
}
