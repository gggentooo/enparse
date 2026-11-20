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
 *      device-stage checks → verdict. Runs once at app start, before any
 *      model download.
 *   2. assessModels(models: ModelRequirements[], device): fitness per model
 *      (ok / warn / blocked, expected parse time for this device's backend)
 *      from each model's size, peak memory, and min_device_memory_gb (catalog
 *      data passed in by parserService). Shown in the model library and
 *      used for its recommendation.
 *   3. runModelChecks(manifestUrl, model, device): Promise<{ report,
 *      manifest }> — for the chosen model, before loading: fetch its
 *      labels.json → narrow to ModelManifest → manifest-schema, wink-versions,
 *      storage-quota → digestCachedFiles() → files-integrity of the cached
 *      files (downloads are verified by modules/modelLibrary; this catches
 *      later corruption). Mismatch → delete the bad entries; parserService
 *      offers a re-download.
 *   4. combine(checks): verdict = blocked if any fail, warn if any warn, else ok.
 *   5. Never throws for an unsupported feature: probe errors become "skip"
 *      or "fail" results. Only programming errors throw.
 *   6. Optionally requestPersistentStorage() when the model is cached
 *      (todo.md → [Modules/preflight]).
 *   7. Unit tests in preflight.test.ts with a stubbed core/environment.
 *
 * Dependencies:
 *   Internal: ./checks.ts, ./requirements.ts, ./types.ts;
 *             core/environment.ts (probes, fetchStaticJson, cache digests).
 *   External: none.
 *   Used by: ./index.ts → services/parserService.ts. Does not import
 *            modules/modelLibrary: model data is passed in as plain values.
 *
 * Open items (todo.md): pre-flight checks (scope, policies).
 *
 * Status: header only; not implemented.
 */
