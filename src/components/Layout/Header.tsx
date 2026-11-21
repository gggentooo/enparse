/**
 * src/components/Layout/Header.tsx — app header
 *
 * Description:
 *   Branding and global actions, including the model status indicator
 *   (loading progress, ready, or failed with retry).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. App name/logo.
 *   2. Model status from useParser: checking, no model chosen (link to
 *      #/models), downloading/loading progress, ready badge with the active
 *      model's display name (useModelLibrary) and a warning mark if
 *      pre-flight warned, failed reason with a retry button. The badge opens
 *      DiagnosticsPanel; a link opens the model library.
 *   3. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, hooks/useModelLibrary.ts,
 *             components/Shared/LoadingSpinner.tsx,
 *             components/Shared/DiagnosticsPanel.tsx, components/Shared/Modal.tsx,
 *             ./Header.module.css.
 *   Used by: ./Layout.tsx.
 *
 * Open items (todo.md): branding; interface language.
 *
 * Status: shell implemented (T39): branding and the language menu (T68). Model status (task 2) comes with useParser (T52) and DiagnosticsPanel (T55).
 */

import { useId } from "react";
import { useI18n } from "../../hooks/useI18n";
import { isLanguage } from "../../i18n/i18n";
import styles from "./Header.module.css";

/** App header with the language menu (T68). TODO(T52): model status badge, retry, and DiagnosticsPanel. */
export function Header(): React.JSX.Element {
  const { t, lang, languages, setLanguage } = useI18n();
  const selectId = useId();
  return (
    <header className={styles.header}>
      <span className={styles.name}>{t("app.name")}</span>
      <span className={styles.tagline}>{t("app.tagline")}</span>
      <div className={styles.language}>
        <label htmlFor={selectId}>{t("language.label")}</label>
        <select
          id={selectId}
          value={lang}
          onChange={(e) => {
            if (isLanguage(e.target.value)) void setLanguage(e.target.value);
          }}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
