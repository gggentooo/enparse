/**
 * src/components/Pages/OutputPage.tsx — annotated results page (#/output)
 *
 * Description:
 *   Displays the parsed text with chunk annotations, alternative parses,
 *   word selection, inline dictionary lookup, and subword breakdown.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Render the annotation model from useParser: flat view (chunks
 *      color-coded by type with text labels; ./FlatReading.tsx) or nested
 *      view (boxes or brackets, labels always or on hover, per two toggles; ./NestedReading.tsx) when the model has
 *      it (T20). Paragraphs as in the input.
 *   2. Mark words with other readings; "Other readings (n)" per sentence
 *      switches the whole sentence view (./SentenceView.tsx; T11).
 *   3. Word selection (click and keyboard) → ./WordDetails.tsx panel: base
 *      form, part of speech, word parts (useSubword). Dictionary lookup via
 *      useDictionary follows in T53.
 *   4. "Add to vocab list" via useVocab (in WordDetails).
 *   5. Removed-text notice of the last parse; model id, version, backend.
 *   6. Split into child components next to this file (agents.md → React).
 *   7. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react, react-router (Link).
 *   Internal: hooks/useParser.ts, hooks/useI18n.ts, ./SentenceView.tsx,
 *             ./WordDetails.tsx, Shared/ModelStatus.tsx (useModelName),
 *             ./OutputPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Status: implemented (T57; dictionary lookup T53). Tests: OutputPage.test.tsx.
 */

import { useId, useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../../hooks/useI18n";
import {
  type AnnotatedSentence,
  type AnnotatedToken,
  type ChunkKind,
  type PreprocessResult,
  useParser,
} from "../../hooks/useParser";
import { PATHS } from "../../paths";
import { useModelName } from "../Shared/ModelStatus";
import styles from "./OutputPage.module.css";
import type { NestedLook } from "./NestedReading";
import { SentenceView } from "./SentenceView";
import { WordDetails } from "./WordDetails";

const CHUNK_TYPES: readonly ChunkKind[] = ["NP", "VP", "PP", "ADJP", "ADVP"];

type Selection = { token: AnnotatedToken; sentence: AnnotatedSentence; rank: number };

function RemovedNotice({ notice }: { notice: PreprocessResult }): React.JSX.Element {
  const { t, formatNumber } = useI18n();
  const parts = (["nonLatin", "emoji", "control"] as const)
    .filter((k) => notice.removed[k].count > 0)
    .map((k) => t(`output.removed.${k}`, { count: formatNumber(notice.removed[k].count, 0) }));
  return (
    <p role="status" className={styles.notice}>
      {t("output.removed", { details: parts.join(", ") })}
    </p>
  );
}

export function OutputPage(): React.JSX.Element {
  const { t } = useI18n();
  const { annotation, notice } = useParser();
  const modelName = useModelName();
  const [view, setView] = useState<"flat" | "nested">("flat");
  const [look, setLook] = useState<NestedLook>({ shape: "brackets", labels: "hover" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const viewName = useId();

  if (!annotation) {
    return (
      <section className={styles.page} aria-labelledby="page-title">
        <h1 id="page-title">{t("page.output.title")}</h1>
        <p>{t("output.empty")}</p>
        <p>
          <Link to={PATHS.input}>{t("output.goInput")}</Link>
        </p>
      </section>
    );
  }

  // Selection belongs to one parse: drop it when a new annotation arrives.
  const current = selection && annotation.sentences.includes(selection.sentence) ? selection : null;
  const shownView = annotation.hasNested ? view : "flat";
  const paragraphs = new Map<number, AnnotatedSentence[]>();
  for (const s of annotation.sentences) paragraphs.set(s.paragraph, [...(paragraphs.get(s.paragraph) ?? []), s]);
  const hasAmbiguity = annotation.sentences.some((s) => s.readings.length > 1);
  let number = 0;

  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.output.title")}</h1>
      <p className={styles.meta}>
        {t("output.model", {
          model: modelName(annotation.modelId),
          version: annotation.modelVersion,
          backend: annotation.backend.toUpperCase(),
        })}
      </p>
      {notice && <RemovedNotice notice={notice} />}

      <div className={styles.toolbar}>
        <fieldset className={styles.views}>
          <legend>{t("output.view")}</legend>
          {(["flat", "nested"] as const).map((v) => (
            <label key={v} className={styles.viewChoice}>
              <input
                type="radio"
                name={viewName}
                checked={shownView === v}
                disabled={v === "nested" && !annotation.hasNested}
                onChange={() => setView(v)}
              />
              {t(v === "flat" ? "output.flat" : "output.nested")}
            </label>
          ))}
        </fieldset>
        {shownView === "nested" && (
          <fieldset className={styles.views}>
            <legend>{t("output.look")}</legend>
            <label className={styles.viewChoice}>
              <input
                type="checkbox"
                checked={look.labels === "hover"}
                onChange={(e) => setLook({ ...look, labels: e.target.checked ? "hover" : "always" })}
              />
              {t("output.labelsOnHover")}
            </label>
            <label className={styles.viewChoice}>
              <input
                type="checkbox"
                checked={look.shape === "brackets"}
                onChange={(e) => setLook({ ...look, shape: e.target.checked ? "brackets" : "boxes" })}
              />
              {t("output.brackets")}
            </label>
          </fieldset>
        )}
        {!annotation.hasNested && <p className={styles.muted}>{t("output.nestedUnavailable")}</p>}
        <div className={styles.legend}>
          <span className={styles.legendTitle}>{t("output.legend")}</span>
          <ul>
            {CHUNK_TYPES.map((c) => (
              <li key={c} className={`${styles.swatch} ${styles[c]}`}>
                {t(`grammar.${c}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {hasAmbiguity && <p className={styles.muted}>{t("output.ambiguousHint")}</p>}

      <div className={styles.layout}>
        <div className={styles.text}>
          {[...paragraphs.entries()].map(([p, sentences]) => (
            <div key={p} className={styles.paragraph}>
              {sentences.map((s) => {
                number++;
                return (
                  <SentenceView
                    key={s.id}
                    sentence={s}
                    number={number}
                    view={shownView}
                    look={look}
                    selectedId={current?.token.id ?? null}
                    onSelect={(token, sentence, rank) => setSelection({ token, sentence, rank })}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {current ? (
          <WordDetails
            token={current.token}
            upos={
              current.sentence.readings.find((r) => r.rank === current.rank)?.changes[current.token.index]?.upos ??
              current.token.upos
            }
            sentenceText={current.sentence.text}
            onClose={() => setSelection(null)}
          />
        ) : (
          <p className={`${styles.muted} ${styles.hintPanel}`}>{t("output.selectHint")}</p>
        )}
      </div>
    </section>
  );
}
