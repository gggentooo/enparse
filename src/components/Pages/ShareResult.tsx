/**
 * src/components/Pages/ShareResult.tsx — "Share" control of the output page (T99)
 *
 * Description:
 *   Shares the shown result so someone else can read it without a model.
 *   One sentence shorter than 128 characters becomes a link (copied to the
 *   clipboard and shown); anything else becomes a file (handed to the
 *   system share sheet where it takes files, else downloaded). The rule is
 *   the service's (shareKind). Nothing is uploaded.
 *
 * Layer: components/
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, hooks/useI18n.ts, paths.ts, Shared/Button.tsx,
 *             ./ShareResult.module.css.
 *   Used by: ./OutputPage.tsx.
 *
 * Status: implemented (T99). Tests: OutputPage.test.tsx.
 */

import { useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { SHARE_LINK_MAX_CHARS, useParser } from "../../hooks/useParser";
import { PATHS, SHARE_PARAM } from "../../paths";
import { Button } from "../Shared/Button";
import styles from "./ShareResult.module.css";

type Outcome =
  | { kind: "link"; url: string; copied: boolean }
  | { kind: "file"; name: string; handedOver: boolean }
  | { kind: "error"; message: string };

/** Share file name, e.g. enparse-share-2026-11-24.json (local date). */
export function shareFileName(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `enparse-share-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** The link that opens a shared result on this site: the data sits after the "#", so it is never sent to a server. */
export function shareUrl(data: string, base: string = window.location.href): string {
  const url = new URL(base);
  url.search = "";
  url.hash = `${PATHS.output}?${SHARE_PARAM}=${data}`;
  return url.toString();
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  // Revoke after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // no permission or no clipboard: the link is shown to copy by hand
  }
}

/** Hand the file to the system share sheet where it takes files; false = not available (download instead). */
async function handOver(file: File): Promise<boolean> {
  const data = { files: [file] };
  if (typeof navigator.share !== "function" || !navigator.canShare?.(data)) return false;
  try {
    await navigator.share(data);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) return false;
    // Closed by the user: nothing more to do.
  }
  return true;
}

export function ShareResult(): React.JSX.Element | null {
  const { t } = useI18n();
  const { shareKind, shareLink, shareFile } = useParser();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const hintId = useId();
  const linkId = useId();
  if (!shareKind) return null;

  const share = async (): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    try {
      if (shareKind === "link") {
        const url = shareUrl(await shareLink());
        setOutcome({ kind: "link", url, copied: await copy(url) });
      } else {
        const file = new File([shareFile()], shareFileName(), { type: "application/json" });
        const handedOver = await handOver(file);
        if (!handedOver) download(file);
        setOutcome({ kind: "file", name: file.name, handedOver });
      }
    } catch (e) {
      setOutcome({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.share}>
      <div className={styles.row}>
        <Button variant="secondary" isLoading={busy} aria-describedby={hintId} onClick={() => void share()}>
          {t("share.button")}
        </Button>
        <p id={hintId} className={styles.hint}>
          {shareKind === "link" ? t("share.hint.link") : t("share.hint.file", { max: SHARE_LINK_MAX_CHARS })}
        </p>
      </div>
      {outcome?.kind === "link" && (
        <div role="status" className={styles.result}>
          <label htmlFor={linkId}>{outcome.copied ? t("share.linkCopied") : t("share.linkReady")}</label>
          <input
            id={linkId}
            className={styles.link}
            type="text"
            readOnly
            value={outcome.url}
            aria-label={t("share.linkLabel")}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
      {outcome?.kind === "file" && (
        <p role="status" className={styles.result}>
          {outcome.handedOver ? t("share.fileShared") : t("share.fileSaved", { name: outcome.name })}
        </p>
      )}
      {outcome?.kind === "error" && (
        <p role="alert" className={styles.error}>
          {t("share.failed", { message: outcome.message })}
        </p>
      )}
    </div>
  );
}
