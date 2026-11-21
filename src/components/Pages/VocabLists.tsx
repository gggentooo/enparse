/**
 * src/components/Pages/VocabLists.tsx — list overview and "create list" form (VocabPage)
 *
 * Description:
 *   The user's vocabulary lists with word counts; selecting one shows it in
 *   VocabListDetail. A form creates a new list.
 *
 * Layer: components/ (page-specific UI of VocabPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useVocab.ts (types), Shared/Button.tsx,
 *             ./VocabLists.module.css.
 *   Used by: ./VocabPage.tsx.
 *
 * Status: implemented (T48).
 */

import { useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { VocabList } from "../../hooks/useVocab";
import { Button } from "../Shared/Button";
import styles from "./VocabLists.module.css";

export type VocabListsProps = {
  lists: readonly VocabList[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Resolves true if the list was created (the form is then cleared). */
  onCreate: (name: string) => Promise<boolean>;
};

export function VocabLists({ lists, selectedId, onSelect, onCreate }: VocabListsProps): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const inputId = useId();

  return (
    <nav className={styles.lists} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {t("vocab.lists")}
      </h2>
      {lists.length === 0 ? (
        <p className={styles.empty}>{t("vocab.noLists")}</p>
      ) : (
        <ul className={styles.items}>
          {lists.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={styles.list}
                aria-current={l.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(l.id)}
              >
                <span className={styles.name}>{l.name}</span>
                <span className={styles.count}>{t("vocab.wordCount", { count: l.items.length })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={styles.create}
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          setBusy(true);
          void onCreate(trimmed).then((ok) => {
            setBusy(false);
            if (ok) setName("");
          });
        }}
      >
        <label htmlFor={inputId}>{t("vocab.newListLabel")}</label>
        <input id={inputId} value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit" isLoading={busy} disabled={!name.trim()}>
          {t("vocab.createList")}
        </Button>
      </form>
    </nav>
  );
}
