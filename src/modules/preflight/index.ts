/**
 * src/modules/preflight/index.ts — public API of the pre-flight module
 *
 * Description:
 *   Client-side checks that run before (and right after) the model loads:
 *   can this browser and device run the model, and are the model files
 *   complete and correct? Other layers import only from this file
 *   (agents.md → Module public API).
 *
 * Layer: modules/ (preflight)
 *
 * Tasks:
 *   1. Re-export runDeviceChecks, assessModels, runModelChecks from
 *      ./preflight.ts.
 *   2. Re-export requirement constants from ./requirements.ts (for display).
 *   3. Re-export public types from ./types.ts (PreflightReport, CheckResult,
 *      CheckId, CheckStatus, Verdict, ModelManifest, ModelRequirements,
 *      ModelFitness).
 *   4. Do not export the individual check functions (internal; tested directly).
 *
 * Dependencies:
 *   Internal: ./preflight.ts, ./requirements.ts, ./types.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: implemented (T36).
 */

export { assessModels, combine, runDeviceChecks, runModelChecks } from "./preflight";
export { lowMemoryLoad, memoryLimited } from "./checks";
export type { EnvironmentApi } from "./preflight";
export {
  APP_WINK_VERSIONS,
  MAX_INTEGRITY_RETRIES,
  MIN_WEBGPU_STORAGE_BINDING_BYTES,
  TWO_CORE_MAX,
  PARSE_BUDGET_SECONDS,
  REQUIRED_MANIFEST_FIELDS,
  STORAGE_MARGIN_BYTES,
  SUPPORTED_SCHEMA_VERSION,
} from "./requirements";
export type {
  Backend,
  CheckId,
  CheckResult,
  CheckStatus,
  DeviceAssessment,
  ModelFitness,
  ModelManifest,
  ModelRequirements,
  PreflightFailureReason,
  PreflightReport,
  Verdict,
} from "./types";
