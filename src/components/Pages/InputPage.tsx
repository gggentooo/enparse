/**
 * src/components/Pages/InputPage.tsx — raw text input page (#/input)
 *
 * Description:
 *   Lets the user enter English text (type, paste, drag-and-drop a text
 *   file) and start parsing.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Labeled <textarea> with live character count vs the max length.
 *   2. Drag-and-drop of plain-text files.
 *   3. Parse button → useParser().parseText; navigate to #/output on success.
 *      The button is disabled unless useParser().canParse (model ready); why
 *      is shown by Shared/ModelStatus (checking, no model chosen → link to
 *      #/models, download/loading progress, or failure reason with
 *      DiagnosticsPanel). The text is kept in parserService (draft), so it
 *      survives page changes and model loading.
 *   4. Show too-long errors (with count, counted in code points like the
 *      preprocessor) and parse errors. The removed-text notice is shown on
 *      OutputPage, next to the result it applies to.
 *   5. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react, react-router (navigation).
 *   Internal: hooks/useParser.ts, hooks/useI18n.ts, components/Shared/Button.tsx,
 *             components/Shared/ModelStatus.tsx, ./InputPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Status: implemented (T56). Tests: InputPage.test.tsx.
 */

import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "../../hooks/useI18n";
import { MAX_INPUT_CHARS, useParser } from "../../hooks/useParser";
import { PATHS } from "../../paths";
import { Button } from "../Shared/Button";
import { ModelStatus } from "../Shared/ModelStatus";
import styles from "./InputPage.module.css";

/** Length as the preprocessor counts it (code points). */
const codePoints = (text: string): number => [...text].length;

const isPlainText = (file: File): boolean => file.type === "text/plain" || /\.txt$/i.test(file.name);

export function InputPage(): React.JSX.Element {
  const { t, formatNumber } = useI18n();
  const { draft, setDraft, canParse, isParsing, parseText, error } = useParser();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState(false);
  const ids = { text: useId(), hint: useId(), count: useId() };
  const count = codePoints(draft);
  const tooLong = count > MAX_INPUT_CHARS;
  const fmt = (n: number): string => formatNumber(n, 0);

  const parse = async (): Promise<void> => {
    try {
      if (await parseText(draft)) await navigate(PATHS.output);
    } catch {
      // The hook keeps the error; it is shown below.
    }
  };

  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.input.title")}</h1>
      <ModelStatus />
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void parse();
        }}
      >
        <label htmlFor={ids.text} className={styles.label}>
          {t("input.label")}
        </label>
        <p id={ids.hint} className={styles.hint}>
          {t("input.hint")}
        </p>
        <textarea
          id={ids.text}
          className={`${styles.textarea} ${dragging ? styles.dragging : ""}`}
          lang="en"
          spellCheck={false}
          rows={12}
          value={draft}
          aria-describedby={`${ids.hint} ${ids.count}`}
          aria-invalid={tooLong || undefined}
          onChange={(e) => setDraft(e.target.value)}
          onDragOver={(e) => {
            if ([...e.dataTransfer.types].includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            const file = e.dataTransfer.files[0];
            if (!file) return;
            e.preventDefault();
            setDragging(false);
            if (!isPlainText(file)) {
              setDropError(true);
              return;
            }
            setDropError(false);
            void file.text().then(setDraft);
          }}
        />
        <p id={ids.count} className={`${styles.count} ${tooLong ? styles.over : ""}`} aria-live="polite">
          {t("input.count", { count: fmt(count), max: fmt(MAX_INPUT_CHARS) })}
        </p>
        {tooLong && (
          <p role="alert" className={styles.error}>
            {t("input.tooLong", { count: fmt(count), max: fmt(MAX_INPUT_CHARS) })}
          </p>
        )}
        {dropError && (
          <p role="alert" className={styles.error}>
            {t("input.dropError")}
          </p>
        )}
        {error && !tooLong && (
          <p role="alert" className={styles.error}>
            {t("input.parseError", { message: error.message })}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={!canParse || tooLong || draft.trim() === ""} isLoading={isParsing}>
            {t("input.parse")}
          </Button>
          <Button variant="secondary" disabled={draft === ""} onClick={() => setDraft("")}>
            {t("input.clear")}
          </Button>
        </div>
      </form>
    </section>
  );
}
