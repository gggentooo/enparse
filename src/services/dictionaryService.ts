/**
 * src/services/dictionaryService.ts — dictionary lookup service
 *
 * Description:
 *   Async lookup API for the UI over modules/dictionary.
 *
 * Layer: services/
 *
 * Tasks:
 *   1. lookupWord(query): Promise<DictionaryEntry | null>.
 *   2. Deduplicate concurrent lookups of the same word.
 *   3. Optional state (current selection, recent lookups) via
 *      subscribe()/getSnapshot() if the UI needs it shared.
 *   4. Tests in dictionaryService.test.ts with a mocked module.
 *
 * Dependencies:
 *   Internal: modules/dictionary (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useDictionary.ts.
 *
 * Open items (todo.md): lookup trigger (popup vs DictionaryPage).
 *
 * Status: header only; not implemented.
 */
