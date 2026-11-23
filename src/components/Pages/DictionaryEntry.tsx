/**
 * src/components/Pages/DictionaryEntry.tsx — one dictionary entry (DictionaryPage, WordDetails)
 *
 * Description:
 *   Shows an entry from useDictionary (T46 data): the headword, how the query
 *   matched ("ran" → base form run), and per part of speech the Korean
 *   translations (under Wiktionary's sense labels) and the English
 *   definitions with examples; then English–Korean example sentences from
 *   Tatoeba (each linked to its sentence for attribution).
 *   Full mode (DictionaryPage): every part of speech; the first
 *   SENSES_SHOWN definitions with "show all". Compact mode (word panel,
 *   T25 popup): the first part of speech (the queried one) with its Korean
 *   words and COMPACT_SENSES definitions, no examples.
 *
 * Layer: components/ (page-specific UI of DictionaryPage and OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useDictionary.ts (types),
 *             Shared/upos.ts, ./DictionaryEntry.module.css.
 *   Used by: ./DictionaryPage.tsx, ./WordDetails.tsx.
 *
 * Status: implemented (T53). Tests: DictionaryPage.test.tsx, OutputPage.test.tsx.
 */

import { useId, useState } from "react";
import type { DictionaryEntry as Entry, MatchKind, PosGroup } from "../../hooks/useDictionary";
import { useI18n } from "../../hooks/useI18n";
import { uposKey } from "../Shared/upos";
import styles from "./DictionaryEntry.module.css";

/** Definitions shown per part of speech before "show all" (full mode). */
export const SENSES_SHOWN = 5;
/** Definitions shown in the compact view. */
export const COMPACT_SENSES = 2;

const TATOEBA_SENTENCE = "https://tatoeba.org/en/sentences/show/";

function PosSection({ group, compact }: { group: PosGroup; compact: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const headingId = useId();
  const key = uposKey(group.upos);
  const limit = compact ? COMPACT_SENSES : all ? group.senses.length : SENSES_SHOWN;
  const senses = group.senses.slice(0, limit);
  const korean = group.korean.filter((k) => k.words.length > 0);
  return (
    <section className={styles.pos} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.posName}>
        {key ? t(key) : group.upos}
      </h3>
      {korean.length > 0 ? (
        <ul className={styles.korean} aria-label={t("dict.korean")}>
          {(compact ? korean.slice(0, 2) : korean).map((k) => (
            <li key={k.sense}>
              <span lang="ko" className={styles.koWords}>
                {k.words.join(", ")}
              </span>
              {k.sense && !compact && (
                <span lang="en" className={styles.muted}>
                  {" "}
                  — {k.sense}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !compact && <p className={styles.muted}>{t("dict.koreanNone")}</p>
      )}
      {senses.length > 0 && (
        <ol className={styles.senses} aria-label={t("dict.definitions")}>
          {senses.map((s, i) => (
            <li key={`${i}-${s.definition}`}>
              <span lang="en">{s.definition}</span>
              {!compact &&
                s.examples.map((x) => (
                  <q key={x} lang="en" className={styles.senseExample}>
                    {x}
                  </q>
                ))}
            </li>
          ))}
        </ol>
      )}
      {!compact && group.senses.length > SENSES_SHOWN && (
        <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? t("dict.showFewer") : t("dict.showAll", { count: group.senses.length })}
        </button>
      )}
      {!compact && group.from && <p className={styles.source}>{t(`dict.source.${group.from}`)}</p>}
    </section>
  );
}

export type DictionaryEntryProps = {
  entry: Entry;
  match: MatchKind;
  /** The word as typed or clicked (for "ran → run"). */
  word: string;
  compact?: boolean;
  /** Extra content under the headword (e.g. "Add to list"). */
  actions?: React.ReactNode;
};

export function DictionaryEntry({
  entry,
  match,
  word,
  compact = false,
  actions,
}: DictionaryEntryProps): React.JSX.Element {
  const { t } = useI18n();
  const headingId = useId();
  const groups = compact ? entry.pos.slice(0, 1) : entry.pos;
  const viaForm = match !== "headword" && word.trim().toLowerCase() !== entry.headword.toLowerCase();
  return (
    <article className={compact ? styles.compact : styles.entry} aria-labelledby={headingId}>
      <header className={styles.head}>
        {compact ? (
          <h3 id={headingId} lang="en" className={styles.headword}>
            {entry.headword}
          </h3>
        ) : (
          <h2 id={headingId} lang="en" className={styles.headword}>
            {entry.headword}
          </h2>
        )}
        {viaForm && <p className={styles.muted}>{t("dict.formOf", { word, headword: entry.headword })}</p>}
        {actions}
      </header>
      {groups.map((g) => (
        <PosSection key={g.upos} group={g} compact={compact} />
      ))}
      {!compact && entry.examples.length > 0 && (
        <section className={styles.examples} aria-label={t("dict.examples")}>
          <h3 className={styles.posName}>{t("dict.examples")}</h3>
          <ul>
            {entry.examples.map((x) => (
              <li key={x.tatoeba.join("-")}>
                <span lang="en">{x.en}</span>
                <span lang="ko" className={styles.muted}>
                  {x.ko}
                </span>
                <a
                  className={styles.source}
                  href={`${TATOEBA_SENTENCE}${x.tatoeba[0]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tatoeba #{x.tatoeba[0]}
                  <span className="visually-hidden"> {t("common.opensNewTab")}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
