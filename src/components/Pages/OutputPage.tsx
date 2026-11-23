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
  // Defaults (owner, T88): the structure view, labels on hover, phrases as blocks.
  const [view, setView] = useState<"flat" | "nested">("nested");
  const [look, setLook] = useState<NestedLook>({ shape: "boxes", labels: "hover", labelPos: "top" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const viewName = useId();
  const labelsName = useId();
  const shapeName = useId();
  const labelPosName = useId();
  // Where the word panel goes on wide screens (T91): beside the sentences, or at the bottom of the screen.
  const [panelPos, setPanelPos] = useState<"side" | "bottom">("side");
  const panelName = useId();

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
        {/* Only where the panel fits beside the sentences ("desktop"); hidden by a container query otherwise. */}
        <fieldset className={`${styles.views} ${styles.panelToggle}`}>
          <legend>{t("output.panelPos")}</legend>
          {(["side", "bottom"] as const).map((v) => (
            <label key={v} className={styles.viewChoice}>
              <input type="radio" name={panelName} checked={panelPos === v} onChange={() => setPanelPos(v)} />
              {t(v === "side" ? "output.panelPos.side" : "output.panelPos.bottom")}
            </label>
          ))}
        </fieldset>
        {shownView === "nested" && (
          <>
            <fieldset className={styles.views}>
              <legend>{t("output.labels")}</legend>
              {(["hover", "always"] as const).map((v) => (
                <label key={v} className={styles.viewChoice}>
                  <input
                    type="radio"
                    name={labelsName}
                    checked={look.labels === v}
                    onChange={() => setLook({ ...look, labels: v })}
                  />
                  {t(v === "hover" ? "output.labels.hover" : "output.labels.always")}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.views}>
              <legend>{t("output.phrases")}</legend>
              {(["boxes", "brackets"] as const).map((v) => (
                <label key={v} className={styles.viewChoice}>
                  <input
                    type="radio"
                    name={shapeName}
                    checked={look.shape === v}
                    onChange={() => setLook({ ...look, shape: v })}
                  />
                  {t(v === "boxes" ? "output.phrases.boxes" : "output.phrases.brackets")}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.views}>
              <legend>{t("output.labelPos")}</legend>
              {(["top", "side"] as const).map((v) => (
                <label key={v} className={styles.viewChoice}>
                  <input
                    type="radio"
                    name={labelPosName}
                    checked={look.labelPos === v}
                    onChange={() => setLook({ ...look, labelPos: v })}
                  />
                  {t(v === "top" ? "output.labelPos.top" : "output.labelPos.side")}
                </label>
              ))}
            </fieldset>
          </>
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

      <div className={`${styles.layout} ${panelPos === "bottom" ? styles.panelBottom : ""}`}>
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
            prev={current.sentence.tokens[current.token.index - 1] ?? null}
            next={current.sentence.tokens[current.token.index + 1] ?? null}
            onClose={() => setSelection(null)}
          />
        ) : (
          <p className={`${styles.muted} ${styles.hintPanel}`}>{t("output.selectHint")}</p>
        )}
      </div>
    </section>
  );
}
