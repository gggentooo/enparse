/**
 * src/services/vocabService.ts — vocabulary list service
 *
 * Description:
 *   Holds vocabulary lists as shared app state and exposes CRUD and
 *   export/import for the UI over modules/vocab.
 *
 * Layer: services/
 *
 * Tasks:
 *   1. Load lists on first use; expose subscribe()/getSnapshot() so every
 *      useVocab consumer updates on change.
 *   2. Async CRUD: createList, renameList, deleteList, addItem, updateItem,
 *      removeItem, moveItem.
 *   3. exportLists(format): Promise<Blob>; importLists(file): Promise<ImportSummary>.
 *   4. Surface storage errors to the UI (no silent failures).
 *   5. Tests in vocabService.test.ts (composition and subscriptions).
 *
 * Dependencies:
 *   Internal: modules/vocab (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useVocab.ts.
 *
 * Open items (todo.md): export format; import conflicts.
 *
 * Status: implemented (T40). Tests: vocabService.test.ts.
 */

import {
  type ImportSummary,
  type NameConflictResolver,
  type NewVocabItem,
  type VocabItem,
  type VocabList,
  VocabManager,
} from "../modules/vocab";

export type {
  ImportSummary,
  NameConflictChoice,
  NameConflictResolver,
  NewVocabItem,
  VocabItem,
  VocabList,
} from "../modules/vocab";

/** Shared vocabulary state for the UI (immutable snapshots). */
export type VocabSnapshot = {
  status: "idle" | "loading" | "ready" | "error";
  lists: readonly VocabList[];
  /** Last error message (storage or import), cleared by the next successful action. */
  error: string | null;
  backupDue: boolean;
};

export type VocabService = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): VocabSnapshot;
  /** Load lists once (later calls return the same promise). */
  ensureLoaded(): Promise<void>;
  createList(name: string): Promise<VocabList>;
  renameList(listId: string, name: string): Promise<void>;
  deleteList(listId: string): Promise<void>;
  addItem(listId: string, item: NewVocabItem): Promise<VocabItem>;
  updateItem(
    listId: string,
    itemId: string,
    patch: Partial<Omit<VocabItem, "id" | "schemaVersion" | "addedAt">>,
  ): Promise<void>;
  removeItem(listId: string, itemId: string): Promise<void>;
  moveItem(fromListId: string, toListId: string, itemId: string): Promise<void>;
  exportLists(format: "json" | "csv", listIds?: readonly string[]): Promise<Blob>;
  importLists(file: Blob, resolve: NameConflictResolver): Promise<ImportSummary>;
};

/** Create the service over a VocabManager (tests pass one with in-memory storage). */
export function createVocabService(manager: VocabManager = new VocabManager()): VocabService {
  let snapshot: VocabSnapshot = { status: "idle", lists: [], error: null, backupDue: false };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  const set = (patch: Partial<VocabSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const l of listeners) l();
  };
  const refresh = async (): Promise<void> => {
    const [lists, backupDue] = await Promise.all([manager.loadAll(), manager.backupDue()]);
    set({ status: "ready", lists, backupDue, error: null });
  };
  /** Run an action, refresh the snapshot, and surface errors (no silent failures). */
  const run = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      const out = await action();
      await refresh();
      return out;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    ensureLoaded() {
      loading ??= (async () => {
        set({ status: "loading" });
        try {
          await refresh();
        } catch (e) {
          set({ status: "error", error: e instanceof Error ? e.message : String(e) });
          loading = null;
          throw e;
        }
      })();
      return loading;
    },
    createList: (name) => run(() => manager.createList(name)),
    renameList: (id, name) => run(async () => void (await manager.renameList(id, name))),
    deleteList: (id) => run(() => manager.deleteList(id)),
    addItem: (id, item) => run(() => manager.addItem(id, item)),
    updateItem: (id, itemId, patch) => run(async () => void (await manager.updateItem(id, itemId, patch))),
    removeItem: (id, itemId) => run(() => manager.removeItem(id, itemId)),
    moveItem: (from, to, itemId) => run(() => manager.moveItem(from, to, itemId)),
    exportLists: (format, listIds) =>
      run(async () => {
        const text = format === "json" ? await manager.exportJson(listIds) : await manager.exportCsv(listIds);
        return new Blob([text], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
      }),
    importLists: (file, resolve) =>
      run(async () => {
        const text = await file.text();
        const isJson = file.type.includes("json") || text.trimStart().startsWith("{");
        return isJson ? manager.importJson(text, resolve) : manager.importCsv(text, resolve);
      }),
  };
}

/** The app's vocabulary service (created on first use). */
let shared: VocabService | null = null;
export function vocabService(): VocabService {
  shared ??= createVocabService();
  return shared;
}
