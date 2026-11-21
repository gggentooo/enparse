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
 *   4. Export to JSON (canonical) and CSV (hand-written codec, ./csv.ts; T27).
 *   5. Import with validation and conflict handling; typed VocabImportError.
 *   6. Unit tests in vocabManager.test.ts with mocked storage.
 *
 * Dependencies:
 *   Internal: ./types.ts; core/storage.ts; utils/helpers.ts.
 *   External: none (T27: no CSV or zip dependency).
 *   Used by: services/vocabService.ts (via ./index.ts).
 *
 * Open items (todo.md): entry schema; export format and
 *   versioning; third-party compatibility (Anki); import conflicts;
 *   storage limits.
 *
 * Status: implemented (T40; owner decisions T27). Tests: vocabManager.test.ts.
 */

import { type AppStorage, appStorage } from "../../core/storage";
import { formatIsoTimestamp, lookupKey } from "../../utils/helpers";
import { parseCsv, toCsv } from "./csv";
import {
  type ImportSummary,
  type NameConflictResolver,
  type NewVocabItem,
  VOCAB_EXPORT_FORMAT,
  VOCAB_SCHEMA_VERSION,
  type VocabExport,
  VocabImportError,
  type VocabItem,
  type VocabList,
  VocabNotFoundError,
} from "./types";

/** Storage keys: one IndexedDB entry per list; the last export time in LocalStorage. */
const LIST_PREFIX = "vocab/list/";
const LAST_EXPORT_KEY = "vocab/lastExportAt";
/** Days after the last export (with changes since) before the backup reminder shows. (proposed) */
export const BACKUP_REMINDER_DAYS = 7;
/** CSV columns (export and import). */
export const CSV_COLUMNS = [
  "list",
  "word",
  "lemma",
  "upos",
  "definition_en",
  "definition_ko",
  "example",
  "source_sentence",
  "notes",
  "tags",
  "added_at",
  "id",
] as const;
const TAG_SEPARATOR = ";";

export type VocabManagerOptions = {
  storage?: AppStorage;
  now?: () => Date;
  newId?: () => string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Bring a stored or imported item up to the current schema (v1 is current). */
export function migrateItem(raw: unknown): VocabItem {
  if (!isObj(raw) || typeof raw.word !== "string" || raw.word.trim() === "" || typeof raw.id !== "string") {
    throw new VocabImportError("vocabulary item without id or word");
  }
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
  if (version > VOCAB_SCHEMA_VERSION) throw new VocabImportError(`item schema ${version} is newer than this app`);
  return {
    id: raw.id,
    word: raw.word,
    lemma: strOrNull(raw.lemma),
    upos: strOrNull(raw.upos),
    definitionEn: strOrNull(raw.definitionEn),
    definitionKo: strOrNull(raw.definitionKo),
    example: strOrNull(raw.example),
    sourceSentence: strOrNull(raw.sourceSentence),
    notes: typeof raw.notes === "string" ? raw.notes : "",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    addedAt: typeof raw.addedAt === "string" ? raw.addedAt : new Date(0).toISOString(),
    duplicate: raw.duplicate === true,
    schemaVersion: VOCAB_SCHEMA_VERSION,
  };
}

function migrateList(raw: unknown): VocabList {
  if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.items)) {
    throw new VocabImportError("vocabulary list without id, name, or items");
  }
  return {
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    items: raw.items.map(migrateItem),
  };
}

/** Re-flag duplicates in a list: every item whose word (lookup key) appears earlier. */
function flagDuplicates(list: VocabList): number {
  const seen = new Set<string>();
  let flagged = 0;
  for (const it of list.items) {
    const k = lookupKey(it.word);
    it.duplicate = seen.has(k);
    if (it.duplicate) flagged++;
    seen.add(k);
  }
  return flagged;
}

