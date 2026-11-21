/**
 * src/components/Shared/LoadingSpinner.tsx — shared loading indicator
 *
 * Description:
 *   Spinner or progress indicator with an accessible label; supports
 *   determinate progress (model download).
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Indeterminate spinner with role="status" and label.
 *   2. Optional progress value (0–1) rendered as a progress bar.
 *   3. Respect prefers-reduced-motion.
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./LoadingSpinner.module.css.
 *   Used by: Button, Header, InputPage.
 *
 * Status: implemented (T39).
 */

import { useI18n } from "../../hooks/useI18n";
import styles from "./LoadingSpinner.module.css";

export type LoadingSpinnerProps = {
  /** Accessible label (default: the "loading" message of the UI language). */
  label?: string;
  /** Determinate progress 0–1; omitted = indeterminate spinner. */
  progress?: number | null;
  size?: "small" | "medium";
  /** Inside another labeled control (e.g. a busy Button): hidden from assistive tech. */
  decorative?: boolean;
};

/** Spinner, or a progress bar when `progress` is given. Animation stops with prefers-reduced-motion. */
export function LoadingSpinner({
  label: labelProp,
  progress = null,
  size = "medium",
  decorative = false,
}: LoadingSpinnerProps): React.JSX.Element {
  const { t } = useI18n();
  const label = labelProp ?? t("common.loading");
  if (progress !== null) {
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    return (
      <div className={styles.progressWrap}>
        <progress className={styles.progress} max={100} value={pct} aria-label={label} />
        <span className={styles.percent} aria-hidden="true">
          {pct}%
        </span>
      </div>
    );
  }
  if (decorative) return <span className={`${styles.spinner} ${styles[size]}`} aria-hidden="true" />;
  return (
    <span role="status" className={styles.statusWrap}>
      <span className={`${styles.spinner} ${styles[size]}`} aria-hidden="true" />
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  );
}
