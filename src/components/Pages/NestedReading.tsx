/**
 * src/components/Pages/NestedReading.tsx — nested phrase view of one reading (OutputPage)
 *
 * Description:
 *   One bracket (or box) per phrase, colored by category (T20, T73). The
 *   main clause has no bracket: its subject and predicate brackets are the
 *   outermost ones, always shown, dashed when the model is unsure of their
 *   boundary (T82); coordinated phrases sit side by side around "and"; a phrase's one-word modifiers
 *   are plain words inside it. Looks (NestedLook, OutputPage toggles): boxes
 *   or brackets; labels ("명사구 (NP) · 수식어 (Modifier)") always or only on
 *   hover / keyboard focus. Subject and Predicate are always labeled.
 *   Arrows (T80): pointing at or focusing a phrase or word draws an arrow to
 *   the words it attaches to (what it modifies or complements; a modifier
 *   before its head targets everything up to the head: big → "red dog"; T81),
 *   with its role;
 *   a dashed arrow means the model is unsure. The same information is in the
 *   accessible names. Head words are bold; roles of collapsed brackets are
 *   badges on their head word (T59). Nesting is exposed as groups.
 *
 * Layer: components/ (page-specific UI of OutputPage)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts, hooks/useParser.ts (types), ./OutputWord.tsx,
 *             ./FlatReading.tsx (ReadingViewProps), ./NestedReading.module.css.
 *   Used by: ./SentenceView.tsx.
 *
 * Status: implemented (T57; phrase-per-head brackets and arrows T80).
 */

import { Fragment, useId, useRef, useState } from "react";
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

/** Roles labeled in every look: they tell the learner where the clause splits. */
const PINNED_ROLES: ReadonlySet<string> = new Set(["Subject", "Passive subject", "Predicate"]);

/** Arrow from a phrase or word to the words it attaches to (tokens first..target), in the view's own coordinates. */
type Arrow = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  uncertain: boolean;
  first: number;
  target: number;
};

type NodeProps = ReadingViewProps & { node: AnnotatedNode; look: NestedLook; target: [number, number] | null };

function Node({ node, look, target, ...props }: NodeProps): React.JSX.Element | null {
  const { t } = useI18n();
  const role = node.role ? t(`role.${node.role}`) : null;
  const pinned = node.role !== null && PINNED_ROLES.has(node.role);
  const to = node.attachTo === null ? null : (props.sentence.tokens[node.attachTo] ?? null);
  // A modifier before its head attaches to everything from just after itself through the head (T81).
  const first = to ? (node.attachFrom ?? to.index) : 0;
  const words = to
    ? props.sentence.tokens
        .slice(first, to.index + 1)
        .map((x) => x.text)
        .join(" ")
    : "";
  const attaches = to
    ? t("output.attachesTo", { word: words }) + (node.uncertain ? ` (${t("output.unsure")})` : "")
    : null;
  // Read by the view's pointer and focus handlers (closest element with an attachment).
  const attach = to
    ? {
        "data-attach": to.index,
        "data-attach-from": first,
        "data-role": role ?? "",
        "data-unsure": node.uncertain ? "1" : undefined,
      }
    : {};

  if (node.kind === "word") {
    const token = props.sentence.tokens[node.token];
    if (!token) return null;
    const cls = [
      styles.word,
      node.isHead && styles.head,
      target !== null && token.index >= target[0] && token.index <= target[1] && styles.target,
    ];
    return (
      <span className={cls.filter(Boolean).join(" ")} data-token={token.index} {...attach}>
        <OutputWord
          token={token}
          selected={token.id === props.selectedId}
          changed={token.index in props.reading.changes}
          markAmbiguous={props.reading.rank === 0}
          onSelect={props.onSelect}
        />
        {role && (
          <span
            className={[styles.badge, node.badge && styles.uncertain, pinned && styles.pinned]
              .filter(Boolean)
              .join(" ")}
          >
            {role}
          </span>
        )}
        {attaches && <span className="visually-hidden"> {attaches}</span>}
      </span>
    );
  }
  const category = node.category ? t(`grammar.${node.category}`) : null;
  const label = [category, role].filter(Boolean).join(" · ");
  // In the hover look a pinned label stays in the layout, so it shows the role only.
  const shown = pinned && look.labels === "hover" ? role : label;
  const cls = [
    styles.phrase,
    node.category && styles[node.category],
    node.isHead && styles.head,
    node.unsure && styles.dashed,
  ];
  return (
    <span
      role="group"
      aria-label={[label, node.unsure && t("output.unsureSpan"), attaches].filter(Boolean).join("; ") || undefined}
      className={cls.filter(Boolean).join(" ")}
      {...attach}
    >
      {shown && (
        <span className={`${styles.label} ${pinned ? styles.pinned : ""}`} aria-hidden="true">
          {shown}
          {!node.contiguous && ` · ${t("output.splitPhrase")}`}
        </span>
      )}
      <span className={styles.children}>
        {node.children.map((child, i) => (
          <Fragment key={child.id}>
            {i > 0 && " "}
            <Node node={child} look={look} target={target} {...props} />
          </Fragment>
        ))}
      </span>
    </span>
  );
}

