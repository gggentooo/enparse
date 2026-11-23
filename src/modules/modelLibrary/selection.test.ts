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

describe("recommendModel (owner rule, T22)", () => {
  it("picks the highest chunk F1 within budget (DeBERTa today)", () => {
    expect(recommendModel(catalog, [fit("deberta_v3_xsmall"), fit("modernbert_base")], 5)).toBe("deberta_v3_xsmall");
  });

  it("skips blocked models and models over budget", () => {
    expect(recommendModel(catalog, [fit("deberta_v3_xsmall", { verdict: "blocked" }), fit("modernbert_base")], 5)).toBe(
      "modernbert_base",
    );
    expect(recommendModel(catalog, [fit("deberta_v3_xsmall", { expectedParseSeconds: 6 })], 5)).toBeNull();
  });

  it("breaks chunk-F1 ties by the smaller download", () => {
    const tie = parseCatalog(JSON.parse(JSON.stringify(fixture)));
    for (const m of tie.models) m.metrics.chunk_f1 = 0.96;
    expect(recommendModel(tie, [fit("modernbert_base"), fit("deberta_v3_xsmall")], 5)).toBe("deberta_v3_xsmall");
  });
});

describe("cardBadges", () => {
  it("marks the most accurate model and the fastest on this device", () => {
    const b = cardBadges(catalog, [
      fit("deberta_v3_xsmall", { expectedParseSeconds: 0.42 }),
      fit("modernbert_base", { expectedParseSeconds: 0.28, variant: "fp16" }),
    ]);
    expect(b).toEqual({ deberta_v3_xsmall: ["most-accurate"], modernbert_base: ["fastest-here"] });
  });
});
