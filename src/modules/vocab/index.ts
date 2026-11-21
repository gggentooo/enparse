/**
 * src/modules/vocab/index.ts — public API of the vocab module (proposed file)
 *
 * Description:
 *   Custom vocabulary lists with persistence and export/import. Other layers
 *   import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (vocab)
 *
 * Tasks:
 *   1. Re-export list/item CRUD and export/import functions from ./vocabManager.ts.
 *   2. Re-export public types and errors from ./types.ts.
 *
 * Dependencies:
 *   Internal: ./vocabManager.ts, ./types.ts.
 *   Used by: services/vocabService.ts.
 *
 * Status: implemented (T40).
 */

export { BACKUP_REMINDER_DAYS, CSV_COLUMNS, VocabManager, migrateItem } from "./vocabManager";
export type { VocabManagerOptions } from "./vocabManager";
export { VOCAB_EXPORT_FORMAT, VOCAB_SCHEMA_VERSION, VocabImportError, VocabNotFoundError } from "./types";
export type {
  ImportSummary,
  NameConflictChoice,
  NameConflictResolver,
  NewVocabItem,
  VocabExport,
  VocabItem,
  VocabList,
} from "./types";
