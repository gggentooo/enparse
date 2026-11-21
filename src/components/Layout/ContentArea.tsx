/**
 * src/components/Layout/ContentArea.tsx — route outlet
 *
 * Description:
 *   Main content region; renders the active page via <Outlet />.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. <main id="content"> (skip-link target) wrapping <Outlet />.
 *
 * Dependencies:
 *   External: react, react-router-dom.
 *   Internal: ./ContentArea.module.css.
 *   Used by: ./Layout.tsx.
 *
 * Status: implemented (T39).
 */

import { Outlet } from "react-router";
import styles from "./ContentArea.module.css";

/** Main content region (skip-link target). */
export function ContentArea(): React.JSX.Element {
  return (
    <main id="content" className={styles.content} tabIndex={-1}>
      <Outlet />
    </main>
  );
}
