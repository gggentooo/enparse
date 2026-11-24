/**
 * src/components/Pages/WordStats.tsx — vocabulary statistics of the shown text (T105)
 *
 * Description:
 *   "Vocabulary statistics" button on the output page. Opens a tall dialog
 *   (Shared/Modal, T104) listing every word of the text (useParser().words;
 *   rules T100) with its part of speech, a short Korean meaning from the
 *   in-app dictionary (useWordGlosses; T102), and how many times it is used. The
 *   sort dropdown (frequency, alphabetical, part of speech) and Close sit in
 *   the top bar, which stays in place while the table scrolls.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Words and counts at once; meanings load after the dialog opens (once
 *      per text) with a spinner; failed parts leave the cells empty with a note.
 *   2. Table semantics: column headers, aria-sort on the sorted column,
 *      English words marked lang="en".
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, hooks/useWordGlosses.ts,
 *             hooks/useI18n.ts, Shared/Modal.tsx, Shared/Button.tsx,
 *             Shared/LoadingSpinner.tsx, Shared/upos.ts, ./WordStats.module.css.
 *   Used by: ./OutputPage.tsx.
 *
 * Status: implemented (T105). Tests: OutputPage.test.tsx.
 */

import { useId, useMemo, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import { type WordSort, sortWords, useParser } from "../../hooks/useParser";
import { useWordGlosses } from "../../hooks/useWordGlosses";
import { Button } from "../Shared/Button";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import { Modal } from "../Shared/Modal";
import { uposKey } from "../Shared/upos";
import styles from "./WordStats.module.css";

const SORTS: readonly WordSort[] = ["frequency", "alpha", "pos"];

export function WordStats(): React.JSX.Element | null {
  const { t, formatNumber } = useI18n();
  const { words } = useParser();
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<WordSort>("frequency");
  const sortId = useId();
  const glosses = useWordGlosses(words, open);
  const sorted = useMemo(() => (words ? sortWords(words, sort) : []), [words, sort]);
  if (!words) return null;

  const running = words.reduce((n, w) => n + w.count, 0);
  const ariaSort = (col: WordSort): "ascending" | "descending" | undefined =>
    sort === col ? (col === "frequency" ? "descending" : "ascending") : undefined;
  const posLabel = (upos: string): string => {
    const k = uposKey(upos);
    return k ? t(k) : upos;
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("words.stats.button")}
      </Button>
      <Modal
        open={open}
        variant="tall"
        title={t("words.stats.title")}
        onClose={() => setOpen(false)}
        toolbar={
          <>
            <label htmlFor={sortId}>{t("words.sort")}</label>
            <select id={sortId} value={sort} onChange={(e) => setSort(e.target.value as WordSort)}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`words.sort.${s}`)}
                </option>
              ))}
            </select>
          </>
        }
      >
        {words.length === 0 ? (
          <p>{t("words.empty")}</p>
        ) : (
          <>
            <p className={styles.totals}>
              {t("words.totals", { distinct: formatNumber(words.length, 0), running: formatNumber(running, 0) })}
            </p>
            {glosses.isLoading && (
              <LoadingSpinner size="small" label={t("words.loading")} progress={glosses.progress} />
            )}
            {glosses.error && (
              <p role="status" className={styles.note}>
                {t("words.glossError")} {t(`dict.error.${glosses.error}`)}
              </p>
            )}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" aria-sort={ariaSort("alpha")}>
                    {t("words.col.word")}
                  </th>
                  <th scope="col" aria-sort={ariaSort("pos")}>
                    {t("words.col.pos")}
                  </th>
                  <th scope="col">{t("words.col.meaning")}</th>
                  <th scope="col" aria-sort={ariaSort("frequency")} className={styles.count}>
                    {t("words.col.count")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((w) => (
                  <tr key={w.key}>
                    <th scope="row" lang="en" className={styles.word}>
                      {w.word}
                    </th>
                    <td>{posLabel(w.upos)}</td>
                    <td>{glosses.glosses?.get(w.key)?.ko ?? ""}</td>
                    <td className={styles.count}>{formatNumber(w.count, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Modal>
    </>
  );
}
