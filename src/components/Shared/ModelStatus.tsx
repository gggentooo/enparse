/**
 * src/components/Shared/ModelStatus.tsx — one-line parser model status with its next action
 *
 * Description:
 *   Describes the model status in plain language (architecture.md → Model
 *   readiness): checking, no model (link to the model library), download
 *   progress, preparing, ready, or the failure reason with Retry and a
 *   Details dialog (DiagnosticsPanel).
 *
 * Layer: components/ (Shared)
 *
 * Dependencies:
 *   External: react, react-router (Link).
 *   Internal: hooks/useParser.ts, hooks/useModelLibrary.ts, hooks/useI18n.ts,
 *             ./Button.tsx, ./LoadingSpinner.tsx, ./Modal.tsx, ./DiagnosticsPanel.tsx,
 *             ./ModelStatus.module.css, src/paths.ts.
 *   Used by: Pages/InputPage.tsx, Pages/ModelsPage.tsx, ./DiagnosticsPanel.tsx.
 *
 * Status: implemented (T55).
 */

import { useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../../hooks/useI18n";
import { useModelLibrary } from "../../hooks/useModelLibrary";
import { useParser } from "../../hooks/useParser";
import { PATHS } from "../../paths";
import { Button } from "./Button";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { LoadingSpinner } from "./LoadingSpinner";
import { Modal } from "./Modal";
import styles from "./ModelStatus.module.css";

export type ModelStatusProps = {
  /** Offer the Details dialog on failure (off inside DiagnosticsPanel itself). */
  showDetails?: boolean;
};

/** Display name of a model id (the id itself until the catalog is loaded). */
export function useModelName(): (id: string) => string {
  const { models } = useModelLibrary();
  return (id) => models.find((m) => m.entry.id === id)?.entry.display_name ?? id;
}

export function ModelStatus({ showDetails = true }: ModelStatusProps): React.JSX.Element {
  const { t } = useI18n();
  const { status, retryLoad } = useParser();
  const name = useModelName();
  const [details, setDetails] = useState(false);

  switch (status.state) {
    case "idle":
    case "checking":
      return (
        <p className={styles.status}>
          <LoadingSpinner size="small" decorative />
          <span role="status">{t(status.state === "idle" ? "status.idle" : "status.checking")}</span>
        </p>
      );
    case "no-model":
      return (
        <p className={styles.status}>
          <span>{t("status.noModel")}</span> <Link to={PATHS.models}>{t("status.chooseModel")}</Link>
        </p>
      );
    case "downloading": {
      const progress = status.bytesTotal > 0 ? status.bytesDone / status.bytesTotal : 0;
      const label = t("status.downloading", { model: name(status.modelId), percent: Math.round(progress * 100) });
      return (
        <div className={styles.status}>
          <span>{label}</span>
          <LoadingSpinner progress={progress} label={label} />
        </div>
      );
    }
    case "loading":
      return (
        <p className={styles.status}>
          <LoadingSpinner size="small" decorative />
          <span role="status">{t("status.loading", { model: name(status.modelId) })}</span>
        </p>
      );
    case "ready":
      return (
        <p className={styles.status}>
          <span className={styles.ok} aria-hidden="true">
            ✓
          </span>
          <span>{t("status.ready", { model: name(status.modelId) })}</span>
        </p>
      );
    case "failed":
      return (
        <div className={styles.failed} role="alert">
          <p className={styles.reason}>{t(`failure.${status.reason}`)}</p>
          <div className={styles.actions}>
            {status.reason !== "unsupported" && (
              <Button variant="secondary" onClick={() => void retryLoad()}>
                {t("status.retry")}
              </Button>
            )}
            {status.modelId !== null && <Link to={PATHS.models}>{t("status.chooseModel")}</Link>}
            {showDetails && (
              <Button variant="secondary" onClick={() => setDetails(true)}>
                {t("status.details")}
              </Button>
            )}
          </div>
          {showDetails && (
            <Modal open={details} title={t("diag.title")} onClose={() => setDetails(false)}>
              {details && <DiagnosticsPanel />}
            </Modal>
          )}
        </div>
      );
  }
}
