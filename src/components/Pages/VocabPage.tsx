/**
 * src/components/Pages/VocabPage.tsx — vocabulary lists page (#/vocab)
 *
 * Description:
 *   Manage custom vocabulary lists: create, rename, delete, edit items,
 *   export and import.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. List overview (./VocabLists.tsx) and selected-list item table
 *      (./VocabListDetail.tsx, ./VocabItemRow.tsx) from useVocab.
 *   2. CRUD actions with confirmation Modal for deletes.
 *   3. Export (download Blob) and import (file input) with result summary
 *      (./VocabTransfer.tsx).
 *   4. user-facing text via useI18n() catalog keys (T68).
 *   5. Backup reminder (vocabService backupDue) and the last action error.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useVocab.ts, hooks/useI18n.ts, ./VocabLists.tsx,
 *             ./VocabListDetail.tsx, ./VocabTransfer.tsx, ./VocabPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Status: implemented (T48). Tests: VocabPage.test.tsx.
 */

import { useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { useVocab } from "../../hooks/useVocab";
import { VocabListDetail } from "./VocabListDetail";
import { VocabLists } from "./VocabLists";
import styles from "./VocabPage.module.css";
import { VocabTransfer } from "./VocabTransfer";

/** Errors are kept in the vocab snapshot (shown below); the rejection itself needs no handling. */
const quietly = (p: Promise<unknown>): Promise<void> =>
  p.then(
    () => undefined,
    () => undefined,
  );

export function VocabPage(): React.JSX.Element {
  const { t } = useI18n();
  const vocab = useVocab();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The selection falls back to the first list (also after the selected list is deleted).
  const selected = vocab.lists.find((l) => l.id === selectedId) ?? vocab.lists[0] ?? null;

  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.vocab.title")}</h1>

      {vocab.status === "error" && (
        <p role="alert" className={styles.error}>
          {t("vocab.loadError", { message: vocab.error ?? "" })}
        </p>
      )}
      {vocab.status !== "error" && vocab.error && (
        <p role="alert" className={styles.error}>
          {t("vocab.actionError", { message: vocab.error })}
        </p>
      )}
      {vocab.backupDue && vocab.lists.length > 0 && (
        <p role="status" className={styles.notice}>
          {t("vocab.backupDue")}
        </p>
      )}

      {vocab.status === "loading" || vocab.status === "idle" ? (
        <p role="status">{t("common.loading")}</p>
      ) : (
        <div className={styles.columns}>
          <VocabLists
            lists={vocab.lists}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            onCreate={async (name) => {
              try {
                const list = await vocab.createList(name);
                setSelectedId(list.id);
                return true;
              } catch {
                return false;
              }
            }}
          />
          {selected && (
            <VocabListDetail
              list={selected}
              otherLists={vocab.lists.filter((l) => l.id !== selected.id)}
              onRename={(name) => quietly(vocab.renameList(selected.id, name))}
              onDelete={() => quietly(vocab.deleteList(selected.id))}
              onAdd={async (item) => {
                try {
                  await vocab.addItem(selected.id, item);
                  return true;
                } catch {
                  return false;
                }
              }}
              onUpdate={(itemId, patch) => quietly(vocab.updateItem(selected.id, itemId, patch))}
              onRemove={(itemId) => quietly(vocab.removeItem(selected.id, itemId))}
              onMove={(itemId, toId) => quietly(vocab.moveItem(selected.id, toId, itemId))}
            />
          )}
        </div>
      )}

      <VocabTransfer
        hasLists={vocab.lists.length > 0}
        exportLists={vocab.exportLists}
        importLists={vocab.importLists}
      />
    </section>
  );
}
