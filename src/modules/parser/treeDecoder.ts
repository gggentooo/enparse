/**
 * src/modules/parser/treeDecoder.ts — arc scores → dependency tree → nested phrases
 *
 * Description:
 *   Turns the model's structure output into a valid dependency tree per
 *   sentence, then into nested phrases for the nested view, and scores each
 *   bracket's confidence. Fixed decoding procedure only; no grammar rules
 *   (plan-training.md → Nested phrase structure). Also run by training
 *   (nested-phrase F1, Phase 8 gating via tsx), so training and the app share
 *   one implementation.
 *
 * Layer: modules/ (parser)
 *
 * Decoding, biaffine models (decodeArcTree; labels.json schema v2; T45):
 *   1. Input: one sentence's word-level arc scores (row i = word i; column 0
 *      = root, column j = word j) read from `arc_scores` at first-subword
 *      positions, and relation candidates per word. Each row is turned into
 *      log-probabilities over the sentence's words plus the root (no self).
 *   2. The best projective tree (no crossing arcs; Eisner's algorithm) with
 *      exactly one word attached to the root (see Projective decoding
 *      below). Fallback: maximum spanning tree (Chu-Liu-Edmonds) with one
 *      root child. The result is always a valid tree; no repair is needed.
 *   3. Relation: "root" for the root word; otherwise the best candidate that
 *      is not "root" ("dep" if there is none).
 *   4. headProbs: probability of the chosen head per word (for gating);
 *      headDist: each word's probabilities over the root and the words;
 *      relationProbs: probability of the chosen relation (role gating, T59;
 *      0 when "root" was forced without a root candidate, or for "dep");
 *      repairedWords: words whose tree head is not their argmax head.
 *
 * Confidence gating (spanConfidence; Phase 8; owner, 2026-11-23, T73/T78):
 *   A bracket's confidence estimates "these words are one phrase" from every
 *   word's head distribution (headDist): a word inside whose chosen head is
 *   inside counts with P(head inside); a word inside whose chosen head is
 *   outside (the phrase's head word) and a word outside whose chosen head is
 *   outside count with P(head outside); outside words attached into the
 *   bracket (a subject next to its predicate) and punctuation do not count.
 *   An unsure attachment therefore lowers only the brackets whose boundary it
 *   could move. Brackets below the model's threshold (labels.json →
 *   nested.bracket_threshold) are collapsed after labeling
 *   (phraseLabeler.ts → gateLabeled).
 *
 * Decoding, schema v1 models (decodeTree; rel_pos_v1 head labels; kept so the
 * Phase 7 base and extended results stay reproducible; not used by the app):
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
 * Nested phrases (buildPhrases; owner, 2026-11-23, T73; plan-training.md →
 * Nested phrase structure → Decoding):
 *   One bracket per phrase: a head word with all its dependents in word
 *   order. A dependent without dependents stays a plain word; a dependent
 *   with dependents is its own bracket. Levels (PhraseNode.level):
 *   - clause: a head with a subject → the subject plus the predicate
 *     bracket; dependents on the other side of the subject, parataxis, and
 *     clausal conjuncts stay in the clause bracket outside the predicate.
 *     A main clause (the root's, and clauses coordinated with it) has no
 *     clause bracket (owner, 2026-11-23, T82): its subject bracket and its
 *     predicate bracket are top-level items, always present even for one
 *     word (`pinned`), beside its other words.
 *   - A preposition before a coordination of nouns covers the coordination
 *     (T93): [as [[water vapor] or [ice]]], when no later conjunct has its own.
 *   - conjunct: coordination is shown side by side, [[A] and [B]] (T82): the
 *     head's dependents before the first conjunct belong to the first
 *     conjunct, which gets its own bracket (level "conjunct") if it has any;
 *     the other conjuncts follow, each with its leading conjunction (`cc`)
 *     and punctuation outside its bracket; the head's later dependents are
 *     shared by the coordination. One-word conjuncts stay plain words.
 *   - predicate: the head and its other dependents (not bracketed if it is
 *     one word).
 *   - complement: with a copula before the head, the head and its dependents
 *     after the copula / auxiliaries / subject (not bracketed if one word).
 *   - phrase: any other head with dependents.
 *   Punctuation is not bracketed: it sits in the innermost bracket of its
 *   head that surrounds it, else in its head's phrase (the root's stays
 *   outside all brackets). Labels come from the head: NOUN/PROPN/PRON/NUM →
 *   NP (PP with a `case` dependent), VERB/AUX → VP, ADJ → ADJP, ADV → ADVP,
 *   other → null; predicates and subjectless phrases with a copula → VP.
 *   Examples: "The red dog rarely barks loudly ." →
 *             [The red dog] [rarely barks loudly] .
 *             "Mackerel is a common name given to fish ." →
 *             [Mackerel] [is [a common name [given [to fish]]]] .
 *             "She likes red apples and green pears" →
 *             [She] [likes [[red apples] and [green pears]]]
 *
 * Projective decoding (projectiveTree; T82, adopted T83): decodeArcTree
 *   takes the best tree without crossing arcs (Eisner), which keeps
 *   attachments consistent with each other (a phrase is never split by
 *   words attached elsewhere); the spanning tree is the fallback when no
 *   projective tree has a finite score (constrained alternatives). Measured
 *   on the stored predictions (training/js/projective_eval.mjs): dev UAS
 *   −0.04 (DeBERTa-v3-xsmall) and +0.06 (ModernBERT) points, test +0.03 and
 *   +0.08. Turned on for both models by the owner (2026-11-23).
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none.
 *   Used by: ./parser.ts, ./ambiguity.ts (followed by ./phraseLabeler.ts for
 *            grammatical role, clause/predicate, and head-of-parent labeling);
 *            training/js (nested-phrase F1 via tsx, plan-training.md → Phase 7).
 *
 * Status: implemented (rel_pos_v1 decoding Phase 7; MST decoding T45; phrase-per-head
 *   brackets and span confidence T75, T78; main-clause and coordination brackets T82).
 *   Tests: treeDecoder.test.ts.
 */

