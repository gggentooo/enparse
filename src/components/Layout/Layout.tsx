/**
 * src/components/Layout/Layout.tsx — page frame
 *
 * Description:
 *   Arranges Header, Sidebar, and ContentArea.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Grid layout: header on top, sidebar and content below.
 *   2. Skip-to-content link for keyboard users.
 *   3. Responsive behavior (sidebar collapses on narrow screens) if mobile is in scope.
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./Header.tsx, ./Sidebar.tsx, ./ContentArea.tsx, ./Layout.module.css.
 *   Used by: components/App.tsx.
 *
 * Open items (todo.md): target devices (responsive layout).
 *
 * Status: implemented (T39). The sidebar becomes a top bar below the --bp-narrow breakpoint (T19 pending).
 */

import { useI18n } from "../../hooks/useI18n";
import { UpdateBanner } from "../Shared/UpdateBanner";
import { ContentArea } from "./ContentArea";
import { Header } from "./Header";
import styles from "./Layout.module.css";
import { Sidebar } from "./Sidebar";

/** Page frame: skip link, header, sidebar, content. */
export function Layout(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#content" onClick={skipToContent}>
        {t("layout.skip")}
      </a>
      <UpdateBanner />
      <Header />
      <Sidebar />
      <ContentArea />
    </div>
  );
}

/** Hash routing uses the fragment, so move focus to the content region instead of navigating. */
function skipToContent(e: React.MouseEvent<HTMLAnchorElement>): void {
  e.preventDefault();
  document.getElementById("content")?.focus();
}
