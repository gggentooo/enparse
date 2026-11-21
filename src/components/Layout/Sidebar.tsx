/**
 * src/components/Layout/Sidebar.tsx — page navigation
 *
 * Description:
 *   Navigation links to Input, Output, Vocab, Dictionary, and Models pages.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. <nav> with NavLink items for #/input, #/output, #/vocab, #/dictionary,
 *      #/models
 *      (kept in sync with src/routes.tsx).
 *   2. Active-link styling and aria-current.
 *   3. link labels via useI18n() (T68).
 *
 * Dependencies:
 *   External: react, react-router-dom.
 *   Internal: ./Sidebar.module.css.
 *   Used by: ./Layout.tsx.
 *
 * Open items (todo.md): interface language.
 *
 * Status: implemented (T39); #/about added (T21).
 */

import { NavLink } from "react-router";
import { useI18n } from "../../hooks/useI18n";
import type { MessageKey } from "../../i18n/i18n";
import { PATHS } from "../../paths";
import styles from "./Sidebar.module.css";

const LINKS: ReadonlyArray<{ to: string; label: MessageKey }> = [
  { to: PATHS.input, label: "nav.input" },
  { to: PATHS.output, label: "nav.output" },
  { to: PATHS.vocab, label: "nav.vocab" },
  { to: PATHS.dictionary, label: "nav.dictionary" },
  { to: PATHS.models, label: "nav.models" },
  { to: PATHS.about, label: "nav.about" },
];

/** Page navigation; NavLink sets aria-current="page" on the active link. */
export function Sidebar(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <nav className={styles.sidebar} aria-label={t("nav.label")}>
      <ul className={styles.list}>
        {LINKS.map((l) => (
          <li key={l.to}>
            <NavLink
              to={l.to}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            >
              {t(l.label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
