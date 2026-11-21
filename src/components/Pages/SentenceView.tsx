/**
 * src/components/Pages/SentenceView.tsx — one parsed sentence with its readings (OutputPage)
 *
 * Description:
 *   Shows the selected reading of a sentence in the flat or nested view. A
 *   sentence with alternatives gets an "Other readings (n)" disclosure with a
 *   radio group: most likely (primary) and each alternative with its share
 *   and reason; choosing one switches the whole sentence view (T11).
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
import { useI18n } from "../../hooks/useI18n";
import type { AnnotatedSentence, AnnotatedToken } from "../../hooks/useParser";
import { FlatReading } from "./FlatReading";
import { NestedReading } from "./NestedReading";
import styles from "./SentenceView.module.css";

export type SentenceViewProps = {
  sentence: AnnotatedSentence;
  /** 1-based number for labels. */
  number: number;
  view: "flat" | "nested";
  selectedId: string | null;
  onSelect: (token: AnnotatedToken, sentence: AnnotatedSentence, readingRank: number) => void;
};

export function SentenceView({ sentence, number, view, selectedId, onSelect }: SentenceViewProps): React.JSX.Element {
  const { t, formatNumber } = useI18n();
  const [rank, setRank] = useState(0);
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

  return (
    <article className={styles.sentence} aria-label={t("output.sentence", { n: number })}>
      {view === "nested" && reading.nodes ? <NestedReading {...props} /> : <FlatReading {...props} />}
      {alternatives > 0 && (
        <details className={styles.readings} open={rank !== 0 || undefined}>
          <summary>{t("output.otherReadings", { count: alternatives })}</summary>
          <fieldset className={styles.choices}>
            <legend className="visually-hidden">{t("output.readingsLabel", { n: number })}</legend>
            {sentence.readings.map((r) => (
              <label key={r.id} className={styles.choice}>
                <input type="radio" name={name} checked={r.rank === rank} onChange={() => setRank(r.rank)} />
                {r.rank === 0
                  ? t("output.mostLikely", { percent: pct(r.probability) })
                  : t("output.reading", {
                      rank: r.rank + 1,
                      percent: pct(r.probability),
                      reason: t(r.reason === "attachment" ? "output.reason.attachment" : "output.reason.probability"),
                    })}
              </label>
            ))}
          </fieldset>
        </details>
      )}
    </article>
  );
}
