/**
 * src/modules/preflight/preflight.ts — pre-flight runners and verdict
 *
 * Description:
 *   Runs the checks in stages, gathering data through core/environment, and
 *   combines results into a PreflightReport. parserService calls the stages
 *   in order (architecture.md → Model readiness → Pre-flight checks).
 *
 * Layer: modules/ (preflight)
 *
 * Tasks:
 *   1. runDeviceChecks(): Promise<PreflightReport> — probeEnvironment() →
 *      device-stage checks → verdict. Runs before any model download.
 *   2. runModelChecks(manifestUrl, device: PreflightReport):
 *      Promise<{ report, manifest }> — fetchStaticJson(labels.json) → narrow
 *      to ModelManifest → model-stage checks (incl. storage quota with the
 *      model size) → if files are cached: digestCachedFiles() →
 *      files-cached / files-integrity. On an integrity mismatch, delete the
 *      bad entries (deleteCachedFiles) and report "warn" (they are
 *      downloaded again), up to MAX_INTEGRITY_RETRIES.
 *   3. verifyModelFiles(manifest): Promise<CheckResult> — after the model has
 *      loaded (files now cached): digest again; mismatch → "fail" and delete
 *      the entries (parserService reports `failed: invalid-model`).
 *   4. combine(checks): verdict = blocked if any fail, warn if any warn, else ok.
 *   5. Never throws for an unsupported feature: probe errors become "skip"
 *      or "fail" results. Only programming errors throw.
 *   6. Optionally requestPersistentStorage() when the model is cached
 *      (plan.md → Undecided → Pre-flight checks).
 *   7. Unit tests in preflight.test.ts with a stubbed core/environment.
 *
 * Dependencies:
 *   Internal: ./checks.ts, ./requirements.ts, ./types.ts;
 *             core/environment.ts (probes, fetchStaticJson, cache digests).
 *   External: none.
 *   Used by: ./index.ts → services/parserService.ts.
 *
 * Open items (plan.md → Undecided): pre-flight checks (scope, policies).
 *
 * Status: header only; not implemented.
 */
