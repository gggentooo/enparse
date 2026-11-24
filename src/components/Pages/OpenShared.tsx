/**
 * src/components/Pages/OpenShared.tsx — "Open a shared file" control (T99)
 *
 * Description:
 *   Opens a share file someone sent (made by ./ShareResult.tsx) and shows it
 *   on the output page. The file is read in the browser; nothing is uploaded.
 *   Unreadable files give a message and leave the shown result as it was.
 *
 * Layer: components/
 *
 * Dependencies:
 *   External: react, react-router (useNavigate).
 *   Internal: hooks/useParser.ts, hooks/useI18n.ts, paths.ts, ./OpenShared.module.css.
 *   Used by: ./InputPage.tsx, ./OutputPage.tsx.
 *
 * Status: implemented (T99). Tests: InputPage.test.tsx, OutputPage.test.tsx.
 */

import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "../../hooks/useI18n";
import { SHARE_MAX_FILE_BYTES, type ShareErrorReason, ShareFormatError, useParser } from "../../hooks/useParser";
import { PATHS } from "../../paths";
import styles from "./OpenShared.module.css";

export function OpenShared(): React.JSX.Element {
  const { t } = useI18n();
  const { openShared } = useParser();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShareErrorReason | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const open = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (file.size > SHARE_MAX_FILE_BYTES) throw new ShareFormatError("too-large", "file too large");
      await openShared({ kind: "file", content: await file.text() });
      // Without the link parameter: the output page shows what was just opened.
      await navigate(PATHS.output);
    } catch (e) {
      setError(e instanceof ShareFormatError ? e.reason : "invalid");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className={styles.open}>
      <div className={styles.row}>
        <label htmlFor={id}>{t("share.open")}</label>
        <input
          ref={fileRef}
          id={id}
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void open(file);
          }}
        />
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {t(`share.error.${error}`)}
        </p>
      )}
    </div>
  );
}
