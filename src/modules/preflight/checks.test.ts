/**
 * src/modules/preflight/checks.test.ts — unit tests for the pure pre-flight checks (T36)
 */

import { describe, expect, it } from "vitest";
import { LABEL_SCHEMA_VERSION } from "../parser/types";
import {
  asManifest,
  backendHint,
  checkFilesIntegrity,
  checkManifestSchema,
  checkMemoryHint,
  checkModelSize,
  checkModelStorage,
  checkModelVariant,
  checkModuleWorkers,
  checkParseTime,
  checkStorageQuota,
  checkWasmSimd,
  checkWasmThreads,
  checkWebGpu,
  checkWinkVersions,
  chooseVariant,
  expectedParseSeconds,
  wasmTier,
} from "./checks";
import { MIN_WEBGPU_STORAGE_BINDING_BYTES, STORAGE_MARGIN_BYTES, SUPPORTED_SCHEMA_VERSION } from "./requirements";
import { DEBERTA, MODERNBERT, manifest, probe } from "./testProbe";

const GB = 1024 ** 3;

describe("device checks", () => {
  it("blocks missing essentials and skips what cannot be measured", () => {
    expect(checkModuleWorkers(probe({ moduleWorkers: false })).status).toBe("fail");
    expect(checkModuleWorkers(probe({ moduleWorkers: "unknown" })).status).toBe("skip");
    expect(checkWasmSimd(probe({ wasmSimd: false })).status).toBe("fail");
    expect(checkWasmThreads(probe({ wasmThreads: false, crossOriginIsolated: false }))).toMatchObject({
      status: "warn",
      detail: "not-isolated",
    });
  });

  it("uses WebGPU only with shader-f16 and large buffers (T67), otherwise WASM", () => {
    expect(backendHint(probe())).toBe("webgpu");
    const noF16 = probe({ webgpu: { maxBufferSize: 4 * GB, maxStorageBufferBindingSize: GB, shaderF16: false } });
    expect(backendHint(noF16)).toBe("wasm");
    expect(checkWebGpu(noF16)).toMatchObject({ status: "pass", detail: "no-shader-f16-use-wasm" });
    expect(backendHint(probe({ webgpu: null }))).toBe("wasm");
    expect(
      checkWebGpu(probe({ webgpu: { maxBufferSize: 1024, maxStorageBufferBindingSize: 1024, shaderF16: true } }))
        .detail,
    ).toBe("small-buffers-use-wasm");
    // The storage-binding limit decides (T65), not maxBufferSize: 128 MiB passes, one byte less does not.
    const binding = (n: number) =>
      probe({ webgpu: { maxBufferSize: 4 * GB, maxStorageBufferBindingSize: n, shaderF16: true } });
    expect(backendHint(binding(MIN_WEBGPU_STORAGE_BINDING_BYTES))).toBe("webgpu");
    expect(backendHint(binding(MIN_WEBGPU_STORAGE_BINDING_BYTES - 1))).toBe("wasm");
  });

  it("warns on low quota and low memory hints, and skips them when not exposed", () => {
    expect(checkStorageQuota(probe({ storage: { quotaBytes: STORAGE_MARGIN_BYTES - 1, usageBytes: 0 } })).status).toBe(
      "warn",
    );
    expect(checkStorageQuota(probe({ storage: "unknown" })).status).toBe("skip");
    expect(checkMemoryHint(probe({ deviceMemoryGb: 2 }), 4).status).toBe("warn");
    expect(checkMemoryHint(probe({ deviceMemoryGb: null }), 4).status).toBe("skip");
  });
});

