/**
 * src/modules/parser/treeDecoder.ts — head labels → dependency tree → nested phrases
 *
 * Description:
 *   Turns the model's structure output (group B labels, relative-POS head
 *   encoding `<offset>@<head UPOS>|<relation>`, rel_pos_v1) into a valid
 *   dependency tree per sentence, then into nested phrases for the nested
 *   view. Fixed decoding procedure only; no grammar rules (plan-training.md →
 *   Nested phrase structure). Also run by training (nested-phrase F1 via tsx),
 *   so training and the app share one implementation.
 *
 * Layer: modules/ (parser)
 *
 * Decoding (decodeTree):
 *   1. Each word takes its best candidate whose head can be found (k-th word
 *      with the head's UPOS, counted from the word towards the head, within
 *      the sentence); otherwise the next candidate.
 *   2. Exactly one root: if several, the most probable root stays and the
 *      others take their best non-root candidate (else attach to the root);
 *      if none, the word with the most probable root candidate becomes root
 *      (else the first VERB/AUX, else the first word).
 *   3. Cycles are broken one at a time by the cheapest change: among words in
 *      the cycle, the most probable alternative candidate whose head chain
 *      does not lead back to that word (so no new cycle appears); if none, the
 *      cycle's least confident word attaches to the root. Always terminates.
 *   4. Words without any usable candidate attach to the root (relation "dep").
 *
 * Nested phrases (buildPhrases):
 *   Head-outward: right dependents first (closest first), then left
 *   dependents (closest first); each step adds one nesting level. A head word
 *   (the root, or a word with non-punctuation dependents) gets its own
 *   innermost bracket; a dependent without dependents is a plain word.
 *   Punctuation is not bracketed: it sits in the outermost phrase of its
 *   head (root punctuation stays outside all brackets). Labels come from the
 *   head: NOUN/PROPN/PRON/NUM → NP (PP once a `case` dependent is attached),
 *   VERB/AUX → VP, ADJ → ADJP, ADV → ADVP, other → null.
 *   Example: "The red dog rarely barks loudly ." →
 *            [[The [red [dog]]] [rarely [[barks] loudly]]] .
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none.
 *   Used by: ./parser.ts, ./ambiguity.ts; training/js (nested-phrase F1 via tsx,
 *            plan-training.md → Phase 7).
 *
 * Status: implemented (Phase 7 pre-work). Tests: treeDecoder.test.ts.
 */

import type {
  DecodedTree,
  DepCandidate,
  PhraseNode,
  PhraseSpan,
  PhraseType,
  SentencePhrases,
  WordLeaf,
} from "./types";

/** Group B label of the root. */
export const ROOT_LABEL = "0@ROOT|root";
/** Relation given to words attached to the root by repair. */
export const REPAIR_RELATION = "dep";

const NOMINAL_UPOS = new Set(["NOUN", "PROPN", "PRON", "NUM"]);

/** Parsed group B label. */
export type DepLabel = { offset: number; headUpos: string; relation: string };

/** Split a rel_pos_v1 label; throws on malformed labels. */
export function parseDepLabel(label: string): DepLabel {
  const bar = label.indexOf("|");
  const at = label.indexOf("@");
  if (bar < 0 || at < 0 || at > bar) throw new Error(`malformed group B label ${JSON.stringify(label)}`);
  const offset = Number(label.slice(0, at));
  if (!Number.isInteger(offset)) throw new Error(`malformed offset in ${JSON.stringify(label)}`);
  return { offset, headUpos: label.slice(at + 1, bar), relation: label.slice(bar + 1) };
}

/** 1-based head of word i (0-based) for a label, 0 for root, or null if it points outside the sentence. */
export function resolveHead(label: string, upos: readonly string[], i: number): number | null {
  const { offset, headUpos } = parseDepLabel(label);
  if (offset === 0) return headUpos === "ROOT" ? 0 : null;
  const step = offset > 0 ? 1 : -1;
  let seen = 0;
  for (let m = i + step; m >= 0 && m < upos.length; m += step) {
    if (upos[m] === headUpos && ++seen === Math.abs(offset)) return m + 1;
  }
  return null;
}

type Choice = { head: number; relation: string; prob: number; rank: number };

