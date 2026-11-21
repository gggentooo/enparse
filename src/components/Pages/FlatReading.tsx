/**
 * src/components/Pages/FlatReading.tsx — flat chunk view of one reading (OutputPage)
 *
 * Description:
 *   Color-coded chunk highlights with the chunk type always shown as text
 *   (T20); words outside chunks are plain. Each chunk is a labeled group for
 *   screen readers ("명사구 (NP)").
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useParser.ts (types), ./OutputWord.tsx,
 *             ./FlatReading.module.css.
 *   Used by: ./SentenceView.tsx.
 *
 * Status: implemented (T57).
 */

import { Fragment } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { AnnotatedSentence, AnnotatedToken, Reading } from "../../hooks/useParser";
import styles from "./FlatReading.module.css";
import { OutputWord } from "./OutputWord";

export type ReadingViewProps = {
  sentence: AnnotatedSentence;
  reading: Reading;
  selectedId: string | null;
  onSelect: (token: AnnotatedToken) => void;
};

/** Words start..end (inclusive) with the spaces from the input between them. */
export function Words({
  sentence,
  reading,
  start,
  end,
  selectedId,
  onSelect,
}: ReadingViewProps & { start: number; end: number }): React.JSX.Element {
  return (
    <>
      {sentence.tokens.slice(start, end + 1).map((tok, i, all) => (
        <Fragment key={tok.id}>
          <OutputWord
            token={tok}
            selected={tok.id === selectedId}
            changed={tok.index in reading.changes}
            markAmbiguous={reading.rank === 0}
            onSelect={onSelect}
          />
          {tok.spaceAfter && i < all.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

export function FlatReading(props: ReadingViewProps): React.JSX.Element {
  const { t } = useI18n();
  const { sentence, reading } = props;
  return (
    <p className={styles.flat}>
      {reading.segments.map((seg) => {
        const last = sentence.tokens[seg.end];
        const space = last?.spaceAfter ? " " : null;
        if (seg.type === null) {
          return (
            <Fragment key={seg.id}>
              <Words {...props} start={seg.start} end={seg.end} />
              {space}
            </Fragment>
          );
        }
        return (
          <Fragment key={seg.id}>
            <span role="group" aria-label={t(`grammar.${seg.type}`)} className={`${styles.chunk} ${styles[seg.type]}`}>
              <span className={styles.tag} aria-hidden="true">
                {seg.type}
              </span>
              <Words {...props} start={seg.start} end={seg.end} />
            </span>
            {space}
          </Fragment>
        );
      })}
    </p>
  );
}
