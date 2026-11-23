/**
 * src/modules/dictionary/dictionary.test.ts — lookup order, part-of-speech order, recent results (T46)
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDictionary, orderPos } from "./dictionary";
import { createDictionaryModule } from "./index";
import { createStaticDb } from "./staticDb";
import { fakeApi } from "./testDictionary";
import type { LookupResult, PosGroup } from "./types";

const hits = (r: LookupResult): string[] => r.entries.map((e) => `${e.entry.headword}:${e.match}`);

describe("lookup", () => {
  const dict = (): ReturnType<typeof createDictionary> => createDictionary(createStaticDb({ api: fakeApi() }));

  it("finds headwords case-insensitively, phrasal verbs, and inflected forms through the index", async () => {
    const d = dict();
    expect(hits(await d.lookup({ word: "Run" }))).toEqual(["run:headword"]);
    expect(hits(await d.lookup({ word: "ran" }))).toEqual(["run:form"]);
    expect(hits(await d.lookup({ word: "Looked  up" }))).toEqual(["look up:form"]);
    expect(hits(await d.lookup({ word: "me" }))).toEqual(["I:form"]);
    expect(hits(await d.lookup({ word: "xyzzy" }))).toEqual([]);
  });

  it("lists every headword of an ambiguous form: the word itself first, then the forms", async () => {
    expect(hits(await dict().lookup({ word: "saw" }))).toEqual(["saw:headword", "see:form"]);
  });

  it("tries the parse's lemma first (parse clicks), and uses the lemma's forms if it is no headword", async () => {
    const d = dict();
    expect(hits(await d.lookup({ word: "saw", lemma: "see", upos: "VERB" }))).toEqual(["see:lemma", "saw:headword"]);
    expect(hits(await d.lookup({ word: "rann", lemma: "runs" }))).toEqual(["run:form"]);
  });

  it("puts the queried part of speech first", async () => {
    const r = await dict().lookup({ word: "run", upos: "NOUN" });
    expect(r.entries[0]?.entry.pos.map((g) => g.upos)).toEqual(["NOUN", "VERB"]);
    const i = await dict().lookup({ word: "I", upos: "PRON" });
    expect(i.entries[0]?.entry.pos.map((g) => g.upos)).toEqual(["PRON", "NOUN"]);
  });

  it("keeps recent results and retries failed lookups", async () => {
    const api = fakeApi();
    const d = createDictionary(createStaticDb({ api }));
    api.offline = true;
    await expect(d.lookup({ word: "run" })).rejects.toMatchObject({ reason: "network" });
    api.offline = false;
    const a = d.lookup({ word: "run" });
    expect(d.lookup({ word: "run" })).toBe(a);
    expect(hits(await a)).toEqual(["run:headword"]);
  });
});

describe("orderPos", () => {
  const g = (upos: string): PosGroup => ({ upos, from: null, senses: [], korean: [] });
  it("maps AUX to VERB and PROPN to NOUN, keeping the rest in order", () => {
    const groups = [g("NOUN"), g("ADJ"), g("VERB")];
    expect(orderPos(groups, "AUX").map((x) => x.upos)).toEqual(["VERB", "NOUN", "ADJ"]);
    expect(orderPos(groups, "PROPN").map((x) => x.upos)).toEqual(["NOUN", "ADJ", "VERB"]);
    expect(orderPos(groups, null)).toEqual(groups);
  });
});

describe("module API", () => {
  it("exposes lookup, the offline functions, and the sources with the data license", async () => {
    const m = createDictionaryModule({ api: fakeApi() });
    expect(hits(await m.lookup({ word: "run" }))).toEqual(["run:headword"]);
    expect(await m.sources()).toMatchObject({
      license: { name: "CC BY-SA 4.0" },
      sources: [{ name: "Open English WordNet 2025", license: "CC BY 4.0" }],
    });
    await m.downloadAll();
    expect((await m.offlineState()).state).toBe("complete");
  });
});

// -- the real v1 data (training/data/dict/v1, built by T70; skipped when absent) ---------------

const V1 = fileURLToPath(new URL("../../../training/data/dict/v1/", import.meta.url));

describe.skipIf(!existsSync(`${V1}manifest.json`))("integration: built dictionary data v1", () => {
  const real = (): ReturnType<typeof fakeApi> => {
    const files: Record<string, string> = { "manifest.json": readFileSync(`${V1}manifest.json`, "utf8") };
    const manifest = JSON.parse(files["manifest.json"] as string) as { files: Record<string, unknown> };
    for (const rel of Object.keys(manifest.files)) files[rel] = readFileSync(`${V1}${rel}`, "utf8");
    return fakeApi(files);
  };

  it("resolves headwords, inflected forms, phrasal verbs, and capitalized words with checked files", async () => {
    const m = createDictionaryModule({ api: real() });
    expect(hits(await m.lookup({ word: "ran", lemma: "run", upos: "VERB" }))[0]).toBe("run:lemma");
    expect(hits(await m.lookup({ word: "Looked up" }))).toContain("look up:form");
    expect(hits(await m.lookup({ word: "me" }))).toContain("I:form");
    const american = await m.lookup({ word: "American", upos: "ADJ" });
    expect(american.entries[0]?.entry.headword).toBe("American");
    expect(american.entries[0]?.entry.pos[0]?.upos).toBe("ADJ");
    const run = (await m.lookup({ word: "run", upos: "VERB" })).entries[0]?.entry;
    expect(run?.pos[0]?.korean.flatMap((k) => k.words)).toContain("달리다");
  });
});
