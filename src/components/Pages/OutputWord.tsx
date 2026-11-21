/**
 * src/components/Pages/OutputWord.tsx — one selectable word in the output views (OutputPage)
 *
 * Description:
 *   A word as a button (click or keyboard selects it for WordDetails). Words
 *   with other readings get a dotted underline (T11); words changed in the
 *   shown alternative are highlighted. Both marks also have hidden text.
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useParser.ts (types), ./OutputWord.module.css.
 *   Used by: ./FlatReading.tsx, ./NestedReading.tsx.
 *
 * Status: implemented (T57).
 */

import { useI18n } from "../../hooks/useI18n";
import type { AnnotatedToken } from "../../hooks/useParser";
import styles from "./OutputWord.module.css";

export type OutputWordProps = {
  token: AnnotatedToken;
  selected: boolean;
  /** Changed in the reading being shown (alternatives only). */
  changed: boolean;
  /** Mark words with other readings (primary reading only). */
  markAmbiguous: boolean;
  onSelect: (token: AnnotatedToken) => void;
};

export function OutputWord({ token, selected, changed, markAmbiguous, onSelect }: OutputWordProps): React.JSX.Element {
  const { t } = useI18n();
  const ambiguous = markAmbiguous && token.ambiguous;
  const cls = [styles.word, ambiguous && styles.ambiguous, changed && styles.changed].filter(Boolean).join(" ");
  return (
    <button type="button" lang="en" className={cls} aria-pressed={selected} onClick={() => onSelect(token)}>
      {token.text}
      {ambiguous && <span className="visually-hidden"> {t("output.ambiguous")}</span>}
      {changed && <span className="visually-hidden"> {t("output.changed")}</span>}
    </button>
  );
}
