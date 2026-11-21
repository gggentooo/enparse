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
 * Status: implemented (T36). Tests: checks.test.ts.
 */

import type { EnvironmentProbe, FileDigest } from "../../core/environment";
import {
  APP_WINK_VERSIONS,
  MIN_WEBGPU_BUFFER_BYTES,
  PARSE_BUDGET_SECONDS,
  REQUIRED_MANIFEST_FIELDS,
  SEVERITY,
  STORAGE_MARGIN_BYTES,
  SUPPORTED_SCHEMA_VERSION,
} from "./requirements";
import type { Backend, CheckId, CheckResult, CheckStage, ModelManifest, ModelRequirements } from "./types";

type Extra = Pick<CheckResult, "measured" | "required">;
const result = (
  id: CheckId,
  stage: CheckStage,
  status: CheckResult["status"],
  detail: string,
  extra: Extra = {},
): CheckResult => ({
  id,
  stage,
  status,
  detail,
  ...extra,
});
/** Pass when `ok`, else the check's configured severity. */
const gate = (id: CheckId, stage: CheckStage, ok: boolean, detail: string, extra: Extra = {}): CheckResult =>
  result(id, stage, ok ? "pass" : SEVERITY[id], ok ? "ok" : detail, extra);
const unknownOr = <T>(v: T | "unknown", id: CheckId, stage: CheckStage, f: (x: T) => CheckResult): CheckResult =>
  v === "unknown" ? result(id, stage, "skip", "not-measurable") : f(v);

/** Free bytes in the storage quota, or null if unknown. */
export function freeBytes(probe: EnvironmentProbe): number | null {
  const s = probe.storage;
  return s === "unknown" || s === null ? null : Math.max(0, s.quotaBytes - s.usageBytes);
}

/** WebGPU usable for the fp16 models: an adapter with shader-f16 and large enough buffers. */
export function webGpuUsable(probe: EnvironmentProbe): boolean {
  const g = probe.webgpu;
  return g !== "unknown" && g !== null && g.shaderF16 && g.maxBufferSize >= MIN_WEBGPU_BUFFER_BYTES;
}

export function backendHint(probe: EnvironmentProbe): Backend {
  return webGpuUsable(probe) ? "webgpu" : "wasm";
}

// -- device stage --------------------------------------------------------------------------

export const checkModuleWorkers = (p: EnvironmentProbe): CheckResult =>
  unknownOr(p.moduleWorkers, "module-workers", "device", (v) => gate("module-workers", "device", v, "missing"));

export const checkWasm = (p: EnvironmentProbe): CheckResult => gate("wasm", "device", p.webAssembly, "missing");

export const checkWasmSimd = (p: EnvironmentProbe): CheckResult =>
  unknownOr(p.wasmSimd, "wasm-simd", "device", (v) => gate("wasm-simd", "device", v, "missing"));

export const checkWasmThreads = (p: EnvironmentProbe): CheckResult =>
  gate("wasm-threads", "device", p.wasmThreads, p.crossOriginIsolated ? "no-shared-memory" : "not-isolated");

export function checkWebGpu(p: EnvironmentProbe): CheckResult {
  const g = p.webgpu;
  if (g === "unknown") return result("webgpu", "device", "skip", "not-measurable");
  if (g === null) return result("webgpu", "device", "pass", "unavailable-use-wasm", { measured: false });
  if (!g.shaderF16) return result("webgpu", "device", "pass", "no-shader-f16-use-wasm", { measured: false });
  if (g.maxBufferSize < MIN_WEBGPU_BUFFER_BYTES) {
    return result("webgpu", "device", "pass", "small-buffers-use-wasm", {
      measured: g.maxBufferSize,
      required: MIN_WEBGPU_BUFFER_BYTES,
    });
  }
  return result("webgpu", "device", "pass", "ok", { measured: true });
}

export const checkCacheStorage = (p: EnvironmentProbe): CheckResult =>
  gate("cache-storage", "device", p.cacheStorage, "missing");

/** Device-level quota: warn when less than the margin is free (model sizes come later). */
export function checkStorageQuota(p: EnvironmentProbe): CheckResult {
  const free = freeBytes(p);
  if (free === null) return result("storage-quota", "device", "skip", "not-measurable");
  return gate("storage-quota", "device", free >= STORAGE_MARGIN_BYTES, "low", {
    measured: free,
    required: STORAGE_MARGIN_BYTES,
  });
}

/** navigator.deviceMemory is a coarse Chromium-only hint: low memory only warns (T24). */
export function checkMemoryHint(p: EnvironmentProbe, minGb: number): CheckResult {
  if (p.deviceMemoryGb === null) return result("memory-hint", "device", "skip", "not-exposed");
  return gate("memory-hint", "device", p.deviceMemoryGb >= minGb, "low", {
    measured: p.deviceMemoryGb,
    required: minGb,
  });
}

// -- per-model fitness ---------------------------------------------------------------------

/** Variant for this device: fp16 on usable WebGPU (if shipped), else int8. */
export function chooseVariant(model: ModelRequirements, p: EnvironmentProbe): "int8" | "fp16" | null {
  if (webGpuUsable(p) && model.variants.fp16) return "fp16";
  if (model.variants.int8) return "int8";
  return null;
}

export function checkModelVariant(model: ModelRequirements, p: EnvironmentProbe): CheckResult {
  const v = chooseVariant(model, p);
  return gate("model-variant", "model", v !== null, "needs-webgpu-fp16", { measured: v });
}