function findCycle(heads: number[]): number[] | null {
  const n = heads.length;
  const state = new Array<number>(n).fill(0); // 0 new, 1 on path, 2 done
  for (let s = 0; s < n; s++) {
    if (state[s] !== 0) continue;
    const path: number[] = [];
    let k = s;
    while (k >= 0 && state[k] === 0) {
      state[k] = 1;
      path.push(k);
      k = (heads[k] ?? 0) - 1;
    }
    if (k >= 0 && state[k] === 1) return path.slice(path.indexOf(k));
    for (const p of path) state[p] = 2;
  }
  return null;
}

/**
 * Decode one sentence's group B candidates into a valid tree.
 * @param candidates per word, best first (at least one per word)
 * @param upos predicted UPOS per word (group A)
 */
export function decodeTree(candidates: readonly (readonly DepCandidate[])[], upos: readonly string[]): DecodedTree {
  const n = upos.length;
  if (candidates.length !== n) throw new Error("candidates and upos lengths differ");
  if (n === 0) return { heads: [], relations: [], repaired: false, repairedWords: [] };

  const options: Choice[][] = candidates.map((cands, i) =>
    cands.flatMap((c, rank) => {
      const head = resolveHead(c.label, upos, i);
      return head === null || head === i + 1 ? [] : [{ head, relation: parseDepLabel(c.label).relation, prob: c.prob, rank }];
    }),
  );
  const chosen: (Choice | null)[] = options.map((o) => o[0] ?? null);

  // Step 2: exactly one root.
  const roots = chosen.flatMap((c, i) => (c?.head === 0 ? [i] : []));
  let root: number;
  if (roots.length > 0) {
    root = roots.reduce((a, b) => ((chosen[b]?.prob ?? 0) > (chosen[a]?.prob ?? 0) ? b : a));
  } else {
    const rootProb = options.map((o) => o.find((c) => c.head === 0)?.prob ?? -1);
    const best = rootProb.reduce((a, p, i) => (p > (rootProb[a] ?? -1) ? i : a), 0);
    if ((rootProb[best] ?? -1) >= 0) root = best;
    else {
      const verb = upos.findIndex((u) => u === "VERB" || u === "AUX");
      root = verb >= 0 ? verb : 0;
    }
    chosen[root] = options[root]?.find((c) => c.head === 0) ?? { head: 0, relation: "root", prob: 0, rank: Infinity };
  }
  for (let i = 0; i < n; i++) {
    if (i === root) continue;
    const c = chosen[i];
    if (c === null || c === undefined || c.head === 0) {
      chosen[i] = options[i]?.find((o) => o.head !== 0) ?? null;
    }
    if (chosen[i] === null) chosen[i] = { head: root + 1, relation: REPAIR_RELATION, prob: 0, rank: Infinity };
  }

  // Step 3: break cycles. An alternative is used only if its head chain does not lead back to
  // the word (so a fix never creates a new cycle); otherwise the word attaches to the root.
  const heads = chosen.map((c) => (c as Choice).head);
  const leadsBackTo = (word: number, head: number): boolean => {
    const seen = new Set<number>();
    for (let k = head; k !== 0 && !seen.has(k); k = heads[k - 1] ?? 0) {
      if (k - 1 === word) return true;
      seen.add(k);
    }
    return false;
  };
  for (let cycle = findCycle(heads); cycle !== null; cycle = findCycle(heads)) {
    let best: { word: number; choice: Choice } | null = null;
    for (const w of cycle) {
      for (const o of options[w] ?? []) {
        if (o.head === 0 || leadsBackTo(w, o.head)) continue;
        if (best === null || o.prob > best.choice.prob) best = { word: w, choice: o };
      }
    }
    if (best === null) {
      const weakest = cycle.reduce((a, b) => ((chosen[b]?.prob ?? 0) < (chosen[a]?.prob ?? 0) ? b : a));
      best = { word: weakest, choice: { head: root + 1, relation: REPAIR_RELATION, prob: 0, rank: Infinity } };
    }
    chosen[best.word] = best.choice;
    heads[best.word] = best.choice.head;
  }

  const repairedWords = chosen.flatMap((c, i) => ((c as Choice).rank === 0 ? [] : [i]));
  return {
    heads,
    relations: chosen.map((c) => (c as Choice).relation),
    repaired: repairedWords.length > 0,
    repairedWords,
  };
}

