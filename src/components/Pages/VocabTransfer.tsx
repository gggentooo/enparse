/**
 * src/components/Pages/VocabTransfer.tsx — export and import of vocabulary lists (VocabPage)
 *
 * Description:
 *   Exports all lists as JSON (canonical) or CSV and downloads the file;
 *   imports a JSON or CSV file. When an imported list has the name of an
 *   existing list, a Modal asks: merge, import as a new list, or skip (T27).
 *   Shows the import summary.
 *
 * Layer: components/ (page-specific UI of VocabPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useVocab.ts (types), Shared/Button.tsx,
 *             Shared/Modal.tsx, ./VocabTransfer.module.css.
 *   Used by: ./VocabPage.tsx.
 *
 * Status: implemented (T48).
 */

import { useId, useRef, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { ImportSummary, NameConflictChoice, UseVocab, VocabList } from "../../hooks/useVocab";
import { Button } from "../Shared/Button";
import { Modal } from "../Shared/Modal";
import styles from "./VocabTransfer.module.css";

export type VocabTransferProps = {
  hasLists: boolean;
  exportLists: UseVocab["exportLists"];
  importLists: UseVocab["importLists"];
};

/** Export file name, e.g. enparse-vocab-2026-11-21.json (local date). */
export function exportFileName(format: "json" | "csv", now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `enparse-vocab-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${format}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoke after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Conflict = { name: string; resolve: (choice: NameConflictChoice) => void };

export function VocabTransfer({ hasLists, exportLists, importLists }: VocabTransferProps): React.JSX.Element {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"json" | "csv" | "import" | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const fileId = useId();

  const runExport = (format: "json" | "csv"): void => {
    setBusy(format);
    exportLists(format)
      .then((blob) => download(blob, exportFileName(format)))
      .catch(() => undefined) // the error is shown from the vocab snapshot
      .finally(() => setBusy(null));
  };

  const askConflict = (existing: VocabList): Promise<NameConflictChoice> =>
    new Promise((resolve) => setConflict({ name: existing.name, resolve }));
  const answer = (choice: NameConflictChoice): void => {
    conflict?.resolve(choice);
    setConflict(null);
  };

  return (
    <section className={styles.transfer} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {t("vocab.transfer")}
      </h2>
      <p className={styles.hint}>{t("vocab.transferHint")}</p>
      <div className={styles.row}>
        <Button variant="secondary" disabled={!hasLists} isLoading={busy === "json"} onClick={() => runExport("json")}>
          {t("vocab.exportJson")}
        </Button>
        <Button variant="secondary" disabled={!hasLists} isLoading={busy === "csv"} onClick={() => runExport("csv")}>
          {t("vocab.exportCsv")}
        </Button>
      </div>
      <div className={styles.row}>
        <label htmlFor={fileId}>{t("vocab.importFile")}</label>
        <input
          ref={fileRef}
          id={fileId}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          disabled={busy === "import"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy("import");
            setSummary(null);
            importLists(file, askConflict)
              .then(setSummary)
              .catch(() => undefined) // shown from the vocab snapshot
              .finally(() => {
                setBusy(null);
                if (fileRef.current) fileRef.current.value = "";
              });
          }}
        />
      </div>
      {summary && (
        <p role="status" className={styles.summary}>
          {t("vocab.importSummary", { ...summary })}
        </p>
      )}

      <Modal
        open={conflict !== null}
        title={t("vocab.conflictTitle", { name: conflict?.name ?? "" })}
        onClose={() => answer("skip")}
        actions={
          <>
            <Button onClick={() => answer("merge")}>{t("vocab.merge")}</Button>
            <Button variant="secondary" onClick={() => answer("rename")}>
              {t("vocab.importAsNew")}
            </Button>
            <Button variant="secondary" onClick={() => answer("skip")}>
              {t("vocab.skip")}
            </Button>
          </>
        }
      >
        <p>{t("vocab.conflictBody")}</p>
      </Modal>
    </section>
  );
}
