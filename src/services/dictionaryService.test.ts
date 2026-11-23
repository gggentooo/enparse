/**
 * src/services/dictionaryService.test.ts — dictionary service (T46)
 *
 * The real module over the fake server and cache (modules/dictionary/testDictionary.ts):
 * lookups, shared state (offline, progress, errors), one download at a time, cancel, delete.
 */

import { describe, expect, it, vi } from "vitest";
import { createDictionaryModule } from "../modules/dictionary";
import { fakeApi } from "../modules/dictionary/testDictionary";
import { createDictionaryService } from "./dictionaryService";

const setup = () => {
  const api = fakeApi();
  const service = createDictionaryService(createDictionaryModule({ api }));
  return { api, service };
};

describe("dictionaryService", () => {
  it("looks words up and reports failures in the snapshot until the next success", async () => {
    const { api, service } = setup();
    const r = await service.lookupWord({ word: "ran", upos: "VERB" });
    expect(r.entries.map((e) => [e.entry.headword, e.match])).toEqual([["run", "form"]]);
    expect(r.entries[0]?.entry.pos[0]?.korean[0]?.words).toEqual(["달리다", "뛰다"]);

    api.offline = true;
    await expect(service.lookupWord({ word: "look up" })).rejects.toMatchObject({ reason: "network" });
    expect(service.getSnapshot().error).toBe("network");
    api.offline = false;
    await service.lookupWord({ word: "look up" });
    expect(service.getSnapshot().error).toBeNull();
  });

  it("downloads everything once with progress in the snapshot, then reports complete", async () => {
    const { service } = setup();
    const seen: Array<{ bytesDone: number; bytesTotal: number } | null> = [];
    const listener = vi.fn<() => void>(() => void seen.push(service.getSnapshot().download));
    service.subscribe(listener);
    expect(await service.refreshOfflineState()).toMatchObject({ state: "none" });
    const first = service.downloadAll();
    expect(service.downloadAll()).toBe(first); // one at a time
    await first;
    const progress = seen.filter((x): x is { bytesDone: number; bytesTotal: number } => x !== null);
    expect(progress.at(-1)?.bytesDone).toBe(progress.at(-1)?.bytesTotal);
    expect(service.getSnapshot()).toMatchObject({ download: null, error: null, offline: { state: "complete" } });
  });

  it("cancels quietly, reports storage errors, and deletes the offline copy", async () => {
    const { api, service } = setup();
    const running = service.downloadAll();
    service.cancelDownload();
    await running;
    expect(service.getSnapshot().error).toBeNull();

    api.full = true;
    await service.downloadAll();
    expect(service.getSnapshot().error).toBe("storage");
    api.full = false;

    await service.downloadAll();
    await service.deleteAll();
    expect(service.getSnapshot()).toMatchObject({ offline: { state: "none" }, error: null });
  });

  it("gives the data license and sources", async () => {
    const { service } = setup();
    expect((await service.sources()).license.name).toBe("CC BY-SA 4.0");
  });
});
