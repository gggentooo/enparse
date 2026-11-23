/**
 * src/components/Pages/WordDetails.tsx — the selected word's details (OutputPage)
 *
 * Description:
 *   Word, base form (wink lemma), part of speech in the shown reading, word
 *   parts (prefix / base / suffix / ending with Korean glosses; useSubword),
 *   and "Add to list" (useVocab: the word with lemma, part of speech, and
 *   source sentence; creates a first list if there is none). The dictionary
 *   summary (T25 popup; T53): the first entry's Korean words and two
 *   definitions of the queried part of speech (./DictionaryEntry.tsx, compact),
 *   with "More in the dictionary" opening DictionaryPage for the word. A word
 *   of a phrasal verb ("looked" or "up" in "looked it up") is looked up as
 *   the phrasal verb ("look up"; token.phrasal from the parse). When the parse
 *   marks none, a verb directly followed by a particle (or a particle right
 *   after a verb) is tried as a phrasal verb first ("ran out" → run out) and
 *   shown together with the word's own entry (nearbyPhrase).
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   External: react, react-router (Link).
 *   Internal: hooks/useI18n.ts, hooks/useSubword.ts, hooks/useVocab.ts,
 *             hooks/useDictionary.ts, hooks/useParser.ts (types), Shared/Button.tsx,
 *             Shared/upos.ts, ./DictionaryEntry.tsx, ./DictionaryPage.tsx (dictionaryLink),
 *             Shared/LoadingSpinner.tsx, ./WordDetails.module.css.
 *   Used by: ./OutputPage.tsx.
 *
 * Status: implemented (T57; dictionary summary T53).
 */

