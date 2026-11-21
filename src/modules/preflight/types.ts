/**
 * src/modules/preflight/types.ts — types for the pre-flight module
 *
 * Description:
 *   Shared types for check results and reports. The model manifest type is
 *   structural: it mirrors the fields of labels.json the checks read, so this
 *   module does not import modules/parser (no cross-module imports; same
 *   approach as modules/output).
 *
 * Layer: modules/ (preflight)
 *
 * Tasks:
 *   1. CheckId: "module-workers" | "wasm" | "wasm-simd" | "wasm-threads" |
 *      "webgpu" | "cache-storage" | "storage-quota" | "memory-hint" |
 *      "manifest-schema" | "wink-versions" | "model-size" | "files-cached" |
 *      "files-integrity".
 *   2. CheckStatus: "pass" | "warn" | "fail" | "skip" (skip = not applicable
 *      or not measurable in this browser).
 *   3. CheckResult: { id, stage: "device" | "model", status, detail (plain
 *      data for the UI to phrase; no user-facing strings here), measured,
 *      required }.
 *   4. Verdict: "ok" | "warn" | "blocked" (blocked if any check fails).
 *   5. PreflightReport: { verdict, checks: CheckResult[], startedAt,
 *      finishedAt, backendHint: "webgpu" | "wasm" }.
 *   6. ModelManifest (structural subset of labels.json schema v2; T33):
 *      schema_version, model_version, tokenizer_word_encoding, calibration
 *      (temperature, rel_temperature, arc_temperature), ambiguity, nested
 *      (bracket_threshold, role_threshold), versions.wink, files (Record<path, { bytes,
 *      sha256 }> | null).
 *   7. ModelRequirements (structural; from catalog.json, passed in): id,
 *      download bytes per variant, peak_memory_mb per backend,
 *      min_device_memory_gb, parse_5000_chars_s per backend.
 *      ModelFitness: { id, verdict, reasons: CheckResult[],
 *      expectedParseSeconds | null }.
 *   8. FailureReason mapping for parserService: blocked device checks →
 *      "unsupported"; failed model checks → "invalid-model".
 *
 * Dependencies:
 *   Internal: core/environment.ts (EnvironmentProbe type only).
 *   Used by: ./preflight.ts, ./checks.ts, ./requirements.ts, ./index.ts.
 *
 * Open items (todo.md): pre-flight checks (scope).
 *
 * Status: implemented (T36). Fitness checks added: model-memory, model-storage,
 *   model-variant, parse-time.
 */

import type { EnvironmentProbe } from "../../core/environment";

export type CheckId =
  | "module-workers"
  | "wasm"
  | "wasm-simd"
  | "wasm-threads"
  | "webgpu"
  | "cache-storage"
  | "storage-quota"
  | "memory-hint"
  | "manifest-schema"
  | "wink-versions"
  | "model-size"
  | "files-cached"
  | "files-integrity"
  | "model-memory"
  | "model-storage"
  | "model-variant"
  | "parse-time";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckStage = "device" | "model";
export type Verdict = "ok" | "warn" | "blocked";
export type Backend = "webgpu" | "wasm";

/** One check's outcome; `detail` is a stable code the UI phrases (no user-facing text here). */
export type CheckResult = {
  id: CheckId;
  stage: CheckStage;
  status: CheckStatus;
  detail: string;
  measured?: number | string | boolean | null;
  required?: number | string | boolean | null;
};

export type PreflightReport = {
  verdict: Verdict;
  checks: CheckResult[];
  startedAt: number;
  finishedAt: number;
  /** Backend this device should use: WebGPU only with `shader-f16` and large enough buffers. */
  backendHint: Backend;
};

/** The device stage's result plus the probe it was computed from (input to later stages). */
export type DeviceAssessment = { report: PreflightReport; probe: EnvironmentProbe };

/** Structural subset of labels.json schema v2 that the checks read (no import of modules/parser). */
export type ModelManifest = {
  schema_version: number;
  model_version: string | null;
  tokenizer_word_encoding: string | null;
  calibration: { temperature: number | null; rel_temperature: number | null; arc_temperature: number | null };
  ambiguity: { margin: number | null; attachment_margin: number | null };
  nested: { bracket_threshold: number | null; role_threshold: number | null };
  versions: { wink: { "wink-nlp": string; "wink-eng-lite-web-model": string } };
  files: Record<string, { bytes: number; sha256: string }> | null;
};

/** Per-model needs from catalog.json (structural; passed in by parserService). */
export type ModelRequirements = {
  id: string;
  /** Download size per shipped variant (each optional; T23). */
  variants: { int8?: { bytes: number }; fp16?: { bytes: number } };
  /** Measured parse time of 5,000 characters per backend (Phase 10), seconds. */
  parseSeconds?: { wasm?: number; webgpu?: number };
  minDeviceMemoryGb?: number;
};

export type ModelFitness = {
  id: string;
  verdict: Verdict;
  /** Variant this device would use (fp16 on WebGPU, int8 on WASM), or null if none fits. */
  variant: "int8" | "fp16" | null;
  reasons: CheckResult[];
  expectedParseSeconds: number | null;
};

/** parserService's failed reason for a blocked stage. */
export type PreflightFailureReason = "unsupported" | "invalid-model";