// -- nested phrases ---------------------------------------------------------------------

function baseType(upos: string): PhraseType {
  if (NOMINAL_UPOS.has(upos)) return "NP";
  if (upos === "VERB" || upos === "AUX") return "VP";
  if (upos === "ADJ") return "ADJP";
  if (upos === "ADV") return "ADVP";
  return null;
}

type Item = PhraseNode | WordLeaf;

function firstWord(item: Item): number {
  return "word" in item ? item.word : item.start;
}

function covered(item: Item, out: Set<number>): void {
  if ("word" in item) out.add(item.word);
  else for (const c of item.children) covered(c, out);
}

function makeNode(type: PhraseType, head: number, children: Item[]): PhraseNode {
  const sorted = [...children].sort((a, b) => firstWord(a) - firstWord(b));
  const words = new Set<number>();
  for (const c of sorted) covered(c, words);
  const start = Math.min(...words);
  const end = Math.max(...words);
  return { type, head, start, end, contiguous: words.size === end - start + 1, children: sorted };
}

/**
 * Nested phrases of one sentence (see the header for the bracketing order).
 * @param heads 1-based heads (0 = root), a valid tree
 * @param upos UPOS per word
 * @param relations base relation per word
 */
export function buildPhrases(heads: readonly number[], upos: readonly string[], relations: readonly string[]): SentencePhrases {
  const n = heads.length;
  if (n === 0) return [];
  const deps: number[][] = Array.from({ length: n }, () => []);
  let root = -1;
  heads.forEach((h, i) => {
    if (h === 0) root = i;
    else deps[h - 1]?.push(i);
  });
  if (root < 0) throw new Error("tree has no root");
  const isPunct = (i: number): boolean => upos[i] === "PUNCT";

  // Returns the items a word contributes to its parent's level (itself or its phrase, plus loose punctuation).
  const project = (h: number, isRoot: boolean): { phrase: Item; punct: WordLeaf[] } => {
    const all = deps[h] ?? [];
    const punct = all.filter(isPunct).map((word) => ({ word }));
    const real = all.filter((d) => !isPunct(d));
    if (real.length === 0 && !isRoot) return { phrase: { word: h }, punct };

    const type0 = baseType(upos[h] ?? "");
    let node = makeNode(type0, h, [{ word: h }]);
    let hasCase = false;
    const right = real.filter((d) => d > h).sort((a, b) => a - b);
    const left = real.filter((d) => d < h).sort((a, b) => b - a);
    for (const d of [...right, ...left]) {
      const sub = project(d, false);
      if (relations[d] === "case") hasCase = true;
      const type = type0 === "NP" && hasCase ? "PP" : type0;
      node = makeNode(type, h, [node, sub.phrase, ...sub.punct]);
    }
    // A head keeps its punctuation in its outermost phrase; the root's stays outside.
    if (isRoot || punct.length === 0) return { phrase: node, punct };
    return { phrase: makeNode(node.type, h, [...node.children, ...punct]), punct: [] };
  };

  const top = project(root, true);
  return [top.phrase, ...top.punct].sort((a, b) => firstWord(a) - firstWord(b));
}

/** Labeled spans of every bracket (for nested-phrase F1). */
export function phraseSpans(items: SentencePhrases): PhraseSpan[] {
  const out: PhraseSpan[] = [];
  const walk = (item: Item): void => {
    if ("word" in item) return;
    out.push({ type: item.type, start: item.start, end: item.end });
    for (const c of item.children) walk(c);
  };
  for (const it of items) walk(it);
  return out;
}

/** Render brackets for debugging and tests, e.g. "[[The [red [dog]]] barks] ."; labels optional. */
export function bracketString(items: SentencePhrases, words: readonly string[], labels = false): string {
  const render = (item: Item): string => {
    if ("word" in item) return words[item.word] ?? "?";
    const inner = item.children.map(render).join(" ");
    return labels && item.type ? `[${item.type} ${inner}]` : `[${inner}]`;
  };
  return items.map(render).join(" ");
}
