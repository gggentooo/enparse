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
 * Conventions (owner, 2026-11-20, T10; brackets and attachments 2026-11-23, T73):
 *   - Roles: Subject, Predicate, Object, Indirect Object, Complement,
 *     Modifier (adjective/adverb type), plus roles from the kept UD
 *     subtypes: Passive subject (nsubj:pass), Agent (obl:agent, the
 *     "by" phrase), Relative clause (acl:relcl), Possessive (nmod:poss),
 *     Particle (compound:prt). Quantity words shown as quantifiers
 *     (quantifiers.ts) are Modifiers.
 *   - Clause: a clause bracket is S; its predicate bracket is VP(Predicate).
 *     A main clause (the root's, and clauses coordinated with it) has no S
 *     bracket: its subject and predicate brackets are the outermost ones
 *     and are always shown (pinned; owner, 2026-11-23, T82). Embedded
 *     clauses keep their S bracket.
 *   - Copula: the complement bracket (or the one predicative word) is the
 *     Complement (sentence pattern 2); it attaches to the subject.
 *   - Split predicate: an aux or cop on the other side of the subject
 *     (questions, inversion) gets role Predicate and splitPredicate, as does
 *     the predicate bracket or word; no contiguous bracket is invented.
 *   - Coordination ([[A] and [B]]; T82): the bracket around the conjuncts
 *     takes the shared role; each conjunct (the first one's own bracket has
 *     level "conjunct") is marked as coordinated, never a modifier of the
 *     first conjunct; "and" and commas sit between them.
 *
 * How labels are found (labelPhrases runs on the full phrases of the
 * displayed tree; treeDecoder.ts → headLayouts gives each head's grouping):
 *   - Role: on a dependent's outermost bracket, from its relation
 *     (ROLE_BY_RELATION). A word without dependents carries its role itself.
 *     A root clause without a subject (imperatives) is the Predicate.
 *   - Inner brackets of the same head: level "predicate" → Predicate, level
 *     "complement" → Complement. A head word that is the whole predicate or
 *     complement carries that role itself.
 *   - Attachment (attachTo): each dependent's outermost bracket or word
 *     records the word it attaches to (its head in the displayed tree; a
 *     subject points to the copula if there is one; a complement to the
 *     subject). `uncertain` if the role gate fails.
 *   - Attachment span (attachFrom; owner, 2026-11-23, T81): a modifier
 *     before its head (det, amod, nummod, compound, nmod, advmod, quantifier)
 *     in the same bracket modifies everything from just after itself through
 *     the head word, in noun and verb phrases alike: in "the big red dog",
 *     the → "big red dog", big → "red dog", red → "dog". The span stops at
 *     the head word. Other dependents attach to the one word
 *     (attachFrom = attachTo).
 *   - Role gate (owner, 2026-11-21; T59): with a RoleGate, a role is shown
 *     only if its head word's confidence (relation probability × head
 *     probability, calibrated) is ≥ labels.json → nested.role_threshold
 *     (fitted in Phase 8 for ≥ 95% role precision on dev).
 *   - Collapsed brackets (gateLabeled; owner, 2026-11-21, T59; span
 *     confidence 2026-11-23, T78): a multi-word bracket whose span confidence
 *     is below nested.bracket_threshold is removed and its children move
 *     into the parent. Its role and attachment go on its head word as a
 *     badge (badge: true, "phrase boundary uncertain"), never on an inner
 *     bracket. If several brackets of a word collapsed, the outermost wins.
 *     Pinned brackets are never removed: below the threshold they are marked
 *     `unsure` (shown dashed).
 *
 * Dependencies:
 *   Internal: ./types.ts, ./treeDecoder.ts (buildPhrases, headLayouts,
 *             spanConfidence), ./quantifiers.ts (displayTree). External: none.
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
 * Status: implemented (T34; phrase-per-head brackets, attachments, and span gating T76, T78). Tests: phraseLabeler.test.ts.
 */

import { QUANTIFIER_RELATION, displayTree } from "./quantifiers";
import { type HeadLayout, buildPhrases, headLayouts, spanConfidence } from "./treeDecoder";
import type {
  DecodedTree,
  LabeledPhrase,
  LabeledSentencePhrases,
  LabeledWord,
  PhraseCategory,
  PhraseNode,
  PhraseRole,
  RoleGate,
  RoleLabels,
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
  [QUANTIFIER_RELATION]: "Modifier",
};

const AUXILIARY_RELATIONS = new Set(["aux", "cop"]);
const CLAUSE_UPOS = new Set(["VERB", "AUX"]);

const base = (relation: string): string => relation.split(":")[0] ?? relation;

/** Role a relation gives its dependent's maximal projection (null if none). */
export function roleOf(relation: string): PhraseRole | null {
  return ROLE_BY_SUBTYPE[relation] ?? ROLE_BY_RELATION[base(relation)] ?? null;
}

/** Modifiers that, before their head, apply to everything up to and including the head (T81). */
const PREMODIFIER_RELATIONS = new Set(["det", "amod", "nummod", "compound", "nmod", "advmod", QUANTIFIER_RELATION]);

type Item = PhraseNode | WordLeaf;
type Attachment = Pick<RoleLabels, "role" | "attachTo" | "attachFrom" | "uncertain" | "coordinated">;
type Labeled = LabeledPhrase | LabeledWord;

/**
 * Label a sentence's nested phrases (see the header). Pure; spans and order are unchanged.
 * @param items phrases from buildPhrases (not gated; gateLabeled runs on the result)
 * @param heads 1-based heads (0 = root) of the tree the phrases were built from (the displayed tree)
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
  const isPunct = (i: number): boolean => upos[i] === "PUNCT";
  const rel = (i: number): string => relations[i] ?? "dep";
  const layouts = headLayouts(heads, upos, relations.map(base));
  const layout = (h: number): HeadLayout => layouts[h] as HeadLayout;

  /** Aux/cop dependents outside their head's predicate bracket: split-predicate pieces. */
  const splitPieces = new Set<number>();
  layouts.forEach((lay) => {
    for (const d of lay.outside) if (AUXILIARY_RELATIONS.has(base(rel(d)))) splitPieces.add(d);
  });
  const isSplit = (h: number): boolean => layout(h).outside.some((d) => splitPieces.has(d));
  const hasConj = (h: number): boolean => layout(h).real.some((d) => base(rel(d)) === "conj");
  const isConj = (i: number): boolean => base(rel(i)) === "conj";

  /** Role of a word's whole phrase; the root clause without a subject is the Predicate. */
  const maximalRole = (h: number): PhraseRole | null => {
    if (splitPieces.has(h)) return "Predicate";
    if (heads[h] !== 0) return roleOf(rel(h));
    const lay = layout(h);
    const clause = CLAUSE_UPOS.has(upos[h] ?? "") || lay.cop !== null;
    return clause && lay.subject === null ? "Predicate" : null;
  };
  const sure = (word: number): boolean => !gate || (gate.confidence[word] ?? 0) >= gate.threshold;
  const shown = (role: PhraseRole | null, word: number): PhraseRole | null => (sure(word) ? role : null);

  /** Word a dependent's arrow points to: its head; a subject points to the copula if there is one. */
  const target = (d: number): number | null => {
    const h = (heads[d] ?? 0) - 1;
    if (h < 0 || isPunct(d)) return null;
    const lay = layout(h);
    return lay.subject === d && lay.cop !== null ? lay.cop : h;
  };
  /** Last word of a word's subtree and whether a word is below another (displayed tree). */
  const lastOf = (w: number): number => Math.max(w, ...layout(w).real.map(lastOf));
  const below = (w: number, h: number): boolean => {
    for (let k = (heads[w] ?? 0) - 1, steps = 0; k >= 0 && steps <= heads.length; k = (heads[k] ?? 0) - 1, steps++) {
      if (k === h) return true;
    }
    return false;
  };
  /**
   * First word of what a dependent attaches to (T81): a modifier before its head, in the same
   * bracket, modifies everything from just after itself through the head word ("big" → "red
   * dog"); every other dependent attaches to the one word.
   */
  const spanStart = (d: number, to: number): number => {
    const h = (heads[d] ?? 0) - 1;
    if (to !== h || d > h || !PREMODIFIER_RELATIONS.has(base(rel(d))) || layout(h).outside.includes(d)) return to;
    let start = lastOf(d) + 1;
    while (start < h && isPunct(start)) start++;
    for (let w = start; w < h; w++) if (!isPunct(w) && !below(w, h)) return to;
    return Math.min(start, to);
  };
  /** Labels of a dependent's outermost bracket or of the dependent word itself. */
  const dependent = (d: number): Attachment => {
    const attachTo = target(d);
    return {
      role: shown(maximalRole(d), d),
      attachTo,
      attachFrom: attachTo === null ? null : spanStart(d, attachTo),
      uncertain: attachTo !== null && !sure(d),
      coordinated: !isPunct(d) && isConj(d),
    };
  };
  const none = { role: null, attachTo: null, attachFrom: null, uncertain: false, coordinated: false } as const;

  const labelWord = (leaf: WordLeaf, parent: PhraseNode | null): LabeledWord => {
    const w = leaf.word;
    const isHead = parent?.head === w;
    if (!isHead) {
      return { word: w, ...dependent(w), isHead, splitPredicate: splitPieces.has(w), badge: false };
    }
    // The head word inside its own phrase: a one-word complement or predicate carries that role.
    const lay = layout(w);
    let role: PhraseRole | null = null;
    let attachTo: number | null = null;
    let splitPredicate = false;
    if (lay.cop !== null && lay.complement.length === 0) {
      role = "Complement";
      attachTo = lay.subject;
    } else if (parent?.level === "clause") {
      role = "Predicate";
      splitPredicate = isSplit(w);
    }
    return {
      word: w,
      role: shown(role, w),
      isHead,
      coordinated: hasConj(w),
      splitPredicate,
      badge: false,
      attachTo,
      attachFrom: attachTo,
      uncertain: false,
    };
  };

  const labelNode = (node: PhraseNode, parent: PhraseNode | null): LabeledPhrase => {
    const h = node.head;
    const lay = layout(h);
    const category: PhraseCategory = node.level === "clause" ? "S" : node.type;
    let labels: Attachment = none;
    let splitPredicate = false;
    // Inner brackets of a head are told by their level; a main clause's are at the top level (T82).
    if (node.level === "predicate") {
      labels = { ...none, role: shown("Predicate", h) };
      splitPredicate = isSplit(h);
    } else if (node.level === "complement") {
      labels = { ...none, role: shown("Complement", h), attachTo: lay.subject, attachFrom: lay.subject };
    } else if (node.level === "conjunct") {
      // The first conjunct is a bracket of the coordination's head; a later one-word conjunct (T92)
      // is the conjunct itself, with its attachment.
      labels = parent?.head !== h ? dependent(h) : { ...none, coordinated: true };
    } else if (parent?.head !== h) labels = dependent(h);
    return {
      type: node.type,
      level: node.level,
      head: h,
      start: node.start,
      end: node.end,
      contiguous: node.contiguous,
      category,
      ...labels,
      isHead: parent?.head === h,
      splitPredicate,
      badge: false,
      ...(node.pinned ? { pinned: true } : {}),
      unsure: false,
      children: node.children.map((c) => ("word" in c ? labelWord(c, node) : labelNode(c, node))),
    };
  };

  return items.map((it: Item) => ("word" in it ? labelWord(it, null) : labelNode(it, null)));
}

