/**
 * src/modules/parser/phraseLabeler.ts — nested phrase role and head labeler
 *
 * Description:
 *   Deterministic post-processor that enriches the nested phrase tree built by
 *   ./treeDecoder.ts with learner-facing grammatical roles (Subject, Predicate,
 *   Object, Indirect Object, Complement, Modifier, etc.), clause vs. predicate
 *   categories (S vs. VP), and explicit head-of-parent markers (isHead). Uses
 *   only the model's predicted dependency tree (heads, relations, UPOS) and
 *   never overrides attachments with hand-written grammar rules.
 *
 * Layer: modules/ (parser). Internal submodule; runs inside parser.worker.ts.
 *
 * Conventions (owner, 2026-11-20; T10):
 *   - Roles: Subject, Predicate, Object, Indirect Object, Complement,
 *     Modifier (adjective/adverb type), plus roles from the kept UD
 *     subtypes: Passive subject (nsubj:pass), Agent (obl:agent, the
 *     "by" phrase), Relative clause (acl:relcl), Possessive (nmod:poss),
 *     Particle (compound:prt).
 *   - Clause: subject + predicate are promoted to S (Clause); the inner
 *     predicate projection is VP(Predicate). Embedded clauses are shown too.
 *   - Single-word head wrappers ([dog] inside [red dog]) are collapsed for
 *     display; treeDecoder.ts spans and the metrics are unchanged.
 *   - Discontinuous predicates (contiguous: false; questions, inversion,
 *     fronted adjuncts): the pieces get the same role label and a "split
 *     predicate" flag; no contiguous bracket is invented.
 *   - Copula: cop + the predicative word form VP(Predicate); the adjective
 *     or noun is labeled Complement (sentence pattern 2).
 *   - Coordination: the outer bracket of the conjoined phrases takes the
 *     shared role; each conjunct is marked as coordinated (never a
 *     modifier of the first conjunct).
 *
 * How labels are found (works on gated phrases too: brackets never change
 * span, only disappear):
 *   - Each head's projections follow treeDecoder.ts's bracketing order (right
 *     dependents closest first, then left closest first); level k covers the
 *     head plus the subtrees of its first k non-punctuation dependents.
 *     Every bracket is matched to its (head, level) by its non-punctuation
 *     words.
 *   - Role: on a dependent's maximal projection (its full subtree), from its
 *     relation (ROLE_BY_RELATION). A word without dependents carries its role
 *     itself.
 *   - Collapsed brackets (owner, 2026-11-21; T59): if the bracket that would
 *     carry a role (maximal projection, predicate, or complement level) was
 *     collapsed by gating, the role goes on the head word as a badge
 *     (badge: true, "phrase boundary uncertain"); it is never moved to an
 *     inner bracket, whose span would be wrong. If several of a word's
 *     brackets collapsed, the outermost role wins.
 *   - Role gate (owner, 2026-11-21; T59): with a RoleGate, a role is shown
 *     only if its head word's confidence (relation probability × head
 *     probability, calibrated) is ≥ labels.json → nested.role_threshold
 *     (fitted in Phase 8 for ≥ 95% role precision on dev).
 *   - S: projections of a head at and above the level where its subject
 *     (nsubj, csubj, incl. :pass) attaches. The level just below is the
 *     predicate: role Predicate (VP(Predicate)).
 *   - Copula: the level where `cop` attaches is a VP; the level below it
 *     (the adjective or noun with its modifiers) is the Complement.
 *   - Split predicate: an aux or cop attached above the subject (questions,
 *     inversion) gets role Predicate and splitPredicate, as does the
 *     predicate level.
 *   - Coordination: `conj` dependents and the coordination head's own
 *     innermost bracket are marked coordinated; `conj` gives no role, so the
 *     outer bracket (the head's maximal projection) carries the shared role.
 *   - A root clause without a subject (imperatives) is the Predicate.
 *
 * Dependencies:
 *   Internal: ./types.ts (SentencePhrases, PhraseNode, PhraseType, PhraseRole,
 *             DecodedTree). External: none.
 *   Input produced by: ./treeDecoder.ts (buildPhrases, decodeArcTree, gatePhrases).
 *   Used by: ./parser.ts, ./ambiguity.ts (alternative trees).
 *
 * Caveats:
 *   - Accuracy is strictly bounded by the neural model's UAS/LAS; wrong
 *     attachments or misclassified relations propagate into wrong roles.
 *   - Biaffine models (labels.json schema v2) predict ten subtypes (owner, 2026-11-19):
 *     nsubj:pass, aux:pass, obl:agent, acl:relcl, nmod:poss, compound:prt,
 *     obl:unmarked, det:predet, advcl:relcl, cc:preconj (plan-training.md →
 *     Nested phrase structure → Head encoding). Rare ones (cc:preconj,
 *     advcl:relcl, det:predet) are less reliable.
 *
 * Open items (todo.md): grammar label language (T18).
 *
 * Status: implemented (T34). Tests: phraseLabeler.test.ts.
 */

