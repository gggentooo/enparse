/**
 * src/components/Shared/Tooltip.tsx — shared tooltip / popover
 *
 * Description:
 *   Positioned popover anchored to an element; used for inline word lookup.
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Open on focus/click (and hover if chosen); close on Escape and outside click.
 *   2. aria-describedby or dialog semantics depending on content.
 *   3. Keep within the viewport.
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./Tooltip.module.css.
 *   Used by: OutputPage.
 *
 * Open items (todo.md): lookup trigger (selection, hover, click, tap).
 *
 * Status: implemented (T39): click/focus popover, Escape and outside click close it. Lookup trigger details follow T25.
 */

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import styles from "./Tooltip.module.css";

export type TooltipProps = {
  /** Accessible name of the trigger. */
  label: string;
  /** Trigger content (e.g. a word). */
  children: ReactNode;
  /** Popover content. */
  content: ReactNode;
};

/** Popover anchored below its trigger button; toggles on click, closes on Escape or outside click. */
export function Tooltip({ label, children, content }: TooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  return (
    <span ref={root} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && (
        <span id={id} role="dialog" aria-label={label} className={styles.popover}>
          {content}
        </span>
      )}
    </span>
  );
}