export function NestedReading({ look, ...props }: ReadingViewProps & { look: NestedLook }): React.JSX.Element {
  const view = useRef<HTMLDivElement>(null);
  const [arrow, setArrow] = useState<Arrow | null>(null);
  const marker = useId();

  /** Draw the arrow of the innermost phrase or word with an attachment around the event target. */
  const point = (e: React.SyntheticEvent): void => {
    const box = view.current;
    const from = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-attach]") : null;
    const index = Number(from?.dataset.attach);
    const first = Number(from?.dataset.attachFrom);
    const to = box && from ? box.querySelector(`[data-token="${index}"]`) : null;
    const start = box && from ? box.querySelector(`[data-token="${first}"]`) : null;
    if (!box || !from || !to || !start || !box.contains(from)) {
      setArrow(null);
      return;
    }
    const b = box.getBoundingClientRect();
    const f = from.getBoundingClientRect();
    // The target span runs from its first word's left edge to the head word's right edge.
    const g = to.getBoundingClientRect();
    const left = start.getBoundingClientRect().left;
    const next: Arrow = {
      x1: f.left + f.width / 2 - b.left + box.scrollLeft,
      y1: f.top - b.top,
      x2: (left + g.right) / 2 - b.left + box.scrollLeft,
      y2: g.top - b.top,
      label: from.dataset.role ?? "",
      uncertain: from.dataset.unsure === "1",
      first,
      target: index,
    };
    setArrow((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
  };
  const clear = (): void => setArrow(null);

  // The curve rises above both ends, higher the farther apart they are.
  const lift = arrow ? Math.min(22, 10 + Math.abs(arrow.x2 - arrow.x1) / 12) : 0;
  const top = arrow ? Math.min(arrow.y1, arrow.y2) - lift : 0;
  const cls = [styles.nested, styles[look.shape], styles[look.labels]].join(" ");
  return (
    <div ref={view} className={cls} onMouseOver={point} onMouseLeave={clear} onFocus={point} onBlur={clear}>
      {(props.reading.nodes ?? []).map((node, i) => (
        <Fragment key={node.id}>
          {i > 0 && " "}
          <Node node={node} look={look} target={arrow ? [arrow.first, arrow.target] : null} {...props} />
        </Fragment>
      ))}
      {arrow && (
        <svg className={`${styles.arrow} ${arrow.uncertain ? styles.unsure : ""}`} aria-hidden="true">
          <defs>
            <marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>
          <path
            d={`M ${arrow.x1} ${arrow.y1} C ${arrow.x1} ${top}, ${arrow.x2} ${top}, ${arrow.x2} ${arrow.y2}`}
            markerEnd={`url(#${marker})`}
          />
          {arrow.label && (
            <text x={(arrow.x1 + arrow.x2) / 2} y={top + (Math.min(arrow.y1, arrow.y2) - top) / 4} textAnchor="middle">
              {arrow.label}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
