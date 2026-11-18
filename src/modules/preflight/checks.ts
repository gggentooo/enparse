/**
 * src/modules/preflight/checks.ts — individual pre-flight checks (pure)
 *
 * Description:
 *   One pure function per CheckId: takes probe data or the manifest plus the
 *   requirements and returns a CheckResult. No browser APIs, no I/O, so each
 *   check is unit-testable with plain objects.
 *
 * Layer: modules/ (preflight)
 *
 * Tasks:
 *   1. Device stage (input: EnvironmentProbe): checkModuleWorkers, checkWasm,
 *      checkWasmSimd, checkWasmThreads, checkWebGpu (also sets backendHint),
 *      checkCacheStorage, checkStorageQuota (needs model size; skip until the
 *      manifest is known), checkMemoryHint (skip when deviceMemory is not
 *      exposed, e.g. Safari, Firefox).
 *   2. Model stage (input: ModelManifest): checkManifestSchema (supported
 *      schema_version, REQUIRED_MANIFEST_FIELDS not null), checkWinkVersions,
 *      checkModelSize (sum of files.bytes vs free quota).
 *   2b. Per-model fitness (input: ModelRequirements + EnvironmentProbe):
 *      checkModelMemory (min_device_memory_gb vs deviceMemory; skip if not
 *      exposed), checkModelStorage (download bytes vs free quota),
 *      expectedParseTime (Phase 10 time for this device's backend vs
 *      PARSE_BUDGET_SECONDS; warn if over).
 *   3. Files (input: manifest.files + digests from core/environment):
 *      checkFilesCached, checkFilesIntegrity (bytes and SHA-256 per file;
 *      skip when manifest.files is null, e.g. development models before
 *      Phase 11).
 *   4. Severity from ./requirements.ts decides warn vs fail.
 *   5. Unit tests in checks.test.ts (every check: pass, warn/fail, skip).
 *
 * Dependencies:
 *   Internal: ./types.ts, ./requirements.ts. External: none.
 *   Used by: ./preflight.ts.
 *
 * Status: header only; not implemented.
 */
