/**
 * src/modules/modelLibrary/catalog.test.ts — catalog loading and validation (T37)
 *
 * catalog.fixture.json is generated from the Phase 9 exports (real sizes and SHA-256) with the
 * Phase 7/8 test metrics and Phase 10 timings, in the T23 schema.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fixture from "./catalog.fixture.json";
import { downloadBytes, loadCatalog, modelFiles, parseCatalog, requirementsOf, variantFor } from "./catalog";
import { CatalogLoadError } from "./types";

/** Written by training/scripts/package_models.py (T66); absent in CI (Git LFS not checked out). */
const PACKAGED = fileURLToPath(new URL("../../../public/models/catalog.json", import.meta.url));
const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
const models = (c: Record<string, unknown>): Array<Record<string, unknown>> =>
  c.models as Array<Record<string, unknown>>;

describe("parseCatalog", () => {
  it("accepts the fixture (two offered models)", () => {
    const c = parseCatalog(fixture);
    // Catalog order is the preference order: the default (Large) first, its backup (Compact) next (T43).
    expect(c.models.map((m) => [m.id, m.display_name])).toEqual([
      ["modernbert_base", "Large"],
      ["deberta_v3_xsmall", "Compact"],
    ]);
    expect(c.models.every((m) => m.description_ko)).toBe(true);
  });

  it("rejects another schema version, duplicate ids, and broken entries with every problem listed", () => {
    expect(() => parseCatalog({ ...clone(), schema_version: 2 })).toThrow(/schema_version 2/);
    const dup = clone();
    models(dup)[1] = { ...models(dup)[0] };
    expect(() => parseCatalog(dup)).toThrow(/duplicate id/);
    const bad = clone();
    const m0 = models(bad)[0] as Record<string, unknown>;
    m0.variants = {};
    m0.folder = "../x";
    (m0.labels as Record<string, unknown>).sha256 = "nothex";
    const err = (() => {
      try {
        parseCatalog(bad);
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(CatalogLoadError);
    expect(err?.message).toMatch(/no variant/);
    expect(err?.message).toMatch(/relative path/);
    expect(err?.message).toMatch(/labels file/);
  });

  it("accepts the base model's page and license, and rejects a link that is not https (T66)", () => {
    expect(parseCatalog(fixture).models[0]?.base_model_license).toBe("Apache 2.0");
    const bad = clone();
    (models(bad)[0] as Record<string, unknown>).base_model_url = "javascript:alert(1)";
    expect(() => parseCatalog(bad)).toThrow(/base_model_url invalid/);
  });

  it.skipIf(!existsSync(PACKAGED))("accepts the packaged public/models/catalog.json (T66)", () => {
    const c = parseCatalog(JSON.parse(readFileSync(PACKAGED, "utf8")));
    expect(c.models.map((m) => m.id)).toEqual(fixture.models.map((m) => m.id));
    expect(c.models.every((m) => m.base_model_license && m.base_model_url)).toBe(true);
  });

  it("allows a model with one variant (T23)", () => {
    const one = clone();
    const second = models(one)[1] as Record<string, unknown>;
    delete (second.variants as Record<string, unknown>).int8;
    expect(parseCatalog(one).models[1]?.variants.int8).toBeUndefined();
  });

  it("wraps load failures in CatalogLoadError", async () => {
    await expect(loadCatalog(async () => Promise.reject(new Error("HTTP 404")))).rejects.toThrow(CatalogLoadError);
    expect((await loadCatalog(async () => fixture)).models).toHaveLength(2);
  });
});

describe("variants, files, and requirements", () => {
  const c = parseCatalog(fixture);
  const deb = c.models.find((m) => m.id === "deberta_v3_xsmall");

  it("picks fp16 for WebGPU and int8 for WASM, falling back to int8", () => {
    expect(variantFor(deb!, "webgpu")).toBe("fp16");
    expect(variantFor(deb!, "wasm")).toBe("int8");
    expect(variantFor({ ...deb!, variants: { int8: deb!.variants.int8! } }, "webgpu")).toBe("int8");
    expect(variantFor({ ...deb!, variants: { fp16: deb!.variants.fp16! } }, "wasm")).toBeNull();
  });

  it("lists every file of a variant under /models/<folder>/ and sums the download", () => {
    const files = modelFiles(deb!, "int8");
    expect(files[0]?.url).toBe("/models/deberta_v3_xsmall/labels.json");
    expect(files.some((f) => f.url.endsWith("onnx/model_quantized.onnx"))).toBe(true);
    expect(files.some((f) => f.url.endsWith("onnx/model_fp16.onnx"))).toBe(false);
    expect(downloadBytes(deb!, "int8")).toBe(files.reduce((s, f) => s + f.bytes, 0));
  });

  it("builds pre-flight requirements from the entry", () => {
    expect(requirementsOf(deb!)).toMatchObject({
      id: "deberta_v3_xsmall",
      variants: { int8: { bytes: downloadBytes(deb!, "int8") } },
      parseSeconds: { wasm: 0.423, wasm_2core: 1.342, wasm_1thread: 1.223 },
    });
  });
});
