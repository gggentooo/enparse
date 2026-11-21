/**
 * src/components/Pages/WordDetails.tsx — the selected word's details (OutputPage)
 *
 * Description:
 *   Word, base form (wink lemma), part of speech in the shown reading, word
 *   parts (prefix / base / suffix / ending with Korean glosses; useSubword),
 *   and "Add to list" (useVocab: the word with lemma, part of speech, and
 *   source sentence; creates a first list if there is none). Dictionary
 *   entries follow with the dictionary (TODO(T53)).
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useSubword.ts, hooks/useVocab.ts,
 *             hooks/useParser.ts (types), Shared/Button.tsx,
 *             Shared/LoadingSpinner.tsx, ./WordDetails.module.css.
 *   Used by: ./OutputPage.tsx.
 *
 * Status: implemented (T57; dictionary lookup T53).
 */

import { useEffect, useId, useState } from "react";
import { type MessageKey, useI18n } from "../../hooks/useI18n";
import type { AnnotatedToken } from "../../hooks/useParser";
import { useSubword } from "../../hooks/useSubword";
import { useVocab } from "../../hooks/useVocab";
import { Button } from "../Shared/Button";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import styles from "./WordDetails.module.css";

const UPOS_TAGS = new Set([
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "SCONJ",
  "SYM",
  "VERB",
  "X",
]);

/** Catalog key of a UPOS tag, or null for an unknown tag (shown as is). */
export const uposKey = (upos: string): MessageKey | null =>
  UPOS_TAGS.has(upos) ? (`upos.${upos}` as MessageKey) : null;

export type WordDetailsProps = {
  token: AnnotatedToken;
  /** Part of speech in the reading shown (alternatives may change it). */
  upos: string;
  sentenceText: string;
  onClose: () => void;
};

export function WordDetails({ token, upos, sentenceText, onClose }: WordDetailsProps): React.JSX.Element {
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
          {t("output.wordDetails")}: <span lang="en">{token.text}</span>
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
      <p className={styles.muted}>{t("output.dictionaryLater")}</p>
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
