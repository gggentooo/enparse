/**
 * src/components/Pages/CreateWordList.tsx — make a vocabulary list from the shown text (T106)
 *
 * Description:
 *   "Create a vocabulary list from this text" button on the output page. A
 *   dialog asks for the list title (required; not the title of another list)
 *   and has a toggle to fill in meanings from the in-app dictionary (on: the
 *   Korean meaning and English definition of each word's part of speech,
 *   T100; off: left empty for the user). The list gets every word of the
 *   text once (useParser().words; rules T100) and is stored in one write
 *   (useVocab().createListWithItems; T103).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Title and toggle; word count.
 *   2. With the toggle on: look up meanings (useWordGlosses; spinner,
 *      Cancel). If some fail: create without them, or try again.
 *   3. Confirm with a link to the list on the vocabulary page
 *      (#/vocab?list=<id>); storage errors are shown.
 *
 * Dependencies:
 *   External: react, react-router (Link).
 *   Internal: hooks/useParser.ts, hooks/useVocab.ts, hooks/useWordGlosses.ts,
 *             hooks/useI18n.ts, Shared/Modal.tsx, Shared/Button.tsx,
 *             Shared/LoadingSpinner.tsx, paths.ts, ./CreateWordList.module.css.
 *   Used by: ./OutputPage.tsx.
 *
 * Status: implemented (T106). Tests: OutputPage.test.tsx.
 */

import { useId, useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../../hooks/useI18n";
import { useParser } from "../../hooks/useParser";
import { type NewVocabItem, useVocab } from "../../hooks/useVocab";
import { type WordGlosses, useWordGlosses } from "../../hooks/useWordGlosses";
import { PATHS, VOCAB_LIST_PARAM } from "../../paths";
import { Button } from "../Shared/Button";
import { LoadingSpinner } from "../Shared/LoadingSpinner";
import { Modal } from "../Shared/Modal";
import styles from "./CreateWordList.module.css";

type Phase =
  | { kind: "form" }
  | { kind: "lookingUp" }
  | { kind: "glossFailed"; found: WordGlosses }
  | { kind: "saving" }
  | { kind: "done"; id: string; name: string; count: number };

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function CreateWordList(): React.JSX.Element | null {
  const { t, formatNumber } = useI18n();
  const { words } = useParser();
  const vocab = useVocab();
  const glosses = useWordGlosses(words, false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fill, setFill] = useState(true);
  const [nameError, setNameError] = useState<"required" | "taken" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const ids = { form: useId(), name: useId(), nameError: useId(), fill: useId(), fillHint: useId() };
  if (!words) return null;

  const start = (): void => {
    setName("");
    setNameError(null);
    setSaveError(null);
    setPhase({ kind: "form" });
    setOpen(true);
  };
  const close = (): void => {
    glosses.cancel();
    setOpen(false);
  };

  const save = async (found: WordGlosses | null): Promise<void> => {
    setPhase({ kind: "saving" });
    const items: NewVocabItem[] = words.map((w) => {
      const g = found?.glosses.get(w.key) ?? null;
      return {
        word: w.word,
        lemma: w.lemma,
        upos: w.upos,
        sourceSentence: w.sentence,
        definitionKo: g?.ko ?? null,
        definitionEn: g?.en ?? null,
      };
    });
    try {
      const list = await vocab.createListWithItems(name, items);
      setPhase({ kind: "done", id: list.id, name: list.name, count: list.items.length });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setPhase({ kind: "form" });
    }
  };

  const lookUpAndSave = async (): Promise<void> => {
    setPhase({ kind: "lookingUp" });
    const found = await glosses.load();
    if (!found) return; // cancelled
    if (found.error) setPhase({ kind: "glossFailed", found });
    else await save(found);
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    setSaveError(null);
    if (name.trim() === "") return setNameError("required");
    if (vocab.lists.some((l) => sameName(l.name, name))) return setNameError("taken");
    setNameError(null);
    void (fill ? lookUpAndSave() : save(null));
  };

  const busy = phase.kind === "lookingUp" || phase.kind === "saving";
  const actions =
    phase.kind === "done" ? (
      <Button variant="secondary" onClick={close}>
        {t("common.close")}
      </Button>
    ) : phase.kind === "glossFailed" ? (
      <>
        <Button variant="secondary" onClick={close}>
          {t("common.cancel")}
        </Button>
        <Button variant="secondary" onClick={() => void lookUpAndSave()}>
          {t("words.create.retry")}
        </Button>
        <Button onClick={() => void save(phase.found)}>{t("words.create.anyway")}</Button>
      </>
    ) : (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            if (phase.kind === "lookingUp") {
              glosses.cancel();
              setPhase({ kind: "form" });
            } else close();
          }}
          disabled={phase.kind === "saving"}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" form={ids.form} isLoading={busy} disabled={words.length === 0}>
          {t("words.create.submit")}
        </Button>
      </>
    );

  return (
    <>
      <Button variant="secondary" onClick={start}>
        {t("words.create.button")}
      </Button>
      <Modal open={open} title={t("words.create.title")} onClose={close} actions={actions}>
        {phase.kind === "done" ? (
          <div role="status" className={styles.done}>
            <p>{t("words.create.done", { name: phase.name, count: formatNumber(phase.count, 0) })}</p>
            <Link to={`${PATHS.vocab}?${VOCAB_LIST_PARAM}=${encodeURIComponent(phase.id)}`}>
              {t("words.create.open")}
            </Link>
          </div>
        ) : (
          <form id={ids.form} className={styles.form} onSubmit={submit} noValidate>
            <div className={styles.field}>
              <label htmlFor={ids.name}>{t("words.create.name")}</label>
              <input
                id={ids.name}
                type="text"
                value={name}
                required
                disabled={busy || phase.kind === "glossFailed"}
                aria-invalid={nameError !== null}
                aria-describedby={nameError ? ids.nameError : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
              />
              {nameError && (
                <p id={ids.nameError} role="alert" className={styles.error}>
                  {t(nameError === "required" ? "words.create.nameRequired" : "words.create.nameTaken")}
                </p>
              )}
            </div>
            <div className={styles.toggle}>
              <input
                id={ids.fill}
                type="checkbox"
                role="switch"
                checked={fill}
                disabled={busy || phase.kind === "glossFailed"}
                aria-describedby={ids.fillHint}
                onChange={(e) => setFill(e.target.checked)}
              />
              <label htmlFor={ids.fill}>{t("words.create.fill")}</label>
              <p id={ids.fillHint} className={styles.hint}>
                {t(fill ? "words.create.fillOn" : "words.create.fillOff")}
              </p>
            </div>
            <p>{t("words.create.count", { count: formatNumber(words.length, 0) })}</p>
            {phase.kind === "lookingUp" && (
              <LoadingSpinner size="small" label={t("words.loading")} progress={glosses.progress} />
            )}
            {phase.kind === "saving" && <LoadingSpinner size="small" label={t("words.create.saving")} />}
            {phase.kind === "glossFailed" && (
              <p role="alert" className={styles.error}>
                {t("words.create.glossFailed")} {phase.found.error ? t(`dict.error.${phase.found.error}`) : ""}
              </p>
            )}
            {saveError && (
              <p role="alert" className={styles.error}>
                {t("words.create.failed", { message: saveError })}
              </p>
            )}
          </form>
        )}
      </Modal>
    </>
  );
}
