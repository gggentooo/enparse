/**
 * src/modules/vocab/types.ts — types for the vocab module (proposed file)
 *
 * Description:
 *   Shared data shapes for vocabulary lists, items, and export files.
 *
 * Layer: modules/ (vocab)
 *
 * Tasks:
 *   1. VocabItem: fields per the owner's entry schema (T27; architecture.md →
 *      Module decisions).
 *   2. VocabList: id, name, items, timestamps.
 *   3. ExportFile: schema version + lists.
 *   4. VocabImportError (Error subclass).
 *
 * Dependencies:
 *   None. Used by: ./vocabManager.ts, ./index.ts.
 *
 * Open items (todo.md): entry schema; export format.
 *
 * Status: implemented (T40; schema owner T27).
 */

/** Schema version of stored items and export files (bump with a migration in vocabManager.ts). */
export const VOCAB_SCHEMA_VERSION = 1;
/** `format` field of JSON export files. */
export const VOCAB_EXPORT_FORMAT = "enparse-vocab";

/** One saved word (owner, T27). Optional facts are null when unknown. */
export type VocabItem = {
  id: string;
  word: string;
  lemma: string | null;
  upos: string | null;
  definitionEn: string | null;
  definitionKo: string | null;
  example: string | null;
  /** Sentence the word was saved from. */
  sourceSentence: string | null;
  notes: string;
  tags: string[];
  /** ISO timestamp (UTC). */
  addedAt: string;
  /** Same word as another item of the list (kept, flagged for the user; T27). */
  duplicate: boolean;
  schemaVersion: number;
};

/** Fields the caller provides when adding a word (the rest is filled in). */
export type NewVocabItem = Pick<VocabItem, "word"> &
  Partial<
    Pick<
      VocabItem,
      "lemma" | "upos" | "definitionEn" | "definitionKo" | "example" | "sourceSentence" | "notes" | "tags"
    >
  >;

export type VocabList = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: VocabItem[];
};

/** JSON export file (canonical, lossless). */
export type VocabExport = {
  format: typeof VOCAB_EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  lists: VocabList[];
};

/** What to do when an imported list has another list's name (asked of the user; T27). */
export type NameConflictChoice = "merge" | "rename" | "skip";
export type NameConflictResolver = (existing: VocabList, incoming: VocabList) => Promise<NameConflictChoice>;

export type ImportSummary = {
  listsAdded: number;
  listsMerged: number;
  listsSkipped: number;
  itemsAdded: number;
  itemsMerged: number;
  duplicatesFlagged: number;
};

/** An import file could not be read (unknown format, newer schema, malformed rows). */
export class VocabImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabImportError";
  }
}

/** A list or item id that does not exist. */
export class VocabNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabNotFoundError";
  }
}
