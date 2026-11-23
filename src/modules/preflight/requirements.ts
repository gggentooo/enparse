/**
 * src/modules/preflight/requirements.ts — minimum requirements and check severity
 *
 * Description:
 *   Named thresholds and the severity of each check (fail = blocks, warn =
 *   shown but allowed). Single place to change them (agents.md → no magic
 *   numbers). Values come from plan-training.md Phase 10 (browser
 *   benchmarks), set by the owner (T24 policies, T65 thresholds).
 *
 * Layer: modules/ (preflight)
 *
 * Tasks:
 *   1. Severity table per CheckId (owner, T24):
 *      - fail (blocks): module-workers, wasm, wasm-simd (ONNX Runtime Web
 *        ships SIMD builds only), manifest-schema, files-integrity (after one
 *        re-download).
 *      - warn: wasm-threads (single-threaded WASM is slower), cache-storage
 *        (model re-downloaded every visit), storage-quota, memory-hint,
 *        wink-versions, model-size.
 *      - info only (pass/skip): webgpu (missing → WASM), files-cached.
 *   2. App-wide thresholds (owner, 2026-11-23; T65, from Phase 10):
 *      STORAGE_MARGIN_BYTES = 256 MiB (free quota beyond a download; less →
 *      warn), MIN_WEBGPU_STORAGE_BINDING_BYTES = 128 MiB (maxStorageBuffer-
 *      BindingSize for the fp16 models), TWO_CORE_MAX = 2 (speed tier),
 *      MAX_INTEGRITY_RETRIES = 1, PARSE_BUDGET_SECONDS = 5. No per-model
 *      memory requirement: only the device-wide memory hint (4 GB, warn).
 *      Single-threaded WASM only warns (wasm-threads), and the speed tier
 *      makes the recommendation prefer faster models there.
 *   3. SUPPORTED_SCHEMA_VERSION = 2 (= parser LABEL_SCHEMA_VERSION; kept equal
 *      by a test, since this module cannot import modules/parser).
 *   4. APP_WINK_VERSIONS: wink-nlp and wink-eng-lite-web-model versions
 *      pinned in the root package.json (JSON import at build time), compared
 *      with labels.json → versions.wink.
 *   5. REQUIRED_MANIFEST_FIELDS: labels.json fields that must not be null at
 *      runtime (calibration.*, ambiguity.*, nested.bracket_threshold, nested.role_threshold,
 *      tokenizer_word_encoding, model_version).
 *
 * Dependencies:
 *   Internal: ./types.ts. Build-time: root package.json (exact pins).
 *   Used by: ./checks.ts, ./preflight.ts, ./index.ts.
 *
 * Open items (todo.md): pre-flight checks (memory policy,
 *   thresholds, storage policy).
 *
 * Status: implemented (T36; policies owner T24; thresholds owner T65).
 */

import { dependencies } from "../../../package.json";
import type { CheckId, CheckStatus } from "./types";

/** labels.json schema version this app supports (= parser LABEL_SCHEMA_VERSION; equality is tested). */
export const SUPPORTED_SCHEMA_VERSION = 2;

/** Parse budget for 5,000 characters (architecture.md → Speed). */
export const PARSE_BUDGET_SECONDS = 5;

/** Re-downloads after an integrity failure before the model fails (owner, T24). */
export const MAX_INTEGRITY_RETRIES = 1;

/**
 * Free quota wanted beyond a download; less → warn (owner, T65). Storage estimates are
 * approximate (Safari especially); 256 MiB covers about one more model download plus the
 * dictionary.
 */
export const STORAGE_MARGIN_BYTES = 256 * 1024 * 1024;

/**
 * Smallest maxStorageBufferBindingSize for the fp16 models (owner, T65): the WebGPU default
 * limit, above ModernBERT's largest tensor (~77 MB). Smaller → int8 on WASM.
 */
export const MIN_WEBGPU_STORAGE_BINDING_BYTES = 128 * 1024 * 1024;

/** Devices reporting at most this many logical cores use the two-core speed tier (owner, T65). */
export const TWO_CORE_MAX = 2;

/**
 * Phones and tablets (T96, T98). Mobile browsers end a tab that uses too much memory (an iPhone 12
 * mini reloads the page while Compact loads), and loading a model grows memory by 1.2–2.9 GB on a
 * computer (Phase 10). A mobile device counts as memory-limited unless it reports at least
 * MOBILE_AMPLE_MEMORY_GB (navigator.deviceMemory; iOS never reports it). On such a device:
 *   - a model whose int8 file is at most MOBILE_MAX_MODEL_BYTES (Lite, 58 MB) is the recommended
 *     one and loads the low-memory way (int8, one WASM thread, no graph optimization);
 *   - larger models only warn and load the usual way (owner, 2026-11-23: Large runs on an iPhone
 *     16 Pro, so a model is blocked only when a check shows the device cannot run it).
 */
export const MOBILE_AMPLE_MEMORY_GB = 8;
export const MOBILE_MAX_MODEL_BYTES = 64 * 1024 * 1024;

/** wink versions pinned by the app (labels.json → versions.wink must match). */
export const APP_WINK_VERSIONS = {
  "wink-nlp": dependencies["wink-nlp"],
  "wink-eng-lite-web-model": dependencies["wink-eng-lite-web-model"],
} as const;

/** labels.json fields that must be set at runtime (dotted paths). */
export const REQUIRED_MANIFEST_FIELDS: readonly string[] = [
  "calibration.temperature",
  "calibration.rel_temperature",
  "calibration.arc_temperature",
  "ambiguity.margin",
  "ambiguity.attachment_margin",
  "nested.bracket_threshold",
  "nested.role_threshold",
  "tokenizer_word_encoding",
  "model_version",
];

/**
 * Status a check takes when its condition is not met (owner policies, T24): "fail" blocks,
 * "warn" is shown but allowed, "pass" means informational only. Storage checks decide fail vs
 * warn themselves (a download that cannot fit fails; a tight one warns).
 */
export const SEVERITY: Readonly<Record<CheckId, Exclude<CheckStatus, "skip">>> = {
  "module-workers": "fail",
  wasm: "fail",
  "wasm-simd": "fail", // ONNX Runtime Web ships SIMD builds only
  "wasm-threads": "warn",
  webgpu: "pass", // missing or no shader-f16 → int8 on WASM
  "cache-storage": "warn",
  "storage-quota": "warn",
  "memory-hint": "warn",
  "manifest-schema": "fail",
  "wink-versions": "warn",
  "model-size": "fail",
  "files-cached": "pass",
  "files-integrity": "fail",
  "model-storage": "fail",
  "model-variant": "fail",
  "parse-time": "warn",
  "mobile-memory": "warn", // a larger model on a phone or tablet: may not fit, never blocked (T98)
};
