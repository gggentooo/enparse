/**
 * src/hooks/useVocab.ts — React hook for vocabulary lists
 *
 * Description:
 *   Exposes vocabService shared state and actions to components; every
 *   consumer re-renders when lists change.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. Read lists with useSyncExternalStore(subscribe, getSnapshot); load
 *      them on first use (ensureLoaded; errors land in the snapshot).
 *   2. Return { status, lists, error, backupDue, createList, renameList,
 *      deleteList, addItem, updateItem, removeItem, moveItem, exportLists,
 *      importLists }. Actions reject on failure; the message is also kept in
 *      `error` (cleared by the next successful action).
 *   3. Tests in useVocab.test.ts with a mocked service (optional argument).
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/vocabService.ts. Must not import modules directly.
 *   Used by: VocabPage, OutputPage and DictionaryPage ("add to list").
 *
 * Status: implemented (T48). Tests: useVocab.test.ts.
 */

import { useEffect, useSyncExternalStore } from "react";
import { type VocabService, type VocabSnapshot, vocabService } from "../services/vocabService";

export type {
  ImportSummary,
  NameConflictChoice,
  NameConflictResolver,
  NewVocabItem,
  VocabItem,
  VocabList,
} from "../services/vocabService";

export type UseVocab = VocabSnapshot &
  Pick<
    VocabService,
    | "createList"
    | "renameList"
    | "deleteList"
    | "addItem"
    | "updateItem"
    | "removeItem"
    | "moveItem"
    | "exportLists"
    | "importLists"
  >;

export function useVocab(service: VocabService = vocabService()): UseVocab {
  const snap = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  useEffect(() => {
    // A failed load is shown through snapshot.status / error.
    service.ensureLoaded().catch(() => undefined);
  }, [service]);
  return {
    ...snap,
    createList: service.createList,
    renameList: service.renameList,
    deleteList: service.deleteList,
    addItem: service.addItem,
    updateItem: service.updateItem,
    removeItem: service.removeItem,
    moveItem: service.moveItem,
    exportLists: service.exportLists,
    importLists: service.importLists,
  };
}
