// @vitest-environment jsdom
/**
 * src/modules/modelLibrary/selection.test.ts — saved choice, recommendation (T22 rule), card badges (T37)
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createStorage } from "../../core/storage";
import { parseCatalog } from "./catalog";
import fixture from "./catalog.fixture.json";
import { cardBadges, clearChoice, getSavedChoice, recommendModel, saveChoice } from "./selection";
import type { FitnessLike } from "./types";

const catalog = parseCatalog(fixture);
const fit = (id: string, over: Partial<FitnessLike> = {}): FitnessLike => ({
  id,
  verdict: "ok",
  variant: "int8",
  expectedParseSeconds: 1,
  reasons: [],
  ...over,
});

beforeEach(() => localStorage.clear());

describe("saved choice", () => {
  it("saves, reads, and clears; drops a choice no longer in the catalog", async () => {
    const storage = createStorage({ indexedDB: new IDBFactory() });
    expect(await getSavedChoice(catalog, storage)).toBeNull();
    await saveChoice("modernbert_base", storage);
    expect(await getSavedChoice(catalog, storage)).toBe("modernbert_base");
    await saveChoice("gone_model", storage);
    expect(await getSavedChoice(catalog, storage)).toBeNull();
    expect(await storage.get("modelLibrary/choice")).toBeUndefined();
    await saveChoice("deberta_v3_xsmall", storage);
    await clearChoice(storage);
    expect(await getSavedChoice(catalog, storage)).toBeNull();
  });
});

describe("recommendModel (owner rule, T43: the default first, its backup otherwise)", () => {
  it("on a phone or tablet prefers a model without the memory warning, else the first that fits (T98)", () => {
    const warn = { verdict: "warn" as const, reasons: [{ id: "mobile-memory", status: "warn" }] };
    const three = {
      ...catalog,
      models: [...catalog.models, { ...catalog.models[1]!, id: "lite", folder: "lite" }],
    };
    const fitness = [fit("modernbert_base", warn), fit("deberta_v3_xsmall", warn), fit("lite")];
    expect(recommendModel(three, fitness, 5)).toBe("lite");
    // Without such a model (or when it failed here), the usual order applies: nothing is excluded.
    expect(recommendModel(three, fitness, 5, new Set(["lite"]))).toBe("modernbert_base");
    expect(recommendModel(catalog, fitness.slice(0, 2), 5)).toBe("modernbert_base");
  });

  it("recommends the default model (Large) when it runs well here", () => {
    expect(recommendModel(catalog, [fit("deberta_v3_xsmall"), fit("modernbert_base")], 5)).toBe("modernbert_base");
  });

  it("falls back to Compact when Large is blocked, too slow, or failed to load on this device", () => {
    const compact = fit("deberta_v3_xsmall");
    expect(recommendModel(catalog, [compact, fit("modernbert_base", { verdict: "blocked" })], 5)).toBe(
      "deberta_v3_xsmall",
    );
    // No WebGPU on two cores: Large int8 takes 5.17 s.
    expect(recommendModel(catalog, [compact, fit("modernbert_base", { expectedParseSeconds: 5.17 })], 5)).toBe(
      "deberta_v3_xsmall",
    );
    expect(recommendModel(catalog, [compact, fit("modernbert_base")], 5, new Set(["modernbert_base"]))).toBe(
      "deberta_v3_xsmall",
    );
    expect(recommendModel(catalog, [fit("deberta_v3_xsmall", { expectedParseSeconds: 6 })], 5)).toBeNull();
  });
});

describe("cardBadges", () => {
  it("marks the default model (the catalog's first) and the fastest on this device", () => {
    const b = cardBadges(catalog, [
      fit("deberta_v3_xsmall", { expectedParseSeconds: 0.42 }),
      fit("modernbert_base", { expectedParseSeconds: 0.28, variant: "fp16" }),
    ]);
    expect(b).toEqual({ modernbert_base: ["default", "fastest-here"], deberta_v3_xsmall: [] });
  });
});