/** Merge an incoming item into an existing one with the same id: nothing is lost. */
function mergeItem(a: VocabItem, b: VocabItem): VocabItem {
  const fill = <K extends "lemma" | "upos" | "definitionEn" | "definitionKo" | "example" | "sourceSentence">(
    k: K,
  ): string | null => a[k] ?? b[k];
  const notes = a.notes && b.notes && a.notes !== b.notes ? `${a.notes}\n${b.notes}` : a.notes || b.notes;
  return {
    ...a,
    lemma: fill("lemma"),
    upos: fill("upos"),
    definitionEn: fill("definitionEn"),
    definitionKo: fill("definitionKo"),
    example: fill("example"),
    sourceSentence: fill("sourceSentence"),
    notes,
    tags: [...new Set([...a.tags, ...b.tags])],
    addedAt: a.addedAt < b.addedAt ? a.addedAt : b.addedAt,
  };
}

/** Vocabulary lists persisted through core/storage. */
export class VocabManager {
  private readonly storage: AppStorage;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: VocabManagerOptions = {}) {
    this.storage = options.storage ?? appStorage();
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  private stamp(): string {
    return formatIsoTimestamp(this.now());
  }

  private async save(list: VocabList): Promise<VocabList> {
    await this.storage.set(LIST_PREFIX + list.id, list, { backend: "indexeddb" });
    return list;
  }

  private async get(listId: string): Promise<VocabList> {
    const raw = await this.storage.get(LIST_PREFIX + listId);
    if (raw === undefined) throw new VocabNotFoundError(`no vocabulary list ${listId}`);
    return migrateList(raw);
  }

  /** All lists, oldest first. */
  async loadAll(): Promise<VocabList[]> {
    const keys = await this.storage.keys(LIST_PREFIX);
    const lists: VocabList[] = [];
    for (const k of keys) lists.push(migrateList(await this.storage.get(k)));
    return lists.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  }

  async createList(name: string): Promise<VocabList> {
    const t = this.stamp();
    return this.save({ id: this.newId(), name: name.trim(), createdAt: t, updatedAt: t, items: [] });
  }

  async renameList(listId: string, name: string): Promise<VocabList> {
    const list = await this.get(listId);
    return this.save({ ...list, name: name.trim(), updatedAt: this.stamp() });
  }

  async deleteList(listId: string): Promise<void> {
    await this.get(listId);
    await this.storage.remove(LIST_PREFIX + listId);
  }

  /** Add a word; the same word already in the list is kept and flagged as a duplicate. */
  async addItem(listId: string, input: NewVocabItem): Promise<VocabItem> {
    if (input.word.trim() === "") throw new TypeError("word must not be empty");
    const list = await this.get(listId);
    const item = migrateItem({
      ...input,
      id: this.newId(),
      word: input.word.trim(),
      addedAt: this.stamp(),
      schemaVersion: VOCAB_SCHEMA_VERSION,
    });
    list.items.push(item);
    flagDuplicates(list);
    await this.save({ ...list, updatedAt: this.stamp() });
    return list.items[list.items.length - 1] as VocabItem;
  }

  async updateItem(
    listId: string,
    itemId: string,
    patch: Partial<Omit<VocabItem, "id" | "schemaVersion" | "addedAt">>,
  ): Promise<VocabItem> {
    const list = await this.get(listId);
    const i = list.items.findIndex((x) => x.id === itemId);
    if (i < 0) throw new VocabNotFoundError(`no item ${itemId} in list ${listId}`);
    list.items[i] = migrateItem({ ...list.items[i], ...patch });
    flagDuplicates(list);
    await this.save({ ...list, updatedAt: this.stamp() });
    return list.items[i] as VocabItem;
  }

  async removeItem(listId: string, itemId: string): Promise<void> {
    const list = await this.get(listId);
    const items = list.items.filter((x) => x.id !== itemId);
    if (items.length === list.items.length) throw new VocabNotFoundError(`no item ${itemId} in list ${listId}`);
    const next = { ...list, items, updatedAt: this.stamp() };
    flagDuplicates(next);
    await this.save(next);
  }

  async moveItem(fromListId: string, toListId: string, itemId: string): Promise<void> {
    if (fromListId === toListId) return;
    const from = await this.get(fromListId);
    const to = await this.get(toListId);
    const item = from.items.find((x) => x.id === itemId);
    if (!item) throw new VocabNotFoundError(`no item ${itemId} in list ${fromListId}`);
    from.items = from.items.filter((x) => x.id !== itemId);
    to.items.push(item);
    flagDuplicates(from);
    flagDuplicates(to);
    const t = this.stamp();
    await this.save({ ...to, updatedAt: t });
    await this.save({ ...from, updatedAt: t });
  }

  // -- export ------------------------------------------------------------------------------

  /** Canonical JSON export (lossless; versioned). Records the export time for the reminder. */
  async exportJson(listIds?: readonly string[]): Promise<string> {
    const lists = (await this.loadAll()).filter((l) => !listIds || listIds.includes(l.id));
    const file: VocabExport = {
      format: VOCAB_EXPORT_FORMAT,
      schemaVersion: VOCAB_SCHEMA_VERSION,
      exportedAt: this.stamp(),
      lists,
    };
    await this.storage.set(LAST_EXPORT_KEY, file.exportedAt, { backend: "local" });
    return JSON.stringify(file, null, 2);
  }

  /** CSV export (spreadsheets; Anki plain-text import): one row per item. */
  async exportCsv(listIds?: readonly string[]): Promise<string> {
    const lists = (await this.loadAll()).filter((l) => !listIds || listIds.includes(l.id));
    const rows: string[][] = [[...CSV_COLUMNS]];
    for (const l of lists) {
      for (const it of l.items) {
        rows.push([
          l.name,
          it.word,
          it.lemma ?? "",
          it.upos ?? "",
          it.definitionEn ?? "",
          it.definitionKo ?? "",
          it.example ?? "",
          it.sourceSentence ?? "",
          it.notes,
          it.tags.join(TAG_SEPARATOR),
          it.addedAt,
          it.id,
        ]);
      }
    }
    await this.storage.set(LAST_EXPORT_KEY, this.stamp(), { backend: "local" });
    return toCsv(rows);
  }

  /** True if lists changed since the last export and it is older than BACKUP_REMINDER_DAYS (or never). */
  async backupDue(): Promise<boolean> {
    const lists = await this.loadAll();
    if (!lists.some((l) => l.items.length > 0)) return false;
    const last = await this.storage.get(LAST_EXPORT_KEY);
    if (typeof last !== "string") return true;
    const changed = lists.some((l) => l.updatedAt > last);
    const ageDays = (this.now().getTime() - Date.parse(last)) / 86_400_000;
    return changed && ageDays >= BACKUP_REMINDER_DAYS;
  }

  // -- import ------------------------------------------------------------------------------

  /** Import a JSON export file (T27 rules). */
  async importJson(text: string, resolve: NameConflictResolver): Promise<ImportSummary> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new VocabImportError("not a JSON file");
    }
    if (!isObj(json) || json.format !== VOCAB_EXPORT_FORMAT || !Array.isArray(json.lists)) {
      throw new VocabImportError("not an Enparse vocabulary export");
    }
    if (typeof json.schemaVersion === "number" && json.schemaVersion > VOCAB_SCHEMA_VERSION) {
      throw new VocabImportError(`export schema ${json.schemaVersion} is newer than this app`);
    }
    return this.importLists(json.lists.map(migrateList), resolve);
  }

  /** Import CSV rows (CSV_COLUMNS header required; rows without an id get a new one). */
  async importCsv(text: string, resolve: NameConflictResolver): Promise<ImportSummary> {
    let rows: string[][];
    try {
      rows = parseCsv(text);
    } catch (e) {
      throw new VocabImportError(`malformed CSV: ${e instanceof Error ? e.message : String(e)}`);
    }
    const [header, ...data] = rows;
    const col = new Map((header ?? []).map((h, i) => [h.trim(), i]));
    if (!col.has("list") || !col.has("word"))
      throw new VocabImportError("CSV needs at least the columns list and word");
    const cell = (r: string[], name: (typeof CSV_COLUMNS)[number]): string => r[col.get(name) ?? -1]?.trim() ?? "";
    const byName = new Map<string, VocabList>();
    const t = this.stamp();
    for (const r of data) {
      const name = cell(r, "list") || "Imported";
      const word = cell(r, "word");
      if (!word) continue;
      let list = byName.get(name);
      if (!list) {
        list = { id: this.newId(), name, createdAt: t, updatedAt: t, items: [] };
        byName.set(name, list);
      }
      list.items.push(
        migrateItem({
          id: cell(r, "id") || this.newId(),
          word,
          lemma: cell(r, "lemma"),
          upos: cell(r, "upos"),
          definitionEn: cell(r, "definition_en"),
          definitionKo: cell(r, "definition_ko"),
          example: cell(r, "example"),
          sourceSentence: cell(r, "source_sentence"),
          notes: cell(r, "notes"),
          tags: cell(r, "tags")
            .split(TAG_SEPARATOR)
            .map((x) => x.trim())
            .filter(Boolean),
          addedAt: cell(r, "added_at") || t,
        }),
      );
    }
    return this.importLists([...byName.values()], resolve);
  }

  /**
   * Merge lists (T27): same list id → merge items by id; another list with the same name →
   * ask (`resolve`: merge into it, import renamed, or skip); otherwise add. Items with an
   * existing id merge field by field; the same word with a new id is kept and flagged.
   */
  private async importLists(incoming: VocabList[], resolve: NameConflictResolver): Promise<ImportSummary> {
    const summary: ImportSummary = {
      listsAdded: 0,
      listsMerged: 0,
      listsSkipped: 0,
      itemsAdded: 0,
      itemsMerged: 0,
      duplicatesFlagged: 0,
    };
    const existing = await this.loadAll();
    for (const inc of incoming) {
      let target = existing.find((l) => l.id === inc.id);
      if (!target) {
        const sameName = existing.find((l) => lookupKey(l.name) === lookupKey(inc.name));
        if (sameName) {
          const choice = await resolve(sameName, inc);
          if (choice === "skip") {
            summary.listsSkipped++;
            continue;
          }
          if (choice === "merge") target = sameName;
          else inc.name = this.uniqueName(inc.name, existing);
        }
      }
      if (!target) {
        const before = flagDuplicates(inc);
        existing.push(await this.save({ ...inc, updatedAt: this.stamp() }));
        summary.listsAdded++;
        summary.itemsAdded += inc.items.length;
        summary.duplicatesFlagged += before;
        continue;
      }
      const dupBefore = target.items.filter((x) => x.duplicate).length;
      for (const it of inc.items) {
        const i = target.items.findIndex((x) => x.id === it.id);
        if (i >= 0) {
          target.items[i] = mergeItem(target.items[i] as VocabItem, it);
          summary.itemsMerged++;
        } else {
          target.items.push(it);
          summary.itemsAdded++;
        }
      }
      summary.duplicatesFlagged += Math.max(0, flagDuplicates(target) - dupBefore);
      await this.save({ ...target, updatedAt: this.stamp() });
      summary.listsMerged++;
    }
    return summary;
  }

  private uniqueName(name: string, lists: readonly VocabList[]): string {
    const taken = new Set(lists.map((l) => lookupKey(l.name)));
    for (let n = 2; ; n++) {
      const candidate = `${name} (${n})`;
      if (!taken.has(lookupKey(candidate))) return candidate;
    }
  }
}
