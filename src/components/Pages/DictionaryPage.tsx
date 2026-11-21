/**
 * src/components/Pages/DictionaryPage.tsx — dictionary lookup page (#/dictionary)
 *
 * Description:
 *   Search box and full dictionary entry view (English and Korean
 *   definitions, examples, subword breakdown).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Labeled search input → useDictionary().lookup.
 *   2. Entry view: senses, definitions, Korean translations, examples.
 *   3. Subword breakdown via useSubword.
 *   4. "Add to vocab list" via useVocab.
 *   5. Not-found and error states; text via useI18n() (T68).
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useDictionary.ts, hooks/useSubword.ts, hooks/useVocab.ts,
 *             components/Shared/*, ./DictionaryPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Open items (todo.md): lookup trigger; sense selection.
 *
 * Status: placeholder (T39 app shell); the page is built in T53.
 */

import { useI18n } from "../../hooks/useI18n";
import styles from "./DictionaryPage.module.css";

/** TODO(T53): placeholder page. */
export function DictionaryPage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.dictionary.title")}</h1>
      <p>{t("page.dictionary.placeholder")}</p>
    </section>
  );
}
