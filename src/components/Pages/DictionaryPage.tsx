/**
 * src/components/Pages/DictionaryPage.tsx — dictionary lookup page (#/dictionary)
 *
 * Description:
 *   Direct lookup of English words and phrasal verbs (T53; owner decisions
 *   T25, T42). The query is in the URL (#/dictionary?q=ran&lemma=run&upos=VERB)
 *   so the word panel's "More in the dictionary" link (T25: click → popup →
 *   more) and the browser history work. Typed inflected forms resolve through
 *   the inflection index (ran → run); an ambiguous form lists every headword
 *   (saw → saw, see).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Labeled search form → URL → useDictionary().lookup.
 *   2. Entries (./DictionaryEntry.tsx): Korean translations, definitions
 *      (the queried part of speech first), examples with attribution.
 *   3. Word parts of the queried word via useSubword.
 *   4. "Add to list" per entry via useVocab (creates a first list if none).
 *   5. Loading, not-found, and error states (by reason); offline hint
 *      linking to the Models page (T72).
 *
 * Dependencies:
 *   External: react, react-router (useSearchParams, Link).
 *   Internal: hooks/useDictionary.ts, hooks/useSubword.ts, hooks/useVocab.ts,
 *             hooks/useI18n.ts, Shared/Button.tsx, Shared/LoadingSpinner.tsx,
 *             ./DictionaryEntry.tsx, ./DictionaryPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Status: implemented (T53). Tests: DictionaryPage.test.tsx.
 */

import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type DictionaryEntry as Entry, useDictionary } from "../../hooks/useDictionary";
import { useI18n } from "../../hooks/useI18n";
import { useSubword } from "../../hooks/useSubword";
import { useVocab } from "../../hooks/useVocab";
import { PATHS } from "../../paths";
import { Button } from "../Shared/Button";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import { DictionaryEntry } from "./DictionaryEntry";
import styles from "./DictionaryPage.module.css";

/** Link to the dictionary page for a word (and the parse's lemma and part of speech). */
export function dictionaryLink(word: string, lemma?: string | null, upos?: string | null): string {
  const p = new URLSearchParams({ q: word });
  if (lemma) p.set("lemma", lemma);
  if (upos) p.set("upos", upos);
  return `${PATHS.dictionary}?${p.toString()}`;
}

function AddToList({ entry }: { entry: Entry }): React.JSX.Element {
  const { t } = useI18n();
  const vocab = useVocab();
  const [added, setAdded] = useState<string | null>(null);
  const add = async (): Promise<void> => {
    try {
      const list = vocab.lists[0] ?? (await vocab.createList(t("output.defaultList")));
      const first = entry.pos[0];
      await vocab.addItem(list.id, {
        word: entry.headword,
        lemma: entry.headword,
        ...(first ? { upos: first.upos } : {}),
        ...(first?.senses[0] ? { definitionEn: first.senses[0].definition } : {}),
        ...(first?.korean[0] ? { definitionKo: first.korean[0].words.join(", ") } : {}),
      });
      setAdded(list.name);
    } catch {
      // The vocab snapshot keeps the error; VocabPage shows it.
    }
  };
  return (
    <span className={styles.add}>
      <Button variant="secondary" onClick={() => void add()}>
        {t("output.addToList")}
      </Button>
      {added && (
        <span role="status" className={styles.muted}>
          {t("output.added", { word: entry.headword, list: added })}
        </span>
      )}
    </span>
  );
}

function WordParts({ word }: { word: string }): React.JSX.Element | null {
  const { t } = useI18n();
  const { segmentation, segment, clear } = useSubword();
  useEffect(() => {
    if (/^[A-Za-z][A-Za-z'-]*$/.test(word)) segment(word, null);
    else clear();
  }, [word, segment, clear]);
  const parts = segmentation?.segments ?? [];
  if (parts.length <= 1) return null;
  return (
    <p className={styles.parts}>
      <span className={styles.muted}>{t("output.parts")}: </span>
      {parts.map((p, i) => (
        <span key={`${p.kind}-${i}`} className={styles.part}>
          <span lang="en">{p.kind === "prefix" ? `${p.text}-` : p.kind === "base" ? p.text : `-${p.text}`}</span>{" "}
          <span className={styles.muted}>
            ({t(`output.segment.${p.kind}`)}
            {p.affix ? ` · ${p.affix.gloss}` : ""})
          </span>
        </span>
      ))}
    </p>
  );
}

export function DictionaryPage(): React.JSX.Element {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const lemma = params.get("lemma");
  const upos = params.get("upos");
  const { result, isLoading, error, lookup, clear } = useDictionary();
  const inputId = useId();

  useEffect(() => {
    if (q) lookup({ word: q, lemma, upos });
    else clear();
  }, [q, lemma, upos, lookup, clear]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    setParams(value ? { q: value } : {});
  };
  const entries = result && result.query.word === q ? result.entries : null;

  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.dictionary.title")}</h1>
      <form className={styles.search} role="search" onSubmit={onSubmit} key={q}>
        <label htmlFor={inputId}>{t("dict.searchLabel")}</label>
        <input
          id={inputId}
          name="q"
          type="search"
          lang="en"
          defaultValue={q}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
        />
        <Button type="submit">{t("dict.search")}</Button>
      </form>

      {!q && <p className={styles.muted}>{t("dict.intro")}</p>}
      {q && isLoading && <LoadingSpinner label={t("dict.loading")} />}
      {q && error && (
        <p role="alert" className={styles.error}>
          {t(`dict.error.${error}`)}
          {error === "network" && (
            <>
              {" "}
              <Link to={PATHS.models}>{t("dict.offlineLink")}</Link>
            </>
          )}
        </p>
      )}
      {q && !isLoading && !error && entries?.length === 0 && <p role="status">{t("dict.notFound", { word: q })}</p>}
      {q && <WordParts word={q} />}
      {entries && entries.length > 0 && (
        <div className={styles.results} aria-live="polite">
          {entries.map(({ entry, match }) => (
            <DictionaryEntry
              key={entry.key}
              entry={entry}
              match={match}
              word={q}
              actions={<AddToList entry={entry} />}
            />
          ))}
        </div>
      )}
    </section>
  );
}
