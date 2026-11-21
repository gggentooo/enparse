/**
 * src/components/Pages/VocabItemRow.tsx — one word in the vocabulary table (VocabPage)
 *
 * Description:
 *   A table row with the word's facts and its actions: edit (meaning,
 *   notes, tags), move to another list, and remove (confirmed). Each action
 *   opens a Modal; buttons name the word for screen readers.
 *
 * Layer: components/ (page-specific UI of VocabPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useVocab.ts (types), Shared/Button.tsx,
 *             Shared/Modal.tsx, ./VocabItemRow.module.css.
 *   Used by: ./VocabListDetail.tsx.
 *
 * Status: implemented (T48).
 */

import { useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { VocabItem, VocabList } from "../../hooks/useVocab";
import { Button } from "../Shared/Button";
import { Modal } from "../Shared/Modal";
import styles from "./VocabItemRow.module.css";

/** Fields the row edits. */
export type ItemPatch = Partial<Pick<VocabItem, "definitionKo" | "notes" | "tags">>;

/** "a, b ,, c" → ["a", "b", "c"] */
export function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type VocabItemRowProps = {
  item: VocabItem;
  otherLists: readonly VocabList[];
  onUpdate: (patch: ItemPatch) => Promise<void>;
  onRemove: () => Promise<void>;
  onMove: (toListId: string) => Promise<void>;
};

type Dialog = "edit" | "move" | "remove" | null;

export function VocabItemRow({ item, otherLists, onUpdate, onRemove, onMove }: VocabItemRowProps): React.JSX.Element {
  const { t, formatDate } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [edit, setEdit] = useState({ meaning: "", notes: "", tags: "" });
  const [target, setTarget] = useState("");
  const ids = { meaning: useId(), notes: useId(), tags: useId(), move: useId() };
  const close = (): void => setDialog(null);
  const word = item.word;

  return (
    <tr>
      <th scope="row" lang="en" className={styles.word}>
        {word}
        {item.duplicate && (
          <span className={styles.duplicate} title={t("vocab.duplicateHint")}>
            {t("vocab.duplicate")}
          </span>
        )}
      </th>
      <td lang="en">{item.lemma ?? ""}</td>
      <td>{item.upos ?? ""}</td>
      <td>{item.definitionKo ?? item.definitionEn ?? ""}</td>
      <td>
        {item.notes}
        {item.tags.length > 0 && <span className={styles.tags}>{item.tags.join(", ")}</span>}
      </td>
      <td>
        <time className={styles.date} dateTime={item.addedAt}>
          {formatDate(new Date(item.addedAt))}
        </time>
      </td>
      <td>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            aria-label={t("vocab.editWord", { word })}
            onClick={() => {
              setEdit({ meaning: item.definitionKo ?? "", notes: item.notes, tags: item.tags.join(", ") });
              setDialog("edit");
            }}
          >
            {t("common.edit")}
          </Button>
          {otherLists.length > 0 && (
            <Button
              variant="secondary"
              aria-label={t("vocab.moveWord", { word })}
              onClick={() => {
                setTarget(otherLists[0]?.id ?? "");
                setDialog("move");
              }}
            >
              {t("vocab.move")}
            </Button>
          )}
          <Button variant="danger" aria-label={t("vocab.removeWord", { word })} onClick={() => setDialog("remove")}>
            {t("vocab.remove")}
          </Button>

          <Modal
            open={dialog === "edit"}
            title={t("vocab.editWord", { word })}
            onClose={close}
            actions={
              <>
                <Button variant="secondary" onClick={close}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    close();
                    void onUpdate({
                      definitionKo: edit.meaning.trim() || null,
                      notes: edit.notes.trim(),
                      tags: splitTags(edit.tags),
                    });
                  }}
                >
                  {t("common.save")}
                </Button>
              </>
            }
          >
            <div className={styles.form}>
              <label htmlFor={ids.meaning}>{t("vocab.meaningKo")}</label>
              <input
                id={ids.meaning}
                value={edit.meaning}
                onChange={(e) => setEdit({ ...edit, meaning: e.target.value })}
              />
              <label htmlFor={ids.notes}>{t("vocab.notes")}</label>
              <input id={ids.notes} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              <label htmlFor={ids.tags}>{t("vocab.tags")}</label>
              <input id={ids.tags} value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} />
            </div>
          </Modal>

          <Modal
            open={dialog === "move"}
            title={t("vocab.moveWord", { word })}
            onClose={close}
            actions={
              <>
                <Button variant="secondary" onClick={close}>
                  {t("common.cancel")}
                </Button>
                <Button
                  disabled={!target}
                  onClick={() => {
                    close();
                    void onMove(target);
                  }}
                >
                  {t("vocab.move")}
                </Button>
              </>
            }
          >
            <div className={styles.form}>
              <label htmlFor={ids.move}>{t("vocab.moveTo")}</label>
              <select id={ids.move} value={target} onChange={(e) => setTarget(e.target.value)}>
                {otherLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </Modal>

          <Modal
            open={dialog === "remove"}
            title={t("vocab.removeWord", { word })}
            onClose={close}
            actions={
              <>
                <Button variant="secondary" onClick={close}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    close();
                    void onRemove();
                  }}
                >
                  {t("common.delete")}
                </Button>
              </>
            }
          >
            <p>{t("vocab.removeConfirm", { word })}</p>
          </Modal>
        </div>
      </td>
    </tr>
  );
}
