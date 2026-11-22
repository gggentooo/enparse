/**
 * src/components/Pages/NestedReading.tsx — nested phrase view of one reading (OutputPage)
 *
 * Description:
 *   Nested phrases colored by category (T20), drawn as boxes or as brackets at both ends, per the OutputPage toggles (NestedLook). The label ("명사구 (NP) ·
 *   주어 (Subject)") and word role badges are in the DOM and shown either always or only on
 *   hover or keyboard focus of the innermost phrase/word (CSS). Head words of their parent are marked; words whose
 *   bracket collapsed carry their role as a badge (T59); split phrases
 *   (non-contiguous) are noted. Nesting is exposed as groups for screen
 *   readers.
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useParser.ts (types), ./OutputWord.tsx,
 *             ./FlatReading.tsx (ReadingViewProps), ./NestedReading.module.css.
 *   Used by: ./SentenceView.tsx.
 *
 * Status: implemented (T57).
 */

import { useI18n } from "../../hooks/useI18n";
import type { AnnotatedNode } from "../../hooks/useParser";
import type { ReadingViewProps } from "./FlatReading";
import styles from "./NestedReading.module.css";
import { OutputWord } from "./OutputWord";

/** Look of the nested view (OutputPage toggles). */
export type NestedLook = {
  /** Phrases drawn as rounded boxes or as colored brackets. */
  shape: "boxes" | "brackets";
  /** Phrase and role labels always shown, or only while hovered or focused. */
  labels: "always" | "hover";
};

function Node({ node, ...props }: ReadingViewProps & { node: AnnotatedNode }): React.JSX.Element | null {
  const { t } = useI18n();
  const role = node.role ? t(`role.${node.role}`) : null;
  if (node.kind === "word") {
    const token = props.sentence.tokens[node.token];
    if (!token) return null;
    return (
      <span className={`${styles.word} ${node.isHead ? styles.head : ""}`}>
        <OutputWord
          token={token}
          selected={token.id === props.selectedId}
          changed={token.index in props.reading.changes}
          markAmbiguous={props.reading.rank === 0}
          onSelect={props.onSelect}
        />
        {role && <span className={`${styles.badge} ${node.badge ? styles.uncertain : ""}`}>{role}</span>}
      </span>
    );
  }
  const category = node.category ? t(`grammar.${node.category}`) : null;
  const label = [category, role].filter(Boolean).join(" · ");
  return (
    <span
      role="group"
      aria-label={label || undefined}
      className={`${styles.phrase} ${node.category ? styles[node.category] : ""} ${node.isHead ? styles.head : ""}`}
    >
      {label && (
        <span className={styles.label} aria-hidden="true">
          {label}
          {node.isHead && ` · ${t("output.head")}`}
          {!node.contiguous && ` · ${t("output.splitPhrase")}`}
        </span>
      )}
      <span className={styles.children}>
        {node.children.map((child) => (
          <Node key={child.id} node={child} {...props} />
        ))}
      </span>
    </span>
  );
}

export function NestedReading({ look, ...props }: ReadingViewProps & { look: NestedLook }): React.JSX.Element {
  return (
    <div className={`${styles.nested} ${styles[look.shape]} ${styles[look.labels]}`}>
      {(props.reading.nodes ?? []).map((node) => (
        <Node key={node.id} node={node} {...props} />
      ))}
    </div>
  );
}
