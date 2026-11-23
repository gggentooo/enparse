/**
 * src/components/Pages/DictionaryOffline.tsx — "Make dictionary available offline" (ModelsPage)
 *
 * Description:
 *   The opt-in offline download of the dictionary (owner decisions T15, T42;
 *   T72), next to the model downloads: what is stored (none / partly / all,
 *   with sizes), the download button with its size, byte progress with
 *   cancel, and delete (with confirmation). Pre-flight storage check (T24):
 *   the button is disabled with an explanation when the rest cannot fit,
 *   and a warning is shown when storage is tight. Errors by reason.
 *   Nothing downloads without the user (lookups store only the files they
 *   need).
 *
 * Layer: components/ (page-specific UI of ModelsPage)
 *
 * Dependencies:
 *   Internal: hooks/useDictionary.ts (useDictionaryOffline), hooks/useI18n.ts,
 *             Shared/Button.tsx, Shared/LoadingSpinner.tsx, Shared/Modal.tsx,
 *             ./DictionaryOffline.module.css.
 *   Used by: ./ModelsPage.tsx.
 *
 * Status: implemented (T72). Tests: ModelsPage.test.tsx.
 */

import { useId, useState } from "react";
import { useDictionaryOffline } from "../../hooks/useDictionary";
import { useI18n } from "../../hooks/useI18n";
import { Button } from "../Shared/Button";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import { Modal } from "../Shared/Modal";
import styles from "./DictionaryOffline.module.css";

export function DictionaryOffline(): React.JSX.Element {
  const { t, formatBytes } = useI18n();
  const d = useDictionaryOffline();
  const [confirm, setConfirm] = useState(false);
  const headingId = useId();
  const offline = d.offline;
  const remaining = offline ? offline.totalBytes - offline.cachedBytes : 0;
  const noSpace = d.fit?.verdict === "no-space";

  let state: string | null = null;
  if (offline?.state === "none") state = t("dictOffline.state.none", { size: formatBytes(offline.totalBytes) });
  if (offline?.state === "partial") {
    state = t("dictOffline.state.partial", {
      done: formatBytes(offline.cachedBytes),
      total: formatBytes(offline.totalBytes),
    });
  }
  if (offline?.state === "complete") state = t("dictOffline.state.complete", { size: formatBytes(offline.totalBytes) });

  return (
    <section className={styles.box} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        {t("dictOffline.title")}
      </h2>
      <p className={styles.text}>{t("dictOffline.intro")}</p>
      {!offline && !d.error && <LoadingSpinner size="small" label={t("dict.loading")} />}
      {state && <p className={styles.text}>{state}</p>}

      {d.download ? (
        <div className={styles.progress}>
          <span>
            {t("dictOffline.downloading", {
              done: formatBytes(d.download.bytesDone),
              total: formatBytes(d.download.bytesTotal),
            })}
          </span>
          <LoadingSpinner
            progress={d.download.bytesTotal > 0 ? d.download.bytesDone / d.download.bytesTotal : 0}
            label={t("dictOffline.progressLabel")}
          />
          <Button variant="secondary" onClick={d.cancelDownload}>
            {t("dictOffline.cancel")}
          </Button>
        </div>
      ) : (
        offline && (
          <div className={styles.actions}>
            {offline.state !== "complete" && (
              <Button onClick={d.downloadAll} disabled={noSpace}>
                {t("dictOffline.download", { size: formatBytes(remaining) })}
              </Button>
            )}
            {offline.state !== "none" && (
              <Button variant="secondary" onClick={() => setConfirm(true)}>
                {t("dictOffline.delete")}
              </Button>
            )}
          </div>
        )
      )}

      {offline?.state !== "complete" && d.fit && d.fit.freeBytes !== null && noSpace && (
        <p className={styles.problem}>
          {t("dictOffline.noSpace", { need: formatBytes(d.fit.needBytes), free: formatBytes(d.fit.freeBytes) })}
        </p>
      )}
      {offline?.state !== "complete" && d.fit?.verdict === "tight" && d.fit.freeBytes !== null && (
        <p className={styles.text}>{t("dictOffline.tight", { free: formatBytes(d.fit.freeBytes) })}</p>
      )}
      {d.error && (
        <p role="alert" className={styles.problem}>
          {t(`dict.error.${d.error}`)}
        </p>
      )}

      <Modal
        open={confirm}
        title={t("dictOffline.deleteTitle")}
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
                d.deleteAll();
              }}
            >
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("dictOffline.deleteBody", { size: formatBytes(offline?.cachedBytes ?? 0) })}</p>
      </Modal>
    </section>
  );
}
