/**
 * src/components/Pages/InputPage.tsx — raw text input page (#/input)
 *
 * Description:
 *   Lets the user enter English text (type, paste, drag-and-drop a text
 *   file) and start parsing.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Labeled <textarea> with live character count vs the max length.
 *   2. Drag-and-drop of plain-text files.
 *   3. Parse button → useParser().parseText; navigate to #/output on success.
 *      The button is disabled unless useParser().canParse (model ready); show
 *      why (checking, no model chosen → link to #/models, download/loading
 *      progress, or failure reason with DiagnosticsPanel). Typed text is kept
 *      while the model loads.
 *   4. Show too-long errors (with count) and the removed-text notice.
 *   5. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react, react-router-dom (navigation).
 *   Internal: hooks/useParser.ts, components/Shared/Button.tsx,
 *             components/Shared/DiagnosticsPanel.tsx,
 *             components/Shared/LoadingSpinner.tsx, ./InputPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Open items (todo.md): limit defaults; interface language.
 *
 * Status: placeholder (T39 app shell); the page is built in T56.
 */

import { useI18n } from "../../hooks/useI18n";
import styles from "./InputPage.module.css";

/** TODO(T56): placeholder page. */
export function InputPage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.input.title")}</h1>
      <p>{t("page.input.placeholder")}</p>
    </section>
  );
}
