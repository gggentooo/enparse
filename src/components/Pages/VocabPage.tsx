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
 *   1. List overview and selected-list item table from useVocab.
 *   2. CRUD actions with confirmation Modal for deletes.
 *   3. Export (download Blob) and import (file input) with result summary.
 *   4. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useVocab.ts, components/Shared/Button.tsx,
 *             components/Shared/Modal.tsx, ./VocabPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Open items (todo.md): entry schema; export format; import conflicts.
 *
 * Status: placeholder (T39 app shell); the page is built in T48.
 */

import { useI18n } from "../../hooks/useI18n";
import styles from "./VocabPage.module.css";

/** TODO(T48): placeholder page. */
export function VocabPage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.vocab.title")}</h1>
      <p>{t("page.vocab.placeholder")}</p>
    </section>
  );
}
