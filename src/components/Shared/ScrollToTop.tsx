/**
 * src/components/Shared/ScrollToTop.tsx — "back to top" button (T107)
 *
 * Description:
 *   A round button that always floats at the bottom right corner of the
 *   viewport (owner, 2026-11-24). It scrolls the page to the top (smoothly
 *   unless the user prefers reduced motion) and moves keyboard focus to the
 *   main content, so the next Tab starts from the top of the page.
 *
 * Layer: components/ (Shared)
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useI18n.ts, ./ScrollToTop.module.css.
 *   Used by: Layout/Layout.tsx.
 *
 * Status: implemented (T107). Tests: Shared.test.tsx.
 */

import { useI18n } from "../../hooks/useI18n";
import styles from "./ScrollToTop.module.css";

/** Scroll to the top; focus the main content (#content) without a second jump. */
export function scrollToTop(): void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  document.getElementById("content")?.focus({ preventScroll: true });
}

export function ScrollToTop(): React.JSX.Element {
  const { t } = useI18n();
  const label = t("layout.toTop");
  return (
    <button type="button" className={styles.toTop} aria-label={label} title={label} onClick={scrollToTop}>
      <span aria-hidden="true">↑</span>
    </button>
  );
}
