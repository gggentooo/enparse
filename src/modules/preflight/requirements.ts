/**
 * src/modules/preflight/requirements.ts — minimum requirements and check severity
 *
 * Description:
 *   Named thresholds and the severity of each check (fail = blocks, warn =
 *   shown but allowed). Single place to change them (agents.md → no magic
 *   numbers). Values come from plan-training.md Phase 10 (browser
 *   benchmarks); until then they are proposed placeholders.
 *
 * Layer: modules/ (preflight)
 *
 * Tasks:
 *   1. Severity table per CheckId (proposed):
 *      - fail (blocks): module-workers, wasm, wasm-simd (ONNX Runtime Web
 *        ships SIMD builds only), manifest-schema, files-integrity (after one
 *        re-download).
 *      - warn: wasm-threads (single-threaded WASM is slower), cache-storage
 *        (model re-downloaded every visit), storage-quota, memory-hint,
 *        wink-versions, model-size.
 *      - info only (pass/skip): webgpu (missing → WASM), files-cached.
 *   2. App-wide thresholds (proposed; TODO(preflight-thresholds): set from
 *      Phase 10): STORAGE_MARGIN_BYTES (free quota beyond a model's size),
 *      MIN_WEBGPU_BUFFER_BYTES, MAX_INTEGRITY_RETRIES = 1,
 *      PARSE_BUDGET_SECONDS = 5. Per-model needs (peak memory,
 *      min_device_memory_gb) come from catalog.json, measured in Phase 10.
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
 * Status: implemented (T36; policies owner T24). Numeric thresholds are
 *   (proposed) placeholders until T65 (TODO(preflight-thresholds)).
 */

import { dependencies } from "../../../package.json";
import type { CheckId, CheckStatus } from "./types";

/** labels.json schema version this app supports (= parser LABEL_SCHEMA_VERSION; equality is tested). */
export const SUPPORTED_SCHEMA_VERSION = 2;

/** Parse budget for 5,000 characters (architecture.md → Speed). */
export const PARSE_BUDGET_SECONDS = 5;

/** Re-downloads after an integrity failure before the model fails (owner, T24). */
export const MAX_INTEGRITY_RETRIES = 1;

/** Free quota wanted beyond a download; less → warn. (proposed; TODO(preflight-thresholds): T65) */
export const STORAGE_MARGIN_BYTES = 256 * 1024 * 1024;

/**
 * Smallest WebGPU buffer limit for the fp16 models (the WebGPU default limit; ModernBERT's
 * largest tensor is ~77 MB). (proposed; TODO(preflight-thresholds): T65)
 */
export const MIN_WEBGPU_BUFFER_BYTES = 256 * 1024 * 1024;

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
  "model-memory": "warn",
  "model-storage": "fail",
  "model-variant": "fail",
  "parse-time": "warn",
};