import type {
  ArcScores,
  DecodedTree,
  DepCandidate,
  RelationCandidate,
  PhraseLevel,
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
  if (n === 0)
    return { heads: [], relations: [], repaired: false, repairedWords: [], headProbs: [], relationProbs: [] };

  const options: Choice[][] = candidates.map((cands, i) =>
    cands.flatMap((c, rank) => {
      const head = resolveHead(c.label, upos, i);
      return head === null || head === i + 1
        ? []
        : [{ head, relation: parseDepLabel(c.label).relation, prob: c.prob, rank }];
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
    headProbs: chosen.map((c) => (c as Choice).prob),
    // rel_pos_v1 labels give head and relation jointly: the label probability is in headProbs.
    relationProbs: chosen.map(() => 1),
  };
}

// -- MST decoding (biaffine models) -----------------------------------------------------

/** Relation of the root word. */
export const ROOT_RELATION = "root";

/** Head per node of a graph whose node 0 is the root: argmax of score[d][h] over h ≠ d. */
function greedyHeads(score: number[][]): number[] {
  const n = score.length;
  const heads = new Array<number>(n).fill(-1);
  for (let d = 1; d < n; d++) {
    let best = -1;
    let value = -Infinity;
    const row = score[d] as number[];
    for (let h = 0; h < n; h++) {
      if (h !== d && (row[h] as number) > value) {
        value = row[h] as number;
        best = h;
      }
    }
    heads[d] = best;
  }
  return heads;
}

/** Nodes of one cycle in a head array (node 0 = root, heads[0] = -1), or null. */
function cycleOf(heads: number[]): number[] | null {
  const n = heads.length;
  const state = new Array<number>(n).fill(0);
  for (let s = 1; s < n; s++) {
    if (state[s] !== 0) continue;
    const path: number[] = [];
    let k = s;
    while (k > 0 && state[k] === 0) {
      state[k] = 1;
      path.push(k);
      k = heads[k] as number;
    }
    if (k > 0 && state[k] === 1) return path.slice(path.indexOf(k));
    for (const p of path) state[p] = 2;
  }
  return null;
}

/** Chu-Liu-Edmonds maximum spanning arborescence rooted at node 0; score[d][h], heads[0] = -1. */
function chuLiuEdmonds(score: number[][]): number[] {
  const heads = greedyHeads(score);
  const cycle = cycleOf(heads);
  if (cycle === null) return heads;
  const inCycle = new Set(cycle);
  const keep = heads.map((_, v) => v).filter((v) => !inCycle.has(v));
  const index = new Map(keep.map((v, i) => [v, i]));
  const c = keep.length; // the contracted node
  const m = c + 1;
  const sub = Array.from({ length: m }, () => new Array<number>(m).fill(-Infinity));
  const enter = new Array<number>(m).fill(-1); // head h (new index) → cycle node it enters
  const leave = new Array<number>(m).fill(-1); // dependent d (new index) → cycle node it hangs on
  const kept = (v: number): number => score[v]?.[heads[v] as number] as number;
  for (const d of keep) {
    if (d === 0) continue;
    const di = index.get(d) as number;
    const row = score[d] as number[];
    for (const h of keep) if (h !== d) (sub[di] as number[])[index.get(h) as number] = row[h] as number;
    for (const v of cycle) {
      if ((row[v] as number) > ((sub[di] as number[])[c] as number)) {
        (sub[di] as number[])[c] = row[v] as number;
        leave[di] = v;
      }
    }
  }
  for (const h of keep) {
    const hi = index.get(h) as number;
    for (const v of cycle) {
      const gain = (score[v]?.[h] as number) - kept(v);
      if (gain > ((sub[c] as number[])[hi] as number)) {
        (sub[c] as number[])[hi] = gain;
        enter[hi] = v;
      }
    }
  }
  const subHeads = chuLiuEdmonds(sub);
  const out = heads.slice();
  for (const d of keep) {
    if (d === 0) continue;
    const h = subHeads[index.get(d) as number] as number;
    out[d] = h === c ? (leave[index.get(d) as number] as number) : (keep[h] as number);
  }
  const hc = subHeads[c] as number;
  out[enter[hc] as number] = keep[hc] as number;
  return out;
}

function treeScore(score: number[][], heads: number[]): number {
  let total = 0;
  for (let d = 1; d < heads.length; d++) total += score[d]?.[heads[d] as number] as number;
  return total;
}

/** Maximum spanning tree with exactly one root child (node 0 = root). */
export function maxSpanningTree(score: number[][]): number[] {
  const heads = chuLiuEdmonds(score);
  const rootKids = heads.flatMap((h, d) => (d > 0 && h === 0 ? [d] : []));
  if (rootKids.length <= 1) return heads;
  let best: number[] = heads;
  let bestScore = -Infinity;
  for (const r of rootKids) {
    const only = score.map((row, d) => (d === 0 || d === r ? row : row.map((v, h) => (h === 0 ? -Infinity : v))));
    const candidate = chuLiuEdmonds(only);
    const value = treeScore(score, candidate);
    if (value > bestScore) {
      bestScore = value;
      best = candidate;
    }
  }
  return best;
}

/**
 * Best projective tree (no crossing arcs) with exactly one root child: Eisner's algorithm over
 * the words, then the best root word. Same input as maxSpanningTree (node 0 = root; score[d][h]).
 * Returns null if no projective tree has a finite score.
 */
export function projectiveTree(score: number[][]): number[] | null {
  const n = score.length - 1;
  if (n <= 0) return [-1];
  // Words 0..n-1 here; s(h, d) = score[d + 1][h + 1].
  const s = (h: number, d: number): number => score[d + 1]?.[h + 1] as number;
  const at = (i: number, j: number): number => i * n + j;
  // Complete (C) and incomplete (I) spans; L = head at the right end, R = head at the left end.
  const CL = new Float64Array(n * n).fill(-Infinity);
  const CR = new Float64Array(n * n).fill(-Infinity);
  const IL = new Float64Array(n * n).fill(-Infinity);
  const IR = new Float64Array(n * n).fill(-Infinity);
  const bCL = new Int32Array(n * n);
  const bCR = new Int32Array(n * n);
  const bI = new Int32Array(n * n);
  for (let i = 0; i < n; i++) {
    CL[at(i, i)] = 0;
    CR[at(i, i)] = 0;
  }
  for (let len = 1; len < n; len++) {
    for (let i = 0; i + len < n; i++) {
      const j = i + len;
      let best = -Infinity;
      let arg = i;
      for (let k = i; k < j; k++) {
        const v = (CR[at(i, k)] as number) + (CL[at(k + 1, j)] as number);
        if (v > best) {
          best = v;
          arg = k;
        }
      }
      bI[at(i, j)] = arg;
      IL[at(i, j)] = best + s(j, i);
      IR[at(i, j)] = best + s(i, j);
      best = -Infinity;
      arg = i;
      for (let k = i; k < j; k++) {
        const v = (CL[at(i, k)] as number) + (IL[at(k, j)] as number);
        if (v > best) {
          best = v;
          arg = k;
        }
      }
      CL[at(i, j)] = best;
      bCL[at(i, j)] = arg;
      best = -Infinity;
      arg = j;
      for (let k = i + 1; k <= j; k++) {
        const v = (IR[at(i, k)] as number) + (CR[at(k, j)] as number);
        if (v > best) {
          best = v;
          arg = k;
        }
      }
      CR[at(i, j)] = best;
      bCR[at(i, j)] = arg;
    }
  }
  let root = -1;
  let total = -Infinity;
  for (let r = 0; r < n; r++) {
    const v = (CL[at(0, r)] as number) + (CR[at(r, n - 1)] as number) + (score[r + 1]?.[0] as number);
    if (v > total) {
      total = v;
      root = r;
    }
  }
  if (root < 0 || !Number.isFinite(total)) return null;
  const heads = new Array<number>(n + 1).fill(-1);
  heads[root + 1] = 0;
  // Spans to expand: [i, j, kind] with kind 0 = CL, 1 = CR, 2 = IL, 3 = IR.
  const stack: [number, number, number][] = [
    [0, root, 0],
    [root, n - 1, 1],
  ];
  while (stack.length > 0) {
    const [i, j, kind] = stack.pop() as [number, number, number];
    if (i === j) continue;
    if (kind === 0) {
      const k = bCL[at(i, j)] as number;
      stack.push([i, k, 0], [k, j, 2]);
    } else if (kind === 1) {
      const k = bCR[at(i, j)] as number;
      stack.push([i, k, 3], [k, j, 1]);
    } else {
      if (kind === 2) heads[i + 1] = j + 1;
      else heads[j + 1] = i + 1;
      const k = bI[at(i, j)] as number;
      stack.push([i, k, 1], [k + 1, j, 0]);
    }
  }
  return heads;
}

/** Row-wise log-softmax over all columns except the word itself (column i + 1). */
export function headLogProbs(arc: ArcScores): number[][] {
  return arc.map((row, i) => {
    let max = -Infinity;
    row.forEach((v, j) => {
      if (j !== i + 1 && v > max) max = v;
    });
    let sum = 0;
    row.forEach((v, j) => {
      if (j !== i + 1) sum += Math.exp(v - max);
    });
    const log = Math.log(sum) + max;
    return row.map((v, j) => (j === i + 1 ? -Infinity : v - log));
  });
}

/**
 * Decode one sentence with MST over arc scores (biaffine models; see the header).
 * @param arc n rows of n + 1 scores (column 0 = root, column j = word j); any scale (normalized per row)
 * @param relations relation candidates per word, best first
 */
export function decodeArcTree(arc: ArcScores, relations: readonly (readonly RelationCandidate[])[]): DecodedTree {
  const n = arc.length;
  if (relations.length !== n) throw new Error("arc scores and relations lengths differ");
  if (n === 0)
    return {
      heads: [],
      relations: [],
      repaired: false,
      repairedWords: [],
      headProbs: [],
      relationProbs: [],
      headDist: [],
    };
  arc.forEach((row, i) => {
    if (row.length !== n + 1) throw new Error(`arc row ${i} has ${row.length} columns, expected ${n + 1}`);
  });
  const logp = headLogProbs(arc);
  // Graph nodes: 0 = root, 1..n = words; score[d][h].
  const score = [new Array<number>(n + 1).fill(-Infinity), ...logp];
  // Best tree without crossing arcs (owner, 2026-11-23); the spanning tree if none is possible.
  const tree = (projectiveTree(score) ?? maxSpanningTree(score)).slice(1);
  const greedy = greedyHeads(score).slice(1);
  const picked = tree.map((h, i): RelationCandidate => {
    const cands = relations[i] ?? [];
    if (h === 0) return { relation: ROOT_RELATION, prob: cands.find((c) => c.relation === ROOT_RELATION)?.prob ?? 0 };
    return cands.find((c) => c.relation !== ROOT_RELATION) ?? { relation: REPAIR_RELATION, prob: 0 };
  });
  const rels = picked.map((c) => c.relation);
  const repairedWords = tree.flatMap((h, i) => (h === greedy[i] ? [] : [i]));
  return {
    heads: tree,
    relations: rels,
    repaired: repairedWords.length > 0,
    repairedWords,
    headProbs: tree.map((h, i) => Math.exp(logp[i]?.[h] as number)),
    relationProbs: picked.map((c) => c.prob),
    headDist: logp.map((row) => row.map((lp) => Math.exp(lp))),
  };
}

// -- confidence gating -------------------------------------------------------------------

function covered(item: Item, out: Set<number>): void {
  if ("word" in item) out.add(item.word);
  else for (const c of item.children) covered(c, out);
}

/**
 * Confidence that a bracket's words form one phrase (see the header). Each word counts with
 * the probability that its head stays on the side of the bracket (inside or outside) where
 * its chosen head is; outside words attached into the bracket and skipped words (punctuation)
 * do not count.
 * @param node the bracket (any object with children; labeled phrases too)
 * @param tree the decoded model tree (heads, headProbs, and headDist for biaffine models)
 * @param skip words to ignore (punctuation)
 */
export function spanConfidence(
  node: { children: readonly Item[] } | Item,
  tree: Pick<DecodedTree, "heads" | "headProbs" | "headDist">,
  skip: (word: number) => boolean = () => false,
): number {
  const inside = new Set<number>();
  covered(node as Item, inside);
  let p = 1;
  tree.heads.forEach((h, w) => {
    if (skip(w)) return;
    const wIn = inside.has(w);
    const headIn = h > 0 && inside.has(h - 1);
    if (!wIn && headIn) return;
    const dist = tree.headDist?.[w];
    if (!dist) {
      // No distribution (rel_pos_v1 trees): the chosen head's probability bounds the side's.
      if (wIn) p *= tree.headProbs[w] ?? 0;
      return;
    }
    let massIn = 0;
    for (const i of inside) massIn += dist[i + 1] ?? 0;
    p *= headIn ? massIn : 1 - massIn;
  });
  return Math.max(0, Math.min(1, p));
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

function makeNode(type: PhraseType, head: number, level: PhraseLevel, children: Item[]): PhraseNode {
  const sorted = [...children].sort((a, b) => firstWord(a) - firstWord(b));
  const words = new Set<number>();
  for (const c of sorted) covered(c, words);
  const start = Math.min(...words);
  const end = Math.max(...words);
  return { type, head, level, start, end, contiguous: words.size === end - start + 1, children: sorted };
}

const SUBJECT_RELATIONS = new Set(["nsubj", "csubj"]);
const AUXILIARY_RELATIONS = new Set(["aux", "cop"]);
/** Right dependents that belong to the clause, not to the complement of a copula. */
const CLAUSE_LEVEL_RELATIONS = new Set(["advcl", "parataxis"]);

/** How one head's dependents are grouped into brackets (shared with phraseLabeler.ts). */
export type HeadLayout = {
  /** Non-punctuation dependents, in word order. */
  real: number[];
  punct: number[];
  /**
   * Leading conjunctions (`cc` before the head and before its other dependents): shown before
   * the head's phrase, not inside it ("[A] and [B]"). Not in the lists below.
   */
  lead: number[];
  /** The subject that splits the clause, or null. */
  subject: number | null;
  /** A copula before the head, or null. */
  cop: number | null;
  /** Dependents inside the complement bracket (empty: the complement is the head word alone). */
  complement: number[];
  /** Dependents in the predicate bracket (without a subject: the phrase) besides the complement's. */
  predicate: number[];
  /** Clause-level dependents outside the predicate, besides the subject. */
  outside: number[];
  /** Dependents in `outside` that are clauses of their own (conjunct with a subject, parataxis with one). */
  clauses: number[];
};

/**
 * Layout of every head of a tree (see the header → Nested phrases).
 * @param heads 1-based heads (0 = root)
 * @param upos UPOS per word
 * @param relations base relation per word
 */
export function headLayouts(
  heads: readonly number[],
  upos: readonly string[],
  relations: readonly string[],
): HeadLayout[] {
  const n = heads.length;
  const deps: number[][] = Array.from({ length: n }, () => []);
  heads.forEach((h, i) => {
    if (h > 0) deps[h - 1]?.push(i);
  });
  const rel = (i: number): string => relations[i] ?? "dep";
  const isPunct = (i: number): boolean => upos[i] === "PUNCT";
  const isSubject = (i: number): boolean => SUBJECT_RELATIONS.has(rel(i));
  const hasSubject = (d: number): boolean => (deps[d] ?? []).some((x) => isSubject(x));
  /** A conjunct or parataxis that is a clause of its own. */
  const clausal = (d: number): boolean => rel(d) === "parataxis" || (rel(d) === "conj" && hasSubject(d));
  return deps.map((all, h) => {
    const real = all.filter((d) => !isPunct(d));
    const punct = all.filter(isPunct);
    const lead: number[] = [];
    for (const d of real) {
      if (d < h && rel(d) === "cc" && (deps[d] ?? []).every(isPunct)) lead.push(d);
      else break;
    }
    const inner = real.slice(lead.length);
    const subjects = inner.filter(isSubject);
    // The nearest subject before the head, else the nearest after it.
    const subject = subjects.filter((d) => d < h).at(-1) ?? subjects[0] ?? null;
    const cop = inner.filter((d) => d < h && rel(d) === "cop").at(-1) ?? null;
    let complement: number[] = [];
    if (cop !== null) {
      const fence = Math.max(cop, ...inner.filter((d) => d < h && (AUXILIARY_RELATIONS.has(rel(d)) || d === subject)));
      complement = inner.filter(
        (d) =>
          d > fence &&
          d !== subject &&
          !AUXILIARY_RELATIONS.has(rel(d)) &&
          !(d > h && (CLAUSE_LEVEL_RELATIONS.has(rel(d)) || clausal(d))),
      );
    }
    const inComplement = new Set(complement);
    const rest = inner.filter((d) => d !== subject && !inComplement.has(d));
    if (subject === null) {
      return { real, punct, lead, subject, cop, complement, predicate: rest, outside: [], clauses: [] };
    }
    const sameSide = (d: number): boolean => (subject < h ? d > subject : d < subject);
    const outside = rest.filter((d) => !sameSide(d) || (d > h && subject < h && clausal(d)));
    const isOutside = new Set(outside);
    return {
      real,
      punct,
      lead,
      subject,
      cop,
      complement,
      predicate: rest.filter((d) => !isOutside.has(d)),
      outside,
      clauses: outside.filter((d) => d > h && clausal(d) && hasSubject(d)),
    };
  });
}

/**
 * Nested phrases of one sentence (see the header for the bracketing rule).
 * @param heads 1-based heads (0 = root), a valid tree
 * @param upos UPOS per word
 * @param relations base relation per word
 */
export function buildPhrases(
  heads: readonly number[],
  upos: readonly string[],
  relations: readonly string[],
): SentencePhrases {
  const n = heads.length;
  if (n === 0) return [];
  const root = heads.indexOf(0);
  if (root < 0) throw new Error("tree has no root");
  const layouts = headLayouts(heads, upos, relations);
  const isConj = (d: number): boolean => relations[d] === "conj";
  /** First word of a word's subtree (leading conjunctions included). */
  const firstOf = (w: number): number => Math.min(w, ...(layouts[w] as HeadLayout).real.map(firstOf));

  /**
   * Items a word contributes to its parent's bracket, in word order: its phrase (or the word),
   * with its leading conjunctions and the punctuation it could not place around it. A main
   * clause (the root's, and clauses coordinated with it) has no bracket of its own: it gives
   * its subject bracket, its predicate bracket, and its other words.
   */
  const project = (h: number, main: boolean): Item[] => {
    const lay = layouts[h] as HeadLayout;
    const lead: Item[] = lay.lead.map((word) => ({ word }));
    let loose: WordLeaf[] = lay.punct.map((word) => ({ word }));
    if (lay.real.length === lay.lead.length) return [...lead, { word: h }, ...loose];

    const type0 = baseType(upos[h] ?? "");
    const hasCase = (ds: readonly number[]): boolean => ds.some((d) => relations[d] === "case");
    const nominal = (ds: readonly number[]): PhraseType => (type0 === "NP" && hasCase(ds) ? "PP" : type0);
    const items = (ds: readonly number[]): Item[] => ds.flatMap((d) => project(d, false));
    /** A bracket of this head; takes the head's punctuation that lies between its words. */
    const layer = (type: PhraseType, level: PhraseLevel, children: Item[]): PhraseNode => {
      const bare = makeNode(type, h, level, children);
      const own = loose.filter((p) => p.word > bare.start && p.word < bare.end);
      if (own.length === 0) return bare;
      loose = loose.filter((p) => !own.includes(p));
      return makeNode(type, h, level, [...children, ...own]);
    };
    /**
     * One level of this head: `core` with dependents `ds`. Coordination ("A and B"): every
     * conjunct is its own bracket, also a one-word one (owner, T92): the dependents before the
     * first conjunct belong to the first conjunct; later dependents are shared by the
     * coordination; conjunctions and commas stay between the brackets.
     */
    const group = (type: (ds: readonly number[]) => PhraseType, level: PhraseLevel, core: Item, ds: number[]): Item => {
      if (ds.length === 0) return core;
      const conjuncts = ds.filter(isConj);
      if (conjuncts.length === 0) return layer(type(ds), level, [core, ...items(ds)]);
      const start = Math.min(...conjuncts.map(firstOf));
      const before = ds.filter((d) => !isConj(d) && d < start);
      const shared = ds.filter((d) => !isConj(d) && d > start);
      // A preposition before a coordination of nouns covers the whole coordination (owner, T93):
      // "as water vapor or ice" → [as [[water vapor] or [ice]]]. UD attaches it to the first
      // conjunct only; it is shared when the head and every later conjunct are nouns and no later
      // conjunct has its own preposition ("in A or on B" keeps each one with its conjunct).
      const prepositions: number[] = [];
      for (const d of before) {
        if (relations[d] === "case") prepositions.push(d);
        else break;
      }
      const sharable =
        prepositions.length > 0 &&
        NOMINAL_UPOS.has(upos[h] ?? "") &&
        conjuncts.every(
          (c) =>
            NOMINAL_UPOS.has(upos[c] ?? "") && !(layouts[c] as HeadLayout).real.some((x) => relations[x] === "case"),
        );
      const mine = sharable ? before.filter((d) => !prepositions.includes(d)) : before;
      const first = mine.length > 0 || "word" in core ? layer(type(mine), "conjunct", [core, ...items(mine)]) : core;
      if (!sharable) return layer(type(ds), level, [first, ...conjunctItems(conjuncts), ...items(shared)]);
      const coordination = layer(type([]), "phrase", [first, ...conjunctItems(conjuncts)]);
      return layer(type(ds), level, [...items(prepositions), coordination, ...items(shared)]);
    };
    /** Items of the other conjuncts, a one-word conjunct wrapped in its own bracket (T92). */
    const conjunctItems = (ds: readonly number[]): Item[] =>
      ds.flatMap((d) =>
        project(d, false).map((item) =>
          "word" in item && item.word === d ? makeNode(baseType(upos[d] ?? ""), d, "conjunct", [item]) : item,
        ),
      );

    const core = group(nominal, "complement", { word: h }, lay.complement);
    const verbal = (ds: readonly number[]): PhraseType => (lay.cop !== null ? "VP" : nominal(ds));
    if (lay.subject === null) {
      const outer = group(verbal, "phrase", core, lay.predicate) as PhraseNode;
      // Punctuation at the phrase's edge: inside the phrase, except a main clause's and a conjunct's leading one.
      const before = main || isConj(h) ? loose.filter((p) => p.word < outer.start) : [];
      const after = main ? loose.filter((p) => p.word > outer.end) : [];
      const edge = loose.filter((p) => !before.includes(p) && !after.includes(p));
      const phrase = edge.length > 0 ? makeNode(outer.type, h, outer.level, [...outer.children, ...edge]) : outer;
      return [...lead, ...before, phrase, ...after];
    }
    const predicate = group(verbal, "predicate", core, lay.predicate);
    const subject = project(lay.subject, false);
    const clauses = new Set(lay.clauses);
    if (main) {
      // No clause bracket: the subject and the predicate are always bracketed, even as single words.
      const pin = (item: Item, type: PhraseType, level: PhraseLevel, head: number): PhraseNode => ({
        ...("word" in item ? makeNode(type, head, level, [item]) : item),
        pinned: true,
      });
      const subjectHead = lay.subject;
      const pinnedSubject = subject.map((item) =>
        ("word" in item ? item.word : item.head) === subjectHead
          ? pin(item, baseType(upos[subjectHead] ?? ""), "phrase", subjectHead)
          : item,
      );
      const rest = lay.outside.flatMap((d) => project(d, clauses.has(d)));
      const all = [...lead, pin(predicate, verbal(lay.predicate), "predicate", h), ...pinnedSubject, ...rest, ...loose];
      return all.sort((a, b) => firstWord(a) - firstWord(b));
    }
    const outer = layer(type0, "clause", [predicate, ...subject, ...items(lay.outside)]);
    const before = isConj(h) ? loose.filter((p) => p.word < outer.start) : [];
    const edge = loose.filter((p) => !before.includes(p));
    const phrase = edge.length > 0 ? makeNode(outer.type, h, outer.level, [...outer.children, ...edge]) : outer;
    return [...lead, ...before, phrase];
  };

  return project(root, true).sort((a, b) => firstWord(a) - firstWord(b));
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