import type {
  LabeledPhrase,
  LabeledSentencePhrases,
  LabeledWord,
  PhraseCategory,
  PhraseNode,
  PhraseRole,
  RoleGate,
  SentencePhrases,
  WordLeaf,
} from "./types";

/** Roles by full relation (kept subtypes), checked before ROLE_BY_RELATION. */
export const ROLE_BY_SUBTYPE: Readonly<Record<string, PhraseRole>> = {
  "nsubj:pass": "Passive subject",
  "csubj:pass": "Passive subject",
  "obl:agent": "Agent",
  "acl:relcl": "Relative clause",
  "advcl:relcl": "Relative clause",
  "nmod:poss": "Possessive",
  "compound:prt": "Particle",
};

/** Roles by base relation; relations not listed (det, case, aux, cop, cc, conj, mark, …) give none. */
export const ROLE_BY_RELATION: Readonly<Record<string, PhraseRole>> = {
  nsubj: "Subject",
  csubj: "Subject",
  obj: "Object",
  iobj: "Indirect Object",
  ccomp: "Complement",
  xcomp: "Complement",
  obl: "Modifier",
  nmod: "Modifier",
  amod: "Modifier",
  advmod: "Modifier",
  advcl: "Modifier",
  acl: "Modifier",
  nummod: "Modifier",
};

const SUBJECT_RELATIONS = new Set(["nsubj", "csubj"]);
const AUXILIARY_RELATIONS = new Set(["aux", "cop"]);
const CLAUSE_UPOS = new Set(["VERB", "AUX"]);

const base = (relation: string): string => relation.split(":")[0] ?? relation;

/** Role a relation gives its dependent's maximal projection (null if none). */
export function roleOf(relation: string): PhraseRole | null {
  return ROLE_BY_SUBTYPE[relation] ?? ROLE_BY_RELATION[base(relation)] ?? null;
}

type Item = PhraseNode | WordLeaf;

/** Per-head structure: levels of the bracketing order and the special levels. */
type HeadInfo = {
  /** Non-punctuation dependents in bracketing order. */
  order: number[];
  /** Key (sorted non-punctuation words) of each level 0..order.length. */
  levels: Map<string, number>;
  /** Level where the subject attaches (S from here up), or null. */
  subjectLevel: number | null;
  /** Level where `cop` attaches, or null. */
  copLevel: number | null;
};

const keyOf = (words: Iterable<number>): string => [...words].sort((a, b) => a - b).join(",");

/**
 * Label a sentence's nested phrases (see the header). Pure; spans and order are unchanged.
 * @param items phrases from buildPhrases (optionally gated by gatePhrases)
 * @param heads 1-based heads (0 = root) of the tree the phrases were built from
 * @param relations full relation per word (kept subtypes included)
 * @param upos UPOS per word
 * @param gate optional role confidence gate (T59)
 */
