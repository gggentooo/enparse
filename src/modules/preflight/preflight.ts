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
 *      from each model's size and measured parse times (catalog
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
 * Status: implemented (T36). Tests: preflight.test.ts. Persistent storage is
 *   requested by parserService after the first download (T24).
 */

import {
  deleteCachedFiles,
  digestCachedFiles,
  type EnvironmentProbe,
  fetchStaticJson,
  listCached,
  probeEnvironment,
} from "../../core/environment";
import {
  asManifest,
  backendHint,
  checkCacheStorage,
  checkFilesCached,
  checkFilesIntegrity,
  checkManifestSchema,
  checkMemoryHint,
  checkModelSize,
  checkModelStorage,
  checkModelVariant,
  checkModuleWorkers,
  checkParseTime,
  checkStorageQuota,
  checkWasm,
  checkWasmSimd,
  checkWasmThreads,
  checkWebGpu,
  checkWinkVersions,
  chooseVariant,
  corruptFiles,
  expectedParseSeconds,
} from "./checks";
import type {
  CheckResult,
  DeviceAssessment,
  ModelFitness,
  ModelManifest,
  ModelRequirements,
  PreflightReport,
  Verdict,
} from "./types";

/** The core/environment functions the runners use (tests pass stubs). */
export type EnvironmentApi = {
  probeEnvironment: typeof probeEnvironment;
  fetchStaticJson: typeof fetchStaticJson;
  listCached: typeof listCached;
  digestCachedFiles: typeof digestCachedFiles;
  deleteCachedFiles: typeof deleteCachedFiles;
};

const defaultEnv: EnvironmentApi = {
  probeEnvironment,
  fetchStaticJson,
  listCached,
  digestCachedFiles,
  deleteCachedFiles,
};

/** Memory hint below which the device stage warns when no model is known yet (smallest tier). */
const DEVICE_MEMORY_FLOOR_GB = 4;

/** Blocked if any check fails, warn if any warns, else ok. */
export function combine(checks: readonly CheckResult[]): Verdict {
  if (checks.some((c) => c.status === "fail")) return "blocked";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

function report(checks: CheckResult[], startedAt: number, probe: EnvironmentProbe): PreflightReport {
  return { verdict: combine(checks), checks, startedAt, finishedAt: Date.now(), backendHint: backendHint(probe) };
}

/** Device stage, once at app start, before any download. */
export async function runDeviceChecks(env: EnvironmentApi = defaultEnv): Promise<DeviceAssessment> {
  const startedAt = Date.now();
  const probe = await env.probeEnvironment();
  const checks = [
    checkModuleWorkers(probe),
    checkWasm(probe),
    checkWasmSimd(probe),
    checkWasmThreads(probe),
    checkWebGpu(probe),
    checkCacheStorage(probe),
    checkStorageQuota(probe),
    checkMemoryHint(probe, DEVICE_MEMORY_FLOOR_GB),
  ];
  return { report: report(checks, startedAt, probe), probe };
}

/** Fitness of every catalog model on this device (model library and recommendation). */
export function assessModels(models: readonly ModelRequirements[], device: DeviceAssessment): ModelFitness[] {
  return models.map((m) => {
    const reasons = [
      checkModelVariant(m, device.probe),
      checkModelStorage(m, device.probe),
      checkParseTime(m, device.probe),
    ];
    const verdict = device.report.verdict === "blocked" ? "blocked" : combine(reasons);
    return {
      id: m.id,
      verdict,
      variant: chooseVariant(m, device.probe),
      reasons,
      expectedParseSeconds: expectedParseSeconds(m, device.probe),
    };
  });
}

/**
 * Model stage for the chosen model, before loading: labels.json schema and versions, room for
 * the files still missing, and integrity of the cached files. Corrupt cached files are deleted
 * (parserService re-downloads them once; MAX_INTEGRITY_RETRIES).
 * @param modelBaseUrl the model folder, e.g. "/models/deberta_v3_xsmall/"
 */
export async function runModelChecks(
  modelBaseUrl: string,
  device: DeviceAssessment,
  env: EnvironmentApi = defaultEnv,
): Promise<{ report: PreflightReport; manifest: ModelManifest | null; corrupt: string[] }> {
  const startedAt = Date.now();
  const base = modelBaseUrl.endsWith("/") ? modelBaseUrl : `${modelBaseUrl}/`;
  let manifest: ModelManifest | null = null;
  try {
    manifest = asManifest(await env.fetchStaticJson(`${base}labels.json`));
  } catch {
    manifest = null;
  }
  const checks: CheckResult[] = [checkManifestSchema(manifest)];
  let corrupt: string[] = [];
  if (manifest && checks[0]?.status !== "fail") {
    checks.push(checkWinkVersions(manifest));
    const paths = Object.keys(manifest.files ?? {});
    const urls = paths.map((p) => base + p);
    const sizes = await env.listCached(urls);
    const cached = Object.fromEntries(paths.map((p, i) => [p, sizes[urls[i] as string] ?? null]));
    checks.push(checkModelSize(manifest, device.probe, cached), checkFilesCached(manifest, cached));
    const present = urls.filter((u) => sizes[u] !== null && sizes[u] !== undefined);
    const digests = await env.digestCachedFiles(present);
    const byPath = Object.fromEntries(paths.map((p, i) => [p, digests[urls[i] as string] ?? null]));
    checks.push(checkFilesIntegrity(manifest, byPath));
    corrupt = corruptFiles(manifest, byPath);
    if (corrupt.length) await env.deleteCachedFiles(corrupt.map((p) => base + p));
  }
  return { report: report(checks, startedAt, device.probe), manifest, corrupt };
}
