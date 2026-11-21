/**
 * src/components/Pages/VocabListDetail.tsx — one vocabulary list (VocabPage)
 *
 * Description:
 *   The selected list: rename, delete (confirmed in a Modal), a form to add a
 *   word by hand, and the item table (rows in ./VocabItemRow.tsx).
 *
 * Layer: components/ (page-specific UI of VocabPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useVocab.ts (types), Shared/Button.tsx,
 *             Shared/Modal.tsx, ./VocabItemRow.tsx, ./VocabListDetail.module.css.
 *   Used by: ./VocabPage.tsx.
 *
 * Status: implemented (T48).
 */

import { useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { NewVocabItem, VocabItem, VocabList } from "../../hooks/useVocab";
import { Button } from "../Shared/Button";
import { Modal } from "../Shared/Modal";
import { type ItemPatch, VocabItemRow, splitTags } from "./VocabItemRow";
import styles from "./VocabListDetail.module.css";

export type VocabListDetailProps = {
  list: VocabList;
  otherLists: readonly VocabList[];
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Resolves true if the word was added (the form is then cleared). */
  onAdd: (item: NewVocabItem) => Promise<boolean>;
  onUpdate: (itemId: VocabItem["id"], patch: ItemPatch) => Promise<void>;
  onRemove: (itemId: VocabItem["id"]) => Promise<void>;
  onMove: (itemId: VocabItem["id"], toListId: string) => Promise<void>;
};

const EMPTY_FORM = { word: "", meaning: "", notes: "", tags: "" };

export function VocabListDetail(props: VocabListDetailProps): React.JSX.Element {
  const { list, otherLists } = props;
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(list.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const ids = { heading: useId(), rename: useId(), word: useId(), meaning: useId(), notes: useId(), tags: useId() };
  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <section className={styles.detail} aria-labelledby={ids.heading}>
      <div className={styles.header}>
        {renaming ? (
          <form
            className={styles.inline}
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) void props.onRename(name).then(() => setRenaming(false));
            }}
          >
            <label htmlFor={ids.rename}>{t("vocab.listName")}</label>
            <input id={ids.rename} value={newName} onChange={(e) => setNewName(e.target.value)} required />
            <Button type="submit">{t("common.save")}</Button>
            <Button variant="secondary" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
          </form>
        ) : (
          <>
            <h2 id={ids.heading} className={styles.title}>
              {list.name}
            </h2>
            <Button
              variant="secondary"
              onClick={() => {
                setNewName(list.name);
                setRenaming(true);
              }}
            >
              {t("vocab.renameList")}
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("vocab.deleteList")}
            </Button>
          </>
        )}
      </div>

      <form
        className={styles.add}
        aria-label={t("vocab.addWord")}
        onSubmit={(e) => {
          e.preventDefault();
          const word = form.word.trim();
          if (!word) return;
          const submitted = form;
          void props
            .onAdd({
              word,
              definitionKo: submitted.meaning.trim() || null,
              notes: submitted.notes.trim(),
              tags: splitTags(submitted.tags),
            })
            // Clear only if the user has not started typing the next word meanwhile.
            .then((ok) => ok && setForm((current) => (current === submitted ? EMPTY_FORM : current)));
        }}
      >
        <label htmlFor={ids.word}>{t("vocab.word")}</label>
        <input id={ids.word} required lang="en" {...field("word")} />
        <label htmlFor={ids.meaning}>{t("vocab.meaningKo")}</label>
        <input id={ids.meaning} {...field("meaning")} />
        <label htmlFor={ids.notes}>{t("vocab.notes")}</label>
        <input id={ids.notes} {...field("notes")} />
        <label htmlFor={ids.tags}>{t("vocab.tags")}</label>
        <input id={ids.tags} {...field("tags")} />
        <Button type="submit" disabled={!form.word.trim()}>
          {t("vocab.addWord")}
        </Button>
      </form>

      {list.items.length === 0 ? (
        <p className={styles.empty}>{t("vocab.listEmpty")}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t("vocab.tableCaption", { name: list.name })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("vocab.col.word")}</th>
                <th scope="col">{t("vocab.col.lemma")}</th>
                <th scope="col">{t("vocab.col.pos")}</th>
                <th scope="col">{t("vocab.col.meaning")}</th>
                <th scope="col">{t("vocab.col.notes")}</th>
                <th scope="col">{t("vocab.col.added")}</th>
                <th scope="col">{t("vocab.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <VocabItemRow
                  key={item.id}
                  item={item}
                  otherLists={otherLists}
                  onUpdate={(patch) => props.onUpdate(item.id, patch)}
                  onRemove={() => props.onRemove(item.id)}
                  onMove={(toId) => props.onMove(item.id, toId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={confirmDelete}
        title={t("vocab.deleteList")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                void props.onDelete();
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("vocab.deleteListConfirm", { name: list.name, count: list.items.length })}</p>
      </Modal>
    </section>
  );
}
