/**
 * src/components/Shared/Modal.tsx — shared modal dialog
 *
 * Description:
 *   Accessible dialog for confirmations and forms.
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Native <dialog> (proposed) with title (aria-labelledby), body, actions.
 *   2. Focus trap, Escape to close, focus returned to the trigger.
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./Button.tsx, ./Modal.module.css.
 *   Used by: VocabPage, Layout/Header (DiagnosticsPanel), OutputPage (WordStats,
 *   CreateWordList), and other pages.
 *
 *   3. Tall variant (T104) for long content: at most 800px wide, the full
 *      viewport height, a top bar that does not scroll (title, controls such
 *      as a sort dropdown, Close), and a body that scrolls inside the dialog.
 *
 * Status: implemented (T39) with native <dialog> (focus containment, Escape, and focus return come from showModal());
 *   tall variant T104.
 */

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import { useI18n } from "../../hooks/useI18n";
import styles from "./Modal.module.css";

export type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Action buttons; a Close button is shown when omitted (in the default variant). */
  actions?: ReactNode;
  /**
   * "tall" (T104): 800px wide at most and the full viewport height; the title, `toolbar`, and
   * Close sit in a top bar that stays in place while the body scrolls.
   */
  variant?: "default" | "tall";
  /** Controls in the tall variant's top bar (e.g. a sort dropdown). */
  toolbar?: ReactNode;
};

/** Modal dialog (native <dialog>): Escape and the Close button call onClose; focus returns to the opener. */
export function Modal({
  open,
  title,
  onClose,
  children,
  actions,
  variant = "default",
  toolbar,
}: ModalProps): React.JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", ""); // jsdom and very old browsers
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  const onCancel = (e: React.SyntheticEvent<HTMLDialogElement>): void => {
    e.preventDefault();
    onClose();
  };
  if (variant === "tall") {
    return (
      <dialog ref={ref} className={`${styles.dialog} ${styles.tall}`} aria-labelledby={titleId} onCancel={onCancel}>
        <div className={styles.bar}>
          <h2 id={titleId} className={styles.barTitle}>
            {title}
          </h2>
          {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
        {/* Focusable so keyboard users can scroll it. */}
        <div className={styles.scroll} tabIndex={0} role="region" aria-labelledby={titleId}>
          {children}
        </div>
        {actions && <div className={`${styles.actions} ${styles.tallActions}`}>{actions}</div>}
      </dialog>
    );
  }
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={onCancel}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
      <div className={styles.actions}>
        {actions ?? (
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        )}
      </div>
    </dialog>
  );
}