describe("model fitness", () => {
  it("chooses fp16 on usable WebGPU, int8 otherwise, and fails when no variant fits", () => {
    expect(chooseVariant(MODERNBERT, probe())).toBe("fp16");
    expect(chooseVariant(MODERNBERT, probe({ webgpu: null }))).toBe("int8");
    const fp16Only = { ...MODERNBERT, variants: { fp16: { bytes: 1 } } };
    expect(checkModelVariant(fp16Only, probe({ webgpu: null }))).toMatchObject({
      status: "fail",
      detail: "needs-webgpu-fp16",
    });
  });

  it("fails a download that cannot fit and warns when the margin is short (T24, T31)", () => {
    const tiny = probe({ storage: { quotaBytes: 100e6, usageBytes: 0 }, webgpu: null });
    expect(checkModelStorage(DEBERTA, tiny)).toMatchObject({ status: "warn", detail: "tight" });
    expect(checkModelStorage(MODERNBERT, tiny)).toMatchObject({ status: "fail", detail: "does-not-fit" });
    expect(checkModelStorage(MODERNBERT, tiny, 156e6).status).toBe("warn"); // already cached
    expect(checkModelStorage(DEBERTA, probe()).status).toBe("pass");
  });

  it("estimates parse time by the device's speed tier and warns over budget (T65)", () => {
    const cpu = { webgpu: null } as const;
    expect(wasmTier(probe(cpu))).toBe("wasm");
    expect(expectedParseSeconds(MODERNBERT, probe(cpu))).toBe(1.48);
    expect(checkParseTime(MODERNBERT, probe(cpu)).status).toBe("pass");
    // Two cores, or one thread without cross-origin isolation: the slower measured times.
    const twoCores = probe({ ...cpu, hardwareConcurrency: 2 });
    expect(wasmTier(twoCores)).toBe("wasm_2core");
    expect(checkParseTime(MODERNBERT, twoCores)).toMatchObject({ status: "warn", measured: 5.17 });
    const oneThread = probe({ ...cpu, wasmThreads: false, crossOriginIsolated: false, hardwareConcurrency: 2 });
    expect(wasmTier(oneThread)).toBe("wasm_1thread");
    expect(expectedParseSeconds(MODERNBERT, oneThread)).toBe(4.91);
    expect(expectedParseSeconds(DEBERTA, oneThread)).toBe(1.22);
    // Unknown core count counts as many; an unmeasured tier falls back to the many-thread time.
    expect(wasmTier(probe({ ...cpu, hardwareConcurrency: null }))).toBe("wasm");
    expect(expectedParseSeconds({ ...MODERNBERT, parseSeconds: { wasm: 1.5 } }, twoCores)).toBe(1.5);
    // fp16 on WebGPU ignores the WASM tier.
    expect(expectedParseSeconds(MODERNBERT, probe({ hardwareConcurrency: 2 }))).toBe(0.15);
  });
});

describe("manifest and files", () => {
  it("accepts a complete schema v2 manifest and reports missing fields or another version", () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(LABEL_SCHEMA_VERSION);
    expect(checkManifestSchema(manifest()).status).toBe("pass");
    expect(checkManifestSchema(manifest({ schema_version: 1 }))).toMatchObject({
      status: "fail",
      detail: "unsupported-version",
    });
    expect(checkManifestSchema(manifest({ model_version: null }))).toMatchObject({
      status: "fail",
      measured: "model_version",
    });
    expect(checkManifestSchema(asManifest({ nope: 1 }))).toMatchObject({ status: "fail", detail: "unreadable" });
  });

  it("warns when wink versions differ", () => {
    expect(checkWinkVersions(manifest()).status).toBe("pass");
    const old = manifest({ versions: { wink: { "wink-nlp": "1.0.0", "wink-eng-lite-web-model": "1.0.0" } } });
    expect(checkWinkVersions(old).status).toBe("warn");
  });

  it("counts only missing files against the quota and finds corrupt cached files", () => {
    const small = probe({ storage: { quotaBytes: 500, usageBytes: 0 } });
    expect(checkModelSize(manifest(), small, { "config.json": 10, "onnx/model_quantized.onnx": null }).status).toBe(
      "fail",
    );
    expect(checkModelSize(manifest(), small, { "config.json": 10, "onnx/model_quantized.onnx": 1000 }).status).toBe(
      "pass",
    );
    const digests = {
      "config.json": { bytes: 10, sha256: "aa" },
      "onnx/model_quantized.onnx": { bytes: 1000, sha256: "cc" },
    };
    expect(checkFilesIntegrity(manifest(), digests)).toMatchObject({
      status: "fail",
      measured: "onnx/model_quantized.onnx",
    });
    expect(checkFilesIntegrity(manifest({ files: null }), digests).status).toBe("skip");
  });
});
