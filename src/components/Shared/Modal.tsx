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
 *   Used by: VocabPage, Layout/Header (DiagnosticsPanel), and other pages.
 *
 * Status: implemented (T39) with native <dialog> (focus containment, Escape, and focus return come from showModal()).
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
  /** Action buttons; a Close button is shown when omitted. */
  actions?: ReactNode;
};

/** Modal dialog (native <dialog>): Escape and the Close button call onClose; focus returns to the opener. */
export function Modal({ open, title, onClose, children, actions }: ModalProps): React.JSX.Element {
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
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
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
