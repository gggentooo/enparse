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
 * Status: header only; not implemented.
 */
