/**
 * src/components/Pages/SentenceView.tsx — one parsed sentence with its readings (OutputPage)
 *
 * Description:
 *   Shows the selected reading of a sentence in the flat or nested view; the
 *   nested view starts each sentence with a "Sentence N" header and a rule (T84). A
 *   sentence with alternatives gets an "Other readings (n)" disclosure with a
 *   radio group: most likely (primary) and each alternative with its share
 *   and reason; choosing one switches the whole sentence view (T11). Each
 *   reading lists, in plain words from fixed templates, what it says where
 *   the readings differ. Near-tie (top reading below 60%; T83): a note says
 *   the readings are about equally likely, the list is open from the start,
 *   and the readings are named A, B, … instead of ranked.
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useParser.ts (types), ./FlatReading.tsx,
 *             ./NestedReading.tsx, ./SentenceView.module.css.
 *   Used by: ./OutputPage.tsx.
 *
 * Status: implemented (T57).
 */

import { useId, useState } from "react";
import { type MessageKey, useI18n } from "../../hooks/useI18n";
import type { AnnotatedSentence, AnnotatedToken, ReadingNote } from "../../hooks/useParser";
import { FlatReading } from "./FlatReading";
import { type NestedLook, NestedReading } from "./NestedReading";
import styles from "./SentenceView.module.css";
import { uposKey } from "../Shared/upos";

export type SentenceViewProps = {
  sentence: AnnotatedSentence;
  /** 1-based number for labels. */
  number: number;
  view: "flat" | "nested";
  /** Shape and labels of the nested view. */
  look: NestedLook;
  selectedId: string | null;
  onSelect: (token: AnnotatedToken, sentence: AnnotatedSentence, readingRank: number) => void;
};

export function SentenceView({
  sentence,
  number,
  view,
  look,
  selectedId,
  onSelect,
}: SentenceViewProps): React.JSX.Element {
  const { t, formatNumber } = useI18n();
  const [rank, setRank] = useState(0);
  // A near-tie shows its readings from the start (T83).
  const [open, setOpen] = useState(sentence.nearTie);
  const name = useId();
  const reading = sentence.readings.find((r) => r.rank === rank) ?? sentence.readings[0];
  const alternatives = sentence.readings.length - 1;
  if (!reading) return <></>;
  const props = {
    sentence,
    reading,
    selectedId,
    onSelect: (tok: AnnotatedToken) => onSelect(tok, sentence, reading.rank),
  };
  const pct = (p: number): string => formatNumber(p * 100, 0);

  const letter = (r: number): string => String.fromCharCode(65 + r);
  const note = (n: ReadingNote): string =>
    n.kind === "attach"
      ? t(`output.note.attach.${n.headKind}`, { phrase: n.phrase, head: n.head })
      : t("output.note.label", { word: n.word, pos: uposKey(n.upos) ? t(uposKey(n.upos) as MessageKey) : n.upos });

  return (
    <article className={styles.sentence} aria-label={t("output.sentence", { n: number })}>
      {view === "nested" && (
        <h2 className={styles.header} aria-hidden="true">
          {t("output.sentence", { n: number })}
        </h2>
      )}
      {sentence.nearTie && (
        <p role="note" className={styles.nearTie}>
          {t("output.nearTie")}
        </p>
      )}
      {view === "nested" && reading.nodes ? <NestedReading {...props} look={look} /> : <FlatReading {...props} />}
      {sentence.otherReadingsOmitted && (
        <p role="note" className={styles.omitted}>
          {t("share.otherReadings")}
        </p>
      )}
      {alternatives > 0 && (
        <details className={styles.readings} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            {sentence.nearTie
              ? t("output.compareReadings", { count: sentence.readings.length })
              : t("output.otherReadings", { count: alternatives })}
          </summary>
          <fieldset className={styles.choices}>
            <legend className="visually-hidden">{t("output.readingsLabel", { n: number })}</legend>
            {sentence.readings.map((r) => (
              <div key={r.id} className={styles.option}>
                <label className={styles.choice}>
                  <input type="radio" name={name} checked={r.rank === rank} onChange={() => setRank(r.rank)} />
                  {sentence.nearTie
                    ? t("output.readingLetter", { letter: letter(r.rank), percent: pct(r.probability) })
                    : r.rank === 0
                      ? t("output.mostLikely", { percent: pct(r.probability) })
                      : t("output.reading", {
                          rank: r.rank + 1,
                          percent: pct(r.probability),
                          reason: t(
                            r.reason === "attachment" ? "output.reason.attachment" : "output.reason.probability",
                          ),
                        })}
                </label>
                {r.notes.length > 0 && (
                  <ul className={styles.notes}>
                    {r.notes.map((n) => (
                      <li key={JSON.stringify(n)}>{note(n)}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </fieldset>
        </details>
      )}
    </article>
  );
}
