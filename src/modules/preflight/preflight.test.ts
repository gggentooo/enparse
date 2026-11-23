/**
 * src/modules/preflight/preflight.test.ts — stage runners and verdicts (T36), stubbed core/environment
 */

import { describe, expect, it, vi } from "vitest";
import { assessModels, combine, runDeviceChecks, runModelChecks, type EnvironmentApi } from "./preflight";
import { DEBERTA, MODERNBERT, manifest, probe } from "./testProbe";
import type { CheckResult } from "./types";

function env(over: Partial<EnvironmentApi> = {}): EnvironmentApi {
  return {
    probeEnvironment: async () => probe(),
    fetchStaticJson: async () => manifest(),
    listCached: async (urls) => Object.fromEntries(urls.map((u) => [u, null])),
    digestCachedFiles: async (urls) => Object.fromEntries(urls.map((u) => [u, null])),
    deleteCachedFiles: async () => undefined,
    ...over,
  };
}

describe("combine", () => {
  it("blocks on any fail, warns on any warn", () => {
    const c = (status: CheckResult["status"]): CheckResult => ({ id: "wasm", stage: "device", status, detail: "" });
    expect(combine([c("pass"), c("skip")])).toBe("ok");
    expect(combine([c("pass"), c("warn")])).toBe("warn");
    expect(combine([c("warn"), c("fail")])).toBe("blocked");
  });
});

describe("runners", () => {
  it("device stage: ok on a capable device, blocked without module workers", async () => {
    const ok = await runDeviceChecks(env());
    expect(ok.report).toMatchObject({ verdict: "ok", backendHint: "webgpu" });
    const bad = await runDeviceChecks(env({ probeEnvironment: async () => probe({ moduleWorkers: false }) }));
    expect(bad.report.verdict).toBe("blocked");
  });

  it("assesses each model for this device (variant, expected time, verdict)", async () => {
    const lowEnd = await runDeviceChecks(
      env({ probeEnvironment: async () => probe({ webgpu: null, deviceMemoryGb: 4, hardwareConcurrency: 2 }) }),
    );
    // Two cores without WebGPU: the two-core times (T65); a 4 GB memory hint does not affect models.
    const [deb, mod] = assessModels([DEBERTA, MODERNBERT], lowEnd);
    expect(deb).toMatchObject({ verdict: "ok", variant: "int8", expectedParseSeconds: 1.34 });
    expect(mod).toMatchObject({ verdict: "warn", variant: "int8", expectedParseSeconds: 5.17 });
  });

  it("model stage: checks the manifest, counts missing files, and deletes corrupt cached files", async () => {
    const device = await runDeviceChecks(env());
    const base = "/models/deberta_v3_xsmall/";
    const deleted = vi.fn<(urls: readonly string[]) => Promise<void>>(async () => undefined);
    const e = env({
      listCached: async (urls) => Object.fromEntries(urls.map((u) => [u, 1])),
      digestCachedFiles: async (urls) =>
        Object.fromEntries(
          urls.map((u) => [u, u.endsWith(".onnx") ? { bytes: 1000, sha256: "zz" } : { bytes: 10, sha256: "aa" }]),
        ),
      deleteCachedFiles: deleted,
    });
    const r = await runModelChecks(base, device, e);
    expect(r.report.verdict).toBe("blocked");
    expect(r.corrupt).toEqual(["onnx/model_quantized.onnx"]);
    expect(deleted).toHaveBeenCalledWith([`${base}onnx/model_quantized.onnx`]);
    const clean = await runModelChecks(base, device, env());
    expect(clean.report.verdict).toBe("ok");
    expect(clean.report.checks.find((c) => c.id === "files-cached")?.detail).toBe("not-cached");
  });

  it("model stage on a phone or tablet: checks sizes but does not hash the cached files (T98)", async () => {
    const phone = await runDeviceChecks(
      env({ probeEnvironment: async () => probe({ mobile: true, deviceMemoryGb: null }) }),
    );
    const digest = vi.fn<EnvironmentApi["digestCachedFiles"]>(async (urls) =>
      Object.fromEntries(urls.map((u) => [u, null])),
    );
    const r = await runModelChecks("/models/m/", phone, env({ digestCachedFiles: digest }));
    expect(digest).not.toHaveBeenCalled();
    expect(r.report.checks.find((c) => c.id === "files-integrity")).toMatchObject({
      status: "skip",
      detail: "low-memory-device",
    });
    expect(r.report.checks.some((c) => c.id === "files-cached")).toBe(true);
    expect(r.corrupt).toEqual([]);
  });

  it("model stage: an unreadable labels.json fails without throwing", async () => {
    const device = await runDeviceChecks(env());
    const r = await runModelChecks(
      "/models/x",
      device,
      env({ fetchStaticJson: async () => Promise.reject(new Error("404")) }),
    );
    expect(r.report.verdict).toBe("blocked");
    expect(r.manifest).toBeNull();
  });
});