export function checkModelMemory(model: ModelRequirements, p: EnvironmentProbe): CheckResult {
  if (model.minDeviceMemoryGb === undefined) return result("model-memory", "model", "skip", "no-requirement");
  if (p.deviceMemoryGb === null) return result("model-memory", "model", "skip", "not-exposed");
  return gate("model-memory", "model", p.deviceMemoryGb >= model.minDeviceMemoryGb, "below-requirement", {
    measured: p.deviceMemoryGb,
    required: model.minDeviceMemoryGb,
  });
}

/** Download must fit the free quota (fail, T24: it would fail mid-way); tight → warn. */
export function checkModelStorage(model: ModelRequirements, p: EnvironmentProbe, cachedBytes = 0): CheckResult {
  const v = chooseVariant(model, p);
  const free = freeBytes(p);
  if (v === null) return result("model-storage", "model", "skip", "no-variant");
  if (free === null) return result("model-storage", "model", "skip", "not-measurable");
  const need = Math.max(0, (model.variants[v]?.bytes ?? 0) - cachedBytes);
  const extra = { measured: free, required: need };
  if (free < need) return result("model-storage", "model", "fail", "does-not-fit", extra);
  if (free < need + STORAGE_MARGIN_BYTES) return result("model-storage", "model", "warn", "tight", extra);
  return result("model-storage", "model", "pass", "ok", extra);
}

/** Expected parse time from Phase 10 for this device's backend. TODO(preflight-thresholds): scale by cores (T65). */
export function expectedParseSeconds(model: ModelRequirements, p: EnvironmentProbe): number | null {
  const v = chooseVariant(model, p);
  if (v === null) return null;
  return (v === "fp16" ? model.parseSeconds?.webgpu : model.parseSeconds?.wasm) ?? null;
}

export function checkParseTime(model: ModelRequirements, p: EnvironmentProbe): CheckResult {
  const t = expectedParseSeconds(model, p);
  if (t === null) return result("parse-time", "model", "skip", "not-measured");
  return gate("parse-time", "model", t <= PARSE_BUDGET_SECONDS, "over-budget", {
    measured: t,
    required: PARSE_BUDGET_SECONDS,
  });
}

// -- model stage (manifest and files) ------------------------------------------------------

/** Narrow unknown JSON to the manifest fields the checks read; null if the shape is wrong. */
export function asManifest(json: unknown): ModelManifest | null {
  if (typeof json !== "object" || json === null) return null;
  const m = json as Partial<ModelManifest>;
  const objects = [m.calibration, m.ambiguity, m.nested, m.versions?.wink];
  if (typeof m.schema_version !== "number" || objects.some((o) => typeof o !== "object" || o === null)) return null;
  return m as ModelManifest;
}

const pick = (obj: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (o, k) => (typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );

export function checkManifestSchema(m: ModelManifest | null): CheckResult {
  if (m === null) return result("manifest-schema", "model", "fail", "unreadable");
  if (m.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    return result("manifest-schema", "model", "fail", "unsupported-version", {
      measured: m.schema_version,
      required: SUPPORTED_SCHEMA_VERSION,
    });
  }
  const missing = REQUIRED_MANIFEST_FIELDS.filter((f) => pick(m, f) === null || pick(m, f) === undefined);
  return gate("manifest-schema", "model", missing.length === 0, "missing-fields", {
    measured: missing.join(",") || null,
  });
}

export function checkWinkVersions(m: ModelManifest): CheckResult {
  const same =
    m.versions.wink["wink-nlp"] === APP_WINK_VERSIONS["wink-nlp"] &&
    m.versions.wink["wink-eng-lite-web-model"] === APP_WINK_VERSIONS["wink-eng-lite-web-model"];
  return gate("wink-versions", "model", same, "differ", {
    measured: `${m.versions.wink["wink-nlp"]}/${m.versions.wink["wink-eng-lite-web-model"]}`,
    required: `${APP_WINK_VERSIONS["wink-nlp"]}/${APP_WINK_VERSIONS["wink-eng-lite-web-model"]}`,
  });
}

/** Total size of the files still to download must fit the free quota. */
export function checkModelSize(
  m: ModelManifest,
  p: EnvironmentProbe,
  cached: Record<string, number | null>,
): CheckResult {
  if (m.files === null) return result("model-size", "model", "skip", "no-file-list");
  const free = freeBytes(p);
  if (free === null) return result("model-size", "model", "skip", "not-measurable");
  const need = Object.entries(m.files).reduce(
    (s, [path, f]) => s + (cached[path] === null || cached[path] === undefined ? f.bytes : 0),
    0,
  );
  return gate("model-size", "model", free >= need, "does-not-fit", { measured: free, required: need });
}

export function checkFilesCached(m: ModelManifest, cached: Record<string, number | null>): CheckResult {
  if (m.files === null) return result("files-cached", "model", "skip", "no-file-list");
  const missing = Object.keys(m.files).filter((p) => cached[p] === null || cached[p] === undefined);
  return result("files-cached", "model", "pass", missing.length ? "not-cached" : "ok", { measured: missing.length });
}

/** Files whose cached bytes or SHA-256 differ from the manifest. */
export function corruptFiles(m: ModelManifest, digests: Record<string, FileDigest | null>): string[] {
  if (m.files === null) return [];
  return Object.entries(m.files)
    .filter(([path, f]) => {
      const d = digests[path];
      return d !== null && d !== undefined && (d.bytes !== f.bytes || d.sha256 !== f.sha256.toLowerCase());
    })
    .map(([path]) => path);
}

export function checkFilesIntegrity(m: ModelManifest, digests: Record<string, FileDigest | null>): CheckResult {
  if (m.files === null) return result("files-integrity", "model", "skip", "no-file-list");
  const bad = corruptFiles(m, digests);
  return gate("files-integrity", "model", bad.length === 0, "mismatch", { measured: bad.join(",") || null });
}
