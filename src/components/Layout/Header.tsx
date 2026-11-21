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

import { useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { type ModelStatus, useParser } from "../../hooks/useParser";
import { isLanguage } from "../../i18n/i18n";
import { DiagnosticsPanel } from "../Shared/DiagnosticsPanel";
import { Modal } from "../Shared/Modal";
import styles from "./Header.module.css";

type Badge = "ready" | "busy" | "noModel" | "failed";
const badgeOf = (s: ModelStatus): Badge =>
  s.state === "ready" ? "ready" : s.state === "failed" ? "failed" : s.state === "no-model" ? "noModel" : "busy";
const MARK: Readonly<Record<Badge, string>> = { ready: "●", busy: "…", noModel: "○", failed: "!" };

/** App header: language menu (T68) and the parser status badge that opens DiagnosticsPanel (T24, T55). */
export function Header(): React.JSX.Element {
  const { t, lang, languages, setLanguage } = useI18n();
  const selectId = useId();
  const { status } = useParser();
  const [open, setOpen] = useState(false);
  const badge = badgeOf(status);
  const badgeText = t(`status.badge.${badge}`);
  return (
    <header className={styles.header}>
      <span className={styles.name}>{t("app.name")}</span>
      <span className={styles.tagline}>{t("app.tagline")}</span>
      <button
        type="button"
        className={`${styles.badge} ${styles[badge]}`}
        aria-label={t("status.badgeLabel", { status: badgeText })}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">{MARK[badge]}</span> {badgeText}
      </button>
      <Modal open={open} title={t("diag.title")} onClose={() => setOpen(false)}>
        {open && <DiagnosticsPanel />}
      </Modal>
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