export function labelPhrases(
  items: SentencePhrases,
  heads: readonly number[],
  relations: readonly string[],
  upos: readonly string[],
  gate?: RoleGate,
): LabeledSentencePhrases {
  const n = heads.length;
  const isPunct = (i: number): boolean => upos[i] === "PUNCT";
  const deps: number[][] = Array.from({ length: n }, () => []);
  heads.forEach((h, i) => {
    if (h > 0) deps[h - 1]?.push(i);
  });
  const rel = (i: number): string => relations[i] ?? "dep";

  const subtreeMemo = new Map<number, number[]>();
  const subtree = (i: number): number[] => {
    const hit = subtreeMemo.get(i);
    if (hit) return hit;
    const out = isPunct(i) ? [] : [i];
    for (const d of deps[i] ?? []) out.push(...subtree(d));
    subtreeMemo.set(i, out);
    return out;
  };

  const info: HeadInfo[] = Array.from({ length: n }, (_, h) => {
    const real = (deps[h] ?? []).filter((d) => !isPunct(d));
    const order = [...real.filter((d) => d > h).sort((a, b) => a - b), ...real.filter((d) => d < h).sort((a, b) => b - a)];
    const levels = new Map<string, number>();
    const words = new Set<number>([h]);
    levels.set(keyOf(words), 0);
    order.forEach((d, k) => {
      for (const w of subtree(d)) words.add(w);
      levels.set(keyOf(words), k + 1);
    });
    const at = (pred: (d: number) => boolean): number | null => {
      const k = order.findIndex(pred);
      return k < 0 ? null : k + 1;
    };
    return {
      order,
      levels,
      subjectLevel: at((d) => SUBJECT_RELATIONS.has(base(rel(d)))),
      copLevel: at((d) => base(rel(d)) === "cop"),
    };
  });

  /** Aux/cop dependents attached above the subject: split-predicate pieces. */
  const splitPieces = new Set<number>();
  info.forEach((hi) => {
    if (hi.subjectLevel === null) return;
    hi.order.forEach((d, k) => {
      if (k + 1 > (hi.subjectLevel as number) && AUXILIARY_RELATIONS.has(base(rel(d)))) splitPieces.add(d);
    });
  });
  const isSplit = (h: number): boolean => (deps[h] ?? []).some((d) => splitPieces.has(d));
  const hasConj = (h: number): boolean => (deps[h] ?? []).some((d) => base(rel(d)) === "conj");
  const isConj = (i: number): boolean => base(rel(i)) === "conj";

  /** Role of a word's maximal projection; the root clause without a subject is the Predicate. */
  const maximalRole = (h: number): PhraseRole | null => {
    if (splitPieces.has(h)) return "Predicate";
    if (heads[h] !== 0) return roleOf(rel(h));
    const hi = info[h] as HeadInfo;
    const clause = CLAUSE_UPOS.has(upos[h] ?? "") || hi.copLevel !== null;
    return clause && hi.subjectLevel === null ? "Predicate" : null;
  };

  const coveredWords = (item: Item, out: number[]): number[] => {
    if ("word" in item) {
      if (!isPunct(item.word)) out.push(item.word);
    } else for (const c of item.children) coveredWords(c, out);
    return out;
  };
  const levelOf = (node: PhraseNode): number | null =>
    (info[node.head] as HeadInfo).levels.get(keyOf(coveredWords(node, []))) ?? null;
  const shown = (role: PhraseRole | null, word: number): PhraseRole | null =>
    role !== null && (!gate || (gate.confidence[word] ?? 0) >= gate.threshold) ? role : null;

  /** Role-bearing levels of a head, outermost first: maximal projection, predicate, complement. */
  const roleLevels = (h: number): Array<[number, PhraseRole | null]> => {
    const hi = info[h] as HeadInfo;
    const out: Array<[number, PhraseRole | null]> = [[hi.order.length, maximalRole(h)]];
    if (hi.subjectLevel !== null) out.push([hi.subjectLevel - 1, "Predicate"]);
    const copSplit = hi.copLevel !== null && hi.subjectLevel !== null && hi.copLevel > hi.subjectLevel;
    if (hi.copLevel !== null && !copSplit) out.push([hi.copLevel - 1, "Complement"]);
    return out;
  };
  const present = new Set<string>();
  const collect = (item: Item): void => {
    if ("word" in item) return;
    present.add(`${item.head}:${levelOf(item)}`);
    item.children.forEach(collect);
  };
  items.forEach(collect);
  /** Badge role per head word whose role-bearing bracket is missing (collapsed). */
  const badgeRole = (h: number): PhraseRole | null => {
    if ((info[h] as HeadInfo).order.length === 0) return null;
    for (const [level, role] of roleLevels(h)) if (role !== null && !present.has(`${h}:${level}`)) return role;
    return null;
  };

  const labelWord = (leaf: WordLeaf, parentHead: number | null): LabeledWord => {
    const w = leaf.word;
    const isHead = parentHead === w;
    const ownProjection = !isHead && !isPunct(w) && subtree(w).length === 1;
    const badge = isHead && !isPunct(w) ? badgeRole(w) : null;
    const role = shown(ownProjection ? maximalRole(w) : badge, w);
    return {
      word: w,
      role,
      isHead,
      coordinated: !isPunct(w) && isConj(w) && !isHead,
      splitPredicate: !isHead && splitPieces.has(w),
      badge: badge !== null && role !== null,
    };
  };

  const labelNode = (node: PhraseNode, parentHead: number | null): LabeledPhrase => {
    const h = node.head;
    const hi = info[h] as HeadInfo;
    const level = levelOf(node);
    const top = hi.order.length;
    const sub = hi.subjectLevel;
    const predLevel = sub === null ? null : sub - 1;
    let category: PhraseCategory = node.type;
    if (level !== null && sub !== null && level >= sub) category = "S";
    else if (level !== null && hi.copLevel !== null && level >= hi.copLevel) category = "VP";

    const copSplit = hi.copLevel !== null && sub !== null && hi.copLevel > sub;
    let role: PhraseRole | null = null;
    let splitPredicate = false;
    if (level === top) role = maximalRole(h);
    else if (level !== null && level === predLevel) {
      role = "Predicate";
      splitPredicate = isSplit(h);
    } else if (level !== null && hi.copLevel !== null && !copSplit && level === hi.copLevel - 1) role = "Complement";
    return {
      type: node.type,
      head: h,
      start: node.start,
      end: node.end,
      contiguous: node.contiguous,
      category,
      role: shown(role, h),
      isHead: parentHead === h,
      coordinated: (level === top && isConj(h) && parentHead !== h) || (level === 0 && hasConj(h)),
      splitPredicate,
      badge: false,
      wrapper: node.start === node.end && parentHead === h,
      children: node.children.map((c) => ("word" in c ? labelWord(c, h) : labelNode(c, h))),
    };
  };

  return items.map((it) => ("word" in it ? labelWord(it, null) : labelNode(it, null)));
}
