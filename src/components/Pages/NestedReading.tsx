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
 *   Arrows (T80; drawn under the sentence as the bottom of a rounded
 *   rectangle, T84, T86): pointing at or focusing a phrase or word draws an arrow to
 *   the words it attaches to (what it modifies or complements; a modifier
 *   before its head targets everything up to the head: big → "red dog"; T81),
 *   with its role;
 *   a dashed arrow means the model is unsure. In a near-tie sentence (T83) the
 *   phrase the readings dispute is marked, and pointing at it draws a dashed
 *   arrow to each candidate with its share. The same information is in the
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

/** How far an arrow drops below the words it joins, and the radius of its two bottom corners (px). */
const ARROW_RISE = 18;
const ARROW_RADIUS = 8;

/** One arrow line in the view's own coordinates. */
type Line = { x1: number; y1: number; x2: number; y2: number; label: string; dashed: boolean };
/**
 * What pointing at a phrase or word shows: one arrow to the words it attaches to, or, for a
 * phrase the readings dispute (a fork; T83), a dashed arrow to each candidate with its share.
 * `targets` are the token ranges to highlight.
 */
type Arrow = { lines: Line[]; targets: Array<[number, number]> };

type NodeProps = ReadingViewProps & { node: AnnotatedNode; look: NestedLook; targets: Array<[number, number]> };

function Node({ node, look, targets, ...props }: NodeProps): React.JSX.Element | null {
  const { t, formatNumber } = useI18n();
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

  // A phrase the readings dispute (near-tie): marked, and pointing at it shows both candidates.
  const fork = node.isHead
    ? undefined
    : props.reading.forks.find((f) => f.token === (node.kind === "word" ? node.token : node.head));
  const forkAttrs = fork ? { "data-fork": fork.targets.map((x) => `${x.token}:${x.share}`).join(",") } : {};
  const disputed = fork
    ? t("output.disputed", {
        options: fork.targets
          .map((x) => `“${props.sentence.tokens[x.token]?.text ?? ""}” ${formatNumber(x.share * 100, 0)}%`)
          .join(", "),
      })
    : null;

  if (node.kind === "word") {
    const token = props.sentence.tokens[node.token];
    if (!token) return null;
    const cls = [
      styles.word,
      node.isHead && styles.head,
      targets.some(([a, b]) => token.index >= a && token.index <= b) && styles.target,
      fork && styles.disputed,
    ];
    return (
      <span className={cls.filter(Boolean).join(" ")} data-token={token.index} {...attach} {...forkAttrs}>
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
        {disputed && <span className="visually-hidden"> {disputed}</span>}
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
    fork && styles.disputed,
  ];
  return (
    <span
      role="group"
      aria-label={
        [label, node.unsure && t("output.unsureSpan"), attaches, disputed].filter(Boolean).join("; ") || undefined
      }
      className={cls.filter(Boolean).join(" ")}
      {...attach}
      {...forkAttrs}
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
            <Node node={child} look={look} targets={targets} {...props} />
          </Fragment>
        ))}
      </span>
    </span>
  );
}

export function NestedReading({ look, ...props }: ReadingViewProps & { look: NestedLook }): React.JSX.Element {
  const { formatNumber } = useI18n();
  const view = useRef<HTMLDivElement>(null);
  const [arrow, setArrow] = useState<Arrow | null>(null);
  const marker = useId();

  /** Draw the arrow(s) of the innermost phrase or word with an attachment or a fork around the event target. */
  const point = (e: React.SyntheticEvent): void => {
    const box = view.current;
    const from = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-attach],[data-fork]") : null;
    if (!box || !from || !box.contains(from)) {
      setArrow(null);
      return;
    }
    const b = box.getBoundingClientRect();
    const f = from.getBoundingClientRect();
    /** Line from the source to the middle of tokens first..last. */
    const line = (first: number, last: number, label: string, dashed: boolean): Line | null => {
      const start = box.querySelector(`[data-token="${first}"]`);
      const end = box.querySelector(`[data-token="${last}"]`);
      if (!start || !end) return null;
      const g = end.getBoundingClientRect();
      return {
        x1: f.left + f.width / 2 - b.left + box.scrollLeft,
        y1: f.bottom - b.top,
        x2: (start.getBoundingClientRect().left + g.right) / 2 - b.left + box.scrollLeft,
        y2: g.bottom - b.top,
        label,
        dashed,
      };
    };
    let targets: Array<[number, number]>;
    let lines: Array<Line | null>;
    if (from.dataset.fork) {
      const options = from.dataset.fork.split(",").map((x) => x.split(":").map(Number) as [number, number]);
      targets = options.map(([token]) => [token, token]);
      lines = options.map(([token, share]) => line(token, token, `${formatNumber(share * 100, 0)}%`, true));
    } else {
      const last = Number(from.dataset.attach);
      const first = Number(from.dataset.attachFrom);
      targets = [[first, last]];
      lines = [line(first, last, from.dataset.role ?? "", from.dataset.unsure === "1")];
    }
    const next: Arrow = { lines: lines.filter((x): x is Line => x !== null), targets };
    setArrow((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
  };
  const clear = (): void => setArrow(null);

  const cls = [styles.nested, styles[look.shape], styles[look.labels]].join(" ");
  return (
    <div ref={view} className={cls} onMouseOver={point} onMouseLeave={clear} onFocus={point} onBlur={clear}>
      {(props.reading.nodes ?? []).map((node, i) => (
        <Fragment key={node.id}>
          {i > 0 && " "}
          <Node node={node} look={look} targets={arrow?.targets ?? []} {...props} />
        </Fragment>
      ))}
      {arrow && arrow.lines.length > 0 && (
        <svg className={styles.arrow} aria-hidden="true">
          <defs>
            <marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>
          {arrow.lines.map((l, i) => {
            // Under the sentence (T86): straight down, straight across, straight up, with rounded corners
            // (a rounded rectangle's bottom).
            const low = Math.max(l.y1, l.y2) + ARROW_RISE;
            const dir = l.x2 >= l.x1 ? 1 : -1;
            const r = Math.max(0, Math.min(ARROW_RADIUS, Math.abs(l.x2 - l.x1) / 2, low - l.y1, low - l.y2));
            const path =
              `M ${l.x1} ${l.y1} V ${low - r} Q ${l.x1} ${low} ${l.x1 + dir * r} ${low} ` +
              `H ${l.x2 - dir * r} Q ${l.x2} ${low} ${l.x2} ${low - r} V ${l.y2}`;
            return (
              <g key={`${l.x2}-${l.label}-${i}`} className={l.dashed ? styles.unsure : undefined}>
                <path d={path} markerEnd={`url(#${marker})`} />
                {l.label && (
                  <text x={(l.x1 + l.x2) / 2} y={low + 11} textAnchor="middle">
                    {l.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
