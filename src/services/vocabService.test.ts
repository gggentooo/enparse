// @vitest-environment jsdom
/**
 * src/services/vocabService.test.ts — vocabulary service: snapshots, subscriptions, errors (T40)
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "../core/storage";
import { VocabManager } from "../modules/vocab";
import { createVocabService } from "./vocabService";

beforeEach(() => localStorage.clear());
const service = () => createVocabService(new VocabManager({ storage: createStorage({ indexedDB: new IDBFactory() }) }));

describe("vocabService", () => {
  it("loads once, notifies subscribers, and keeps snapshots immutable", async () => {
    const s = service();
    const listener = vi.fn<() => void>();
    s.subscribe(listener);
    expect(s.getSnapshot().status).toBe("idle");
    await Promise.all([s.ensureLoaded(), s.ensureLoaded()]);
    const before = s.getSnapshot();
    expect(before).toMatchObject({ status: "ready", lists: [] });
    const list = await s.createList("Week 1");
    await s.addItem(list.id, { word: "run" });
    expect(s.getSnapshot()).not.toBe(before);
    expect(s.getSnapshot().lists[0]?.items).toHaveLength(1);
    expect(s.getSnapshot().backupDue).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it("exports and imports files, and surfaces errors in the snapshot", async () => {
    const s = service();
    await s.ensureLoaded();
    const list = await s.createList("L");
    await s.addItem(list.id, { word: "go" });
    const blob = await s.exportLists("json");
    expect(blob.type).toBe("application/json");
    expect(s.getSnapshot().backupDue).toBe(false);
    const other = service();
    await other.ensureLoaded();
    expect(await other.importLists(blob, async () => "merge")).toMatchObject({ listsAdded: 1 });
    await expect(other.importLists(new Blob(["not,valid\n1,2"]), async () => "merge")).rejects.toThrow(/list and word/);
    expect(other.getSnapshot().error).toMatch(/list and word/);
    await other.createList("ok");
    expect(other.getSnapshot().error).toBeNull();
  });
});
