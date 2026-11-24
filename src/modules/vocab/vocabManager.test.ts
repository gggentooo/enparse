// @vitest-environment jsdom
/**
 * src/modules/vocab/vocabManager.test.ts — lists, items, export, import rules (T40; owner T27)
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createStorage } from "../../core/storage";
import { VocabImportError, VocabNotFoundError } from "./types";
import { VocabManager, migrateItem } from "./vocabManager";

let clock = Date.UTC(2026, 10, 21, 9, 0, 0);
let ids = 0;
const make = () =>
  new VocabManager({
    storage: createStorage({ indexedDB: new IDBFactory() }),
    now: () => new Date(clock),
    newId: () => `id-${++ids}`,
  });

beforeEach(() => {
  localStorage.clear();
  clock = Date.UTC(2026, 10, 21, 9, 0, 0);
  ids = 0;
});

describe("lists and items", () => {
  it("creates, renames, adds, updates, moves, removes, and deletes", async () => {
    const m = make();
    const a = await m.createList(" Week 1 ");
    const b = await m.createList("Week 2");
    expect(a.name).toBe("Week 1");
    await m.renameList(a.id, "Week 1 verbs");
    const run = await m.addItem(a.id, { word: "run", lemma: "run", upos: "VERB", sourceSentence: "I run daily." });
    expect(run).toMatchObject({
      word: "run",
      definitionKo: null,
      notes: "",
      tags: [],
      duplicate: false,
      schemaVersion: 1,
    });
    await m.updateItem(a.id, run.id, { notes: "달리다", tags: ["verbs"] });
    await m.moveItem(a.id, b.id, run.id);
    const [la, lb] = await m.loadAll();
    expect(la?.name).toBe("Week 1 verbs");
    expect(la?.items).toEqual([]);
    expect(lb?.items[0]).toMatchObject({ word: "run", notes: "달리다", tags: ["verbs"] });
    await m.removeItem(b.id, run.id);
    await m.deleteList(a.id);
    expect((await m.loadAll()).map((l) => l.name)).toEqual(["Week 2"]);
    await expect(m.deleteList("nope")).rejects.toBeInstanceOf(VocabNotFoundError);
    await expect(m.addItem(b.id, { word: "  " })).rejects.toBeInstanceOf(TypeError);
  });

  it("keeps the same word twice and flags the later one as a duplicate", async () => {
    const m = make();
    const l = await m.createList("L");
    await m.addItem(l.id, { word: "Run" });
    const second = await m.addItem(l.id, { word: "run " });
    expect(second.duplicate).toBe(true);
    const [list] = await m.loadAll();
    expect(list?.items.map((x) => x.duplicate)).toEqual([false, true]);
  });

  it("treats the same word with another part of speech as a different word (T100)", async () => {
    const m = make();
    const l = await m.createList("L");
    await m.addItem(l.id, { word: "run", upos: "NOUN" });
    expect((await m.addItem(l.id, { word: "run", upos: "VERB" })).duplicate).toBe(false);
    expect((await m.addItem(l.id, { word: "Run", upos: "VERB" })).duplicate).toBe(true);
    // Without a part of speech it matches the word with any part of speech.
    expect((await m.addItem(l.id, { word: "run" })).duplicate).toBe(true);
    const other = await m.createList("M");
    await m.addItem(other.id, { word: "bank" });
    expect((await m.addItem(other.id, { word: "bank", upos: "NOUN" })).duplicate).toBe(true);
  });

  it("creates a list with its items in one write (T103)", async () => {
    const m = make();
    const list = await m.createListWithItems("  Text 1 ", [
      { word: "run", lemma: "run", upos: "VERB", definitionKo: "달리다", sourceSentence: "I run." },
      { word: "run", lemma: "run", upos: "NOUN" },
      { word: "run", upos: "NOUN" },
    ]);
    expect(list.name).toBe("Text 1");
    expect(list.items.map((x) => [x.word, x.upos, x.duplicate])).toEqual([
      ["run", "VERB", false],
      ["run", "NOUN", false],
      ["run", "NOUN", true],
    ]);
    expect(list.items[0]).toMatchObject({ definitionKo: "달리다", definitionEn: null, sourceSentence: "I run." });
    expect((await m.loadAll()).map((l) => [l.name, l.items.length])).toEqual([["Text 1", 3]]);
    await expect(m.createListWithItems(" ", [])).rejects.toBeInstanceOf(TypeError);
    await expect(m.createListWithItems("X", [{ word: " " }])).rejects.toBeInstanceOf(TypeError);
    expect(await m.loadAll()).toHaveLength(1);
  });

  it("migrates stored items and refuses newer schemas", () => {
    expect(migrateItem({ id: "x", word: "go" })).toMatchObject({ lemma: null, notes: "", tags: [], schemaVersion: 1 });
    expect(() => migrateItem({ id: "x", word: "go", schemaVersion: 9 })).toThrow(VocabImportError);
  });
});

describe("export and import", () => {
  it("round-trips JSON losslessly into a fresh store", async () => {
    const m = make();
    const l = await m.createList("Week 1");
    await m.addItem(l.id, { word: "run", definitionKo: "달리다", tags: ["a", "b"] });
    const json = await m.exportJson();
    const fresh = make();
    const summary = await fresh.importJson(json, async () => "merge");
    expect(summary).toMatchObject({ listsAdded: 1, itemsAdded: 1 });
    expect(await fresh.loadAll()).toEqual(
      JSON.parse(json).lists.map((x: { updatedAt: string }) => ({ ...x, updatedAt: expect.any(String) })),
    );
  });

  it("merges by id, flags same-word duplicates, and asks only on list-name collisions", async () => {
    const m = make();
    const l = await m.createList("Week 1");
    const run = await m.addItem(l.id, { word: "run", notes: "mine" });
    const json = JSON.stringify({
      format: "enparse-vocab",
      schemaVersion: 1,
      exportedAt: "x",
      lists: [
        {
          id: l.id,
          name: "Week 1",
          items: [
            { id: run.id, word: "run", notes: "theirs", definitionKo: "달리다" },
            { id: "new", word: "RUN" },
          ],
        },
        { id: "other", name: "week 1", items: [{ id: "o1", word: "go" }] },
      ],
    });
    const asked: string[] = [];
    const s = await m.importJson(json, async (existing, incoming) => {
      asked.push(`${existing.name}|${incoming.name}`);
      return "rename";
    });
    expect(asked).toEqual(["Week 1|week 1"]);
    expect(s).toMatchObject({ listsMerged: 1, listsAdded: 1, itemsMerged: 1, itemsAdded: 2, duplicatesFlagged: 1 });
    const lists = await m.loadAll();
    const merged = lists.find((x) => x.id === l.id);
    expect(merged?.items[0]).toMatchObject({ notes: "mine\ntheirs", definitionKo: "달리다" });
    expect(merged?.items[1]).toMatchObject({ id: "new", duplicate: true });
    expect(lists.map((x) => x.name)).toContain("week 1 (2)");
  });

  it("imports CSV exports and rejects foreign or newer files", async () => {
    const m = make();
    const l = await m.createList("Week 1");
    await m.addItem(l.id, { word: "go", tags: ["x", "y"] });
    const csv = await m.exportCsv();
    const fresh = make();
    expect(await fresh.importCsv(csv, async () => "merge")).toMatchObject({ listsAdded: 1, itemsAdded: 1 });
    expect((await fresh.loadAll())[0]?.items[0]).toMatchObject({ word: "go", tags: ["x", "y"] });
    await expect(m.importJson("{}", async () => "merge")).rejects.toBeInstanceOf(VocabImportError);
    await expect(
      m.importJson(JSON.stringify({ format: "enparse-vocab", schemaVersion: 2, lists: [] }), async () => "merge"),
    ).rejects.toThrow(/newer/);
    await expect(m.importCsv("a,b\n1,2", async () => "merge")).rejects.toThrow(/list and word/);
  });

  it("reminds to back up when lists changed and the last export is a week old", async () => {
    const m = make();
    const l = await m.createList("L");
    expect(await m.backupDue()).toBe(false); // empty
    await m.addItem(l.id, { word: "go" });
    expect(await m.backupDue()).toBe(true); // never exported
    await m.exportJson();
    clock += 8 * 86_400_000;
    expect(await m.backupDue()).toBe(false); // nothing changed since
    await m.addItem(l.id, { word: "run" });
    expect(await m.backupDue()).toBe(true);
  });
});
