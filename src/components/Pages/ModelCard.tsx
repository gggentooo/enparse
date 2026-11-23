/**
 * src/components/Pages/ModelCard.tsx — one model in the model library (ModelsPage)
 *
 * Description:
 *   A model card (T22): name, labels ("Most accurate", "Fastest on this
 *   device", recommended, in use), device fit with reasons, download state
 *   with progress, actions (use, download only, cancel, delete with
 *   confirmation), and numbers behind a "Details" disclosure (accuracy,
 *   size, expected speed, structure view, license, base model; T21).
 *
 * Layer: components/ (page-specific UI of ModelsPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useModelLibrary.ts (types),
 *             Shared/Button.tsx, Shared/LoadingSpinner.tsx, Shared/Modal.tsx,
 *             Shared/checkText.ts, ./ModelCard.module.css.
 *   Used by: ./ModelsPage.tsx.
 *
 * Status: implemented (T54).
 */

import { useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { LibraryModel } from "../../hooks/useModelLibrary";
import { Button } from "../Shared/Button";
import { checkHintKey, checkNameKey } from "../Shared/checkText";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import { Modal } from "../Shared/Modal";
import styles from "./ModelCard.module.css";

export type ModelCardProps = {
  model: LibraryModel;
  /** This model is being prepared (loaded) right now. */
  preparing: boolean;
  onUse: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

export function ModelCard({
  model,
  preparing,
  onUse,
  onDownload,
  onCancel,
  onDelete,
}: ModelCardProps): React.JSX.Element {
  const { t, lang, formatBytes, formatNumber } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const headingId = useId();
  const { entry, state, fitness } = model;
  const name = entry.display_name;
  const blocked = fitness?.verdict === "blocked";
  const pct = (v: number): string => `${formatNumber(v * 100)}%`;
  const size = model.downloadBytes === null ? t("models.unknown") : formatBytes(model.downloadBytes);
  const reasons = (fitness?.reasons ?? []).filter((r) => r.status === "fail" || r.status === "warn");
  const expected = fitness?.expectedParseSeconds ?? null;
  const downloaded = state.state === "downloaded";

  return (
    <li className={`${styles.card} ${model.recommended ? styles.recommended : ""}`} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.name}>
          {name}
        </h2>
        <ul className={styles.badges}>
          {model.active && <li className={styles.active}>{t("models.active")}</li>}
          {model.recommended && <li className={styles.rec}>{t("models.recommended")}</li>}
          {model.badges.map((b) => (
            <li key={b}>{t(`models.badge.${b}`)}</li>
          ))}
        </ul>
      </div>
      {lang === "ko" && entry.description_ko ? (
        <p className={styles.description} lang="ko">
          {entry.description_ko}
        </p>
      ) : (
        <p className={styles.description} lang="en">
          {entry.description}
        </p>
      )}

      {fitness && fitness.verdict !== "ok" && (
        <div className={blocked ? styles.blocked : styles.warn}>
          <p className={styles.fit}>{t(blocked ? "models.fit.blocked" : "models.fit.warn")}</p>
          {reasons.length > 0 && (
            <ul className={styles.reasons} aria-label={t("models.reasons")}>
              {reasons.map((r) => (
                <li key={r.id}>
                  {t(checkNameKey(r.id))}: {t(checkHintKey(r.id))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.state}>
        {state.state === "downloading" ? (
          <>
            <span>
              {t("models.state.downloading", {
                done: formatBytes(state.bytesDone),
                total: formatBytes(state.bytesTotal),
              })}
            </span>
            <LoadingSpinner
              progress={state.bytesTotal > 0 ? state.bytesDone / state.bytesTotal : 0}
              label={t("models.progressLabel", { model: name })}
            />
          </>
        ) : downloaded ? (
          <span>{t("models.state.downloaded", { size: formatBytes(state.bytesOnDisk) })}</span>
        ) : state.state === "corrupted" ? (
          <span className={styles.problem}>{t("models.state.corrupted")}</span>
        ) : (
          <span>{t("models.state.notDownloaded", { size })}</span>
        )}
        {preparing && <LoadingSpinner size="small" label={t("status.loading", { model: name })} />}
      </div>

      <div className={styles.actions}>
        {!model.active && (
          <Button disabled={blocked || state.state === "downloading" || preparing} onClick={onUse}>
            {t("models.use")}
          </Button>
        )}
        {!downloaded && state.state !== "downloading" && !blocked && (
          <Button variant="secondary" onClick={onDownload}>
            {t("models.download")}
          </Button>
        )}
        {state.state === "downloading" && (
          <Button variant="secondary" onClick={onCancel}>
            {t("models.cancel")}
          </Button>
        )}
        {downloaded && (
          <Button
            variant="danger"
            aria-label={t("models.deleteModel", { model: name })}
            onClick={() => setConfirm(true)}
          >
            {t("common.delete")}
          </Button>
        )}
      </div>

      <details className={styles.details}>
        <summary>{t("models.details")}</summary>
        <dl className={styles.metrics}>
          <dt>{t("models.metric.chunkF1")}</dt>
          <dd>{pct(entry.metrics.chunk_f1)}</dd>
          <dt>{t("models.metric.upos")}</dt>
          <dd>{pct(entry.metrics.upos)}</dd>
          <dt>{t("models.metric.structure")}</dt>
          <dd>
            {pct(entry.metrics.uas)} / {pct(entry.metrics.las)}
          </dd>
          <dt>{t("models.metric.size")}</dt>
          <dd>{size}</dd>
          <dt>{t("models.metric.speed")}</dt>
          <dd>{expected === null ? t("models.unknown") : t("models.seconds", { n: formatNumber(expected) })}</dd>
          <dt>{t("models.metric.nested")}</dt>
          <dd>{t(entry.nested_view ? "models.available" : "models.notAvailable")}</dd>
          <dt>{t("models.metric.license")}</dt>
          <dd>{entry.license}</dd>
          <dt>{t("models.metric.base")}</dt>
          <dd lang="en">{entry.base_model}</dd>
        </dl>
      </details>

      <Modal
        open={confirm}
        title={t("models.deleteTitle", { model: name })}
        onClose={() => setConfirm(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirm(false);
                onDelete();
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("models.deleteBody", { size: downloaded ? formatBytes(state.bytesOnDisk) : size })}</p>
        {model.active && <p>{t("models.deleteActive")}</p>}
      </Modal>
    </li>
  );
}