import { useEffect, useId, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { AnnotatedToken } from "../../hooks/useParser";
import { Link } from "react-router";
import { PHRASAL_PARTICLES, useDictionary } from "../../hooks/useDictionary";
import { useSubword } from "../../hooks/useSubword";
import { useVocab } from "../../hooks/useVocab";
import { Button } from "../Shared/Button";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import { uposKey } from "../Shared/upos";
import { DictionaryEntry } from "./DictionaryEntry";
import { dictionaryLink } from "./DictionaryPage";
import styles from "./WordDetails.module.css";

export { uposKey } from "../Shared/upos";

export type WordDetailsProps = {
  token: AnnotatedToken;
  /** Part of speech in the reading shown (alternatives may change it). */
  upos: string;
  sentenceText: string;
  /** The words before and after it in the sentence (phrasal verbs the parse did not mark). */
  prev?: AnnotatedToken | null;
  next?: AnnotatedToken | null;
  onClose: () => void;
};

const lower = (t: AnnotatedToken): string => t.text.toLowerCase();

/**
 * A possible phrasal verb from neighbouring words when the parse marks none (UD treats "ran out
 * of" as a verb plus a preposition): a verb directly followed by a particle, or a particle
 * directly after a verb. The dictionary uses it only if it is a headword.
 */
export function nearbyPhrase(
  token: AnnotatedToken,
  upos: string,
  prev: AnnotatedToken | null | undefined,
  next: AnnotatedToken | null | undefined,
): { word: string; lemma: string } | null {
  const verbLemma = (v: AnnotatedToken): string => v.lemma ?? lower(v);
  if (upos === "VERB" && next && PHRASAL_PARTICLES.has(lower(next))) {
    return { word: `${token.text} ${next.text}`, lemma: `${verbLemma(token)} ${lower(next)}` };
  }
  if (PHRASAL_PARTICLES.has(lower(token)) && prev?.upos === "VERB") {
    return { word: `${prev.text} ${token.text}`, lemma: `${verbLemma(prev)} ${lower(token)}` };
  }
  return null;
}

export function WordDetails({ token, upos, sentenceText, prev, next, onClose }: WordDetailsProps): React.JSX.Element {
  const { t } = useI18n();
  const subword = useSubword();
  const vocab = useVocab();
  const [listId, setListId] = useState("");
  /** List the word was last added to, for the word it was added from. */
  const [added, setAdded] = useState<{ tokenId: string; list: string } | null>(null);
  const ids = { heading: useId(), list: useId() };
  const { segment } = subword;

  useEffect(() => {
    segment(token.text, token.lemma);
  }, [segment, token.text, token.lemma]);

  // Dictionary summary (T25: click → popup → "more" opens DictionaryPage; T53).
  const dictionary = useDictionary();
  const { lookup } = dictionary;
  // A word of a phrasal verb ("looked" or "up" in "looked it up") is looked up as the phrasal
  // verb ("look up"); the surface words are the verb and particle as written.
  const phrasal = token.phrasal;
  const qWord = phrasal ? phrasal.written : token.text;
  const qLemma = phrasal ? phrasal.text : token.lemma;
  const qUpos = phrasal ? "VERB" : upos;
  const nearby = phrasal ? null : nearbyPhrase(token, upos, prev, next);
  const nearWord = nearby?.word ?? null;
  const nearLemma = nearby?.lemma ?? null;
  useEffect(() => {
    lookup({
      word: qWord,
      lemma: qLemma,
      upos: qUpos,
      phrase: nearWord && nearLemma ? { word: nearWord, lemma: nearLemma } : null,
    });
  }, [lookup, qWord, qLemma, qUpos, nearWord, nearLemma]);
  const entries = dictionary.result?.entries ?? [];
  const first = entries[0];
  // A phrasal verb guessed from neighbouring words is shown with the word's own entry.
  const shown = first?.match === "phrase" ? entries.slice(0, 2) : entries.slice(0, 1);
  const more =
    first?.match === "phrase" && nearby
      ? dictionaryLink(nearby.word, nearby.lemma, "VERB")
      : dictionaryLink(qWord, qLemma, qUpos);

  const list = vocab.lists.find((l) => l.id === listId) ?? vocab.lists[0] ?? null;
  const key = uposKey(upos);
  const parts = subword.segmentation?.segments ?? [];

  const add = async (): Promise<void> => {
    try {
      const target = list ?? (await vocab.createList(t("output.defaultList")));
      await vocab.addItem(target.id, {
        word: token.text,
        lemma: token.lemma,
        upos,
        sourceSentence: sentenceText,
      });
      setAdded({ tokenId: token.id, list: target.name });
    } catch {
      // The vocab snapshot keeps the error; VocabPage shows it.
    }
  };

  return (
    <aside className={styles.details} aria-labelledby={ids.heading}>
      <div className={styles.head}>
        <h2 id={ids.heading} className={styles.title}>
          {t("output.wordDetails")}:{" "}
          {/* One unit: a long word moves to its own line after the colon instead of squeezing the button. */}
          <span lang="en" className={styles.word}>
            {token.text}
          </span>
        </h2>
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
      <dl className={styles.facts}>
        <dt>{t("output.lemma")}</dt>
        <dd lang="en">{token.lemma ?? token.text}</dd>
        <dt>{t("output.pos")}</dt>
        <dd>{key ? t(key) : upos}</dd>
        <dt>{t("output.parts")}</dt>
        <dd>
          {subword.isLoading && <LoadingSpinner size="small" />}
          {subword.error && <span className={styles.muted}>{t("output.partsError")}</span>}
          {!subword.isLoading && !subword.error && parts.length <= 1 && (
            <span className={styles.muted}>{t("output.partsNone")}</span>
          )}
          {parts.length > 1 && (
            <ol className={styles.parts}>
              {parts.map((p, i) => (
                <li key={`${p.kind}-${i}`}>
                  <span lang="en" className={styles.part}>
                    {p.kind === "prefix" ? `${p.text}-` : p.kind === "base" ? p.text : `-${p.text}`}
                  </span>{" "}
                  <span className={styles.muted}>
                    {t(`output.segment.${p.kind}`)}
                    {p.affix ? ` · ${p.affix.gloss}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </dd>
      </dl>
      <section className={styles.dictionary} aria-label={t("page.dictionary.title")}>
        {dictionary.isLoading && <LoadingSpinner size="small" label={t("dict.loading")} />}
        {dictionary.error && <p className={styles.muted}>{t(`dict.error.${dictionary.error}`)}</p>}
        {!dictionary.isLoading && !dictionary.error && dictionary.result?.entries.length === 0 && (
          <p className={styles.muted}>{t("dict.notFound", { word: qWord })}</p>
        )}
        {shown.map((e) => (
          <DictionaryEntry
            key={e.entry.key}
            entry={e.entry}
            match={e.match}
            word={e.match === "phrase" && nearby ? nearby.word : qWord}
            compact
          />
        ))}
        <Link to={more}>{t("dict.more")}</Link>
      </section>
      <div className={styles.add}>
        {vocab.lists.length > 1 && (
          <>
            <label htmlFor={ids.list}>{t("output.list")}</label>
            <select id={ids.list} value={list?.id ?? ""} onChange={(e) => setListId(e.target.value)}>
              {vocab.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </>
        )}
        <Button variant="secondary" onClick={() => void add()}>
          {t("output.addToList")}
        </Button>
      </div>
      {added?.tokenId === token.id && (
        <p role="status" className={styles.muted}>
          {t("output.added", { word: token.text, list: added.list })}
        </p>
      )}
    </aside>
  );
}
