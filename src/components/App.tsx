/**
 * src/components/App.tsx — root component
 *
 * Description:
 *   Root route element. Renders Layout and any app-wide UI (e.g., a
 *   top-level error boundary fallback).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Render <Layout />.
 *   2. Route-level error element (proposed) with a user-facing message.
 *   3. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react, react-router-dom.
 *   Internal: ./Layout/Layout.tsx, ./App.module.css.
 *   Used by: src/routes.tsx.
 *
 * Status: implemented (T39).
 */

import { isRouteErrorResponse, useRouteError } from "react-router";
import { useI18n } from "../hooks/useI18n";
import styles from "./App.module.css";
import { Layout } from "./Layout/Layout";

/** Root route element: the page frame. */
export function App(): React.JSX.Element {
  return <Layout />;
}

/** Route-level error fallback. */
export function RouteError(): React.JSX.Element {
  const { t } = useI18n();
  const error = useRouteError();
  const detail = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : null;
  return (
    <div className={styles.error} role="alert">
      <h1>{t("app.errorTitle")}</h1>
      <p>{t("app.errorBody")}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      <a href="#/input">{t("app.errorLink")}</a>
    </div>
  );
}
