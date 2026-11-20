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
 *      (bracket_threshold), versions.wink, files (Record<path, { bytes,
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
 * Status: header only; not implemented.
 */
