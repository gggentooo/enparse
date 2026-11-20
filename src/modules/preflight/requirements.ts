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
 *      runtime (calibration.*, ambiguity.*, nested.bracket_threshold,
 *      tokenizer_word_encoding, model_version).
 *
 * Dependencies:
 *   Internal: ./types.ts. Build-time: root package.json (exact pins).
 *   Used by: ./checks.ts, ./preflight.ts, ./index.ts.
 *
 * Open items (todo.md): pre-flight checks (memory policy,
 *   thresholds, storage policy).
 *
 * Status: header only; not implemented.
 */
