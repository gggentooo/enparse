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
 *   1. Read lists with useSyncExternalStore(subscribe, getSnapshot).
 *   2. Return { lists, error, createList, renameList, deleteList, addItem,
 *      updateItem, removeItem, moveItem, exportLists, importLists }.
 *   3. Tests in useVocab.test.ts with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/vocabService.ts. Must not import modules directly.
 *   Used by: VocabPage, OutputPage and DictionaryPage ("add to list").
 *
 * Status: header only; not implemented.
 */
