/**
 * src/modules/vocab/vocabManager.ts — vocabulary list management
 *
 * Description:
 *   CRUD for custom vocabulary lists and their items, with export/import.
 *   Persists through core/storage.
 *
 * Layer: modules/ (vocab)
 *
 * Tasks:
 *   1. Lists: create, rename, delete, get all.
 *   2. Items: add, update, remove, move between lists; duplicate detection.
 *   3. Persist via core/storage with a schema version; migrate on load.
 *   4. Export to JSON and CSV (csv-stringify); optional zip (jszip).
 *   5. Import with validation and conflict handling; typed VocabImportError.
 *   6. Unit tests in vocabManager.test.ts with mocked storage.
 *
 * Dependencies:
 *   Internal: ./types.ts; core/storage.ts; utils/helpers.ts.
 *   External (optional): csv-stringify, csv-parse, jszip.
 *   Used by: services/vocabService.ts (via ./index.ts).
 *
 * Open items (todo.md): entry schema; export format and
 *   versioning; third-party compatibility (Anki); import conflicts;
 *   storage limits.
 *
 * Status: header only; not implemented.
 */