/**
 * Collapse multi-word brackets whose confidence is below threshold (see the header): their
 * children move into the parent (word order kept); the bracket's role and attachment go to
 * its head word as a badge. Outer brackets are handled after inner ones, so the outermost
 * collapsed bracket's role wins.
 * @param confidence span confidence of a bracket (treeDecoder.ts → spanConfidence)
 */
export function gateLabeled(
  items: LabeledSentencePhrases,
  confidence: (node: LabeledPhrase) => number,
  threshold: number,
): LabeledSentencePhrases {
  const headOf = (x: Labeled): number => ("word" in x ? x.word : x.head);
  const first = (x: Labeled): number => ("word" in x ? x.word : x.start);
  /** Give the head word of a collapsed bracket its role (badge) and attachment. */
  const badge = (xs: Labeled[], from: LabeledPhrase): Labeled[] =>
    xs.map((x) => {
      if (headOf(x) !== from.head) return x;
      if (!("word" in x)) return { ...x, children: badge(x.children, from) };
      return {
        ...x,
        role: from.role ?? x.role,
        badge: from.role !== null || x.badge,
        attachTo: from.attachTo ?? x.attachTo,
        attachFrom: from.attachTo !== null ? from.attachFrom : x.attachFrom,
        uncertain: from.attachTo !== null ? from.uncertain : x.uncertain,
        coordinated: from.coordinated || x.coordinated,
        splitPredicate: from.splitPredicate || x.splitPredicate,
      };
    });
  const gate = (item: Labeled, parentHead: number | null): Labeled[] => {
    if ("word" in item) return [item];
    const children = item.children.flatMap((c) => gate(c, item.head));
    if (item.start === item.end || confidence(item) >= threshold) return [{ ...item, children }];
    // A main clause's subject and predicate brackets are always shown: marked unsure instead.
    if (item.pinned) return [{ ...item, unsure: true, children }];
    return badge(children, item).map((c) => ({ ...c, isHead: headOf(c) === parentHead }));
  };
  const sort = (xs: Labeled[]): Labeled[] =>
    xs.map((x) => ("word" in x ? x : { ...x, children: sort(x.children) })).sort((a, b) => first(a) - first(b));
  return sort(items.flatMap((it) => gate(it, null)));
}

/**
 * The nested view of one decoded tree: quantifier display rule → buildPhrases → labelPhrases
 * with the role gate (relation × head probability ≥ role threshold) → gateLabeled (span
 * confidence ≥ bracket threshold). Used by parser.ts (primary parse) and ambiguity.ts
 * (alternatives).
 * @param words word texts (quantifier rule)
 */
export function labeledView(
  tree: DecodedTree,
  upos: readonly string[],
  words: readonly string[],
  thresholds: { bracket: number; role: number },
): LabeledSentencePhrases {
  const shownTree = displayTree(tree.heads, tree.relations, words);
  const items = buildPhrases(shownTree.heads, upos, shownTree.relations.map(base));
  const own = tree.relationProbs.map((p, i) => p * (tree.headProbs[i] ?? 0));
  const confidence = shownTree.source.map((src) => own[src] ?? 0);
  const labeled = labelPhrases(items, shownTree.heads, shownTree.relations, upos, {
    confidence,
    threshold: thresholds.role,
  });
  const isPunct = (w: number): boolean => upos[w] === "PUNCT";
  return gateLabeled(labeled, (node) => spanConfidence(node, tree, isPunct), thresholds.bracket);
}
