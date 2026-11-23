/**
 * src/modules/preflight/testProbe.ts — test-only fixtures for the pre-flight tests
 *
 * A capable device probe, a valid manifest, and catalog requirements. Imported only by
 * *.test.ts files (not bundled).
 */

import type { EnvironmentProbe } from "../../core/environment";
import { APP_WINK_VERSIONS } from "./requirements";
import type { ModelManifest, ModelRequirements } from "./types";

const GB = 1024 ** 3;

export function probe(over: Partial<EnvironmentProbe> = {}): EnvironmentProbe {
  return {
    moduleWorkers: true,
    webAssembly: true,
    wasmSimd: true,
    wasmThreads: true,
    crossOriginIsolated: true,
    webgpu: { maxBufferSize: 4 * GB, maxStorageBufferBindingSize: 2 * GB, shaderF16: true },
    deviceMemoryGb: 8,
    mobile: false,
    hardwareConcurrency: 8,
    cacheStorage: true,
    storage: { quotaBytes: 10 * GB, usageBytes: 0 },
    persisted: false,
    ...over,
  };
}

export function manifest(over: Partial<ModelManifest> = {}): ModelManifest {
  return {
    schema_version: 2,
    model_version: "1.0.0",
    tokenizer_word_encoding: "plain",
    calibration: { temperature: 1.7, rel_temperature: 2, arc_temperature: 5.6 },
    ambiguity: { margin: 0.4, attachment_margin: 0.3 },
    nested: { bracket_threshold: 0.85, role_threshold: 0.4 },
    versions: { wink: { ...APP_WINK_VERSIONS } },
    files: { "config.json": { bytes: 10, sha256: "aa" }, "onnx/model_quantized.onnx": { bytes: 1000, sha256: "bb" } },
    ...over,
  };
}

export const DEBERTA: ModelRequirements = {
  id: "deberta_v3_xsmall",
  variants: { int8: { bytes: 90e6 }, fp16: { bytes: 144e6 } },
  parseSeconds: { wasm: 0.42, wasm_2core: 1.34, wasm_1thread: 1.22, webgpu: 0.23 },
};

export const MODERNBERT: ModelRequirements = {
  id: "modernbert_base",
  variants: { int8: { bytes: 156e6 }, fp16: { bytes: 302e6 } },
  parseSeconds: { wasm: 1.48, wasm_2core: 5.17, wasm_1thread: 4.91, webgpu: 0.15 },
};
