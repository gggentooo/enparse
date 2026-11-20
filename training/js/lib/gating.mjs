/**
 * training/js/lib/gating.mjs — shown-bracket precision and coverage under confidence gating
 *
 * Description:
 *   For biaffine prediction records (arc_scores = word-level head log-probs,
 *   rel_candidates), decodes each sentence with the app's decodeArcTree at an
 *   arc temperature, builds nested phrases, and for every threshold gates them
 *   with gatePhrases (both injected from treeDecoder.ts). Counts labeled
 *   multi-word brackets (type, start, end), multiset match against the gold
 *   tree's brackets:
 *     precision = correct shown / shown (null when nothing is shown)
 *     coverage  = shown / predicted (before gating)
 *     recall    = correct shown / gold
 *
 * Phase: 8 (T58). Used by: ../gating_eval.mjs, ../tests/gating.test.mjs.
 * Dependencies: none (decoder functions injected).
 *
 * Status: implemented (T58).
 */

/** Thresholds evaluated (0 = no gating). */
export const THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99];

const base = (rel) => rel.split(":")[0];
const key = (s) => `${s.type}:${s.start}:${s.end}`;
const multi = (spans) => spans.filter((s) => s.end > s.start).map(key);

function matches(gold, pred) {
  const g = new Map();
  for (const k of gold) g.set(k, (g.get(k) ?? 0) + 1);
  let correct = 0;
  for (const k of pred) {
    const n = g.get(k) ?? 0;
    if (n > 0) {
      correct++;
      g.set(k, n - 1);
    }
  }
  return correct;
}

/** Arc rows at temperature t (log-probs divided by t; the decoder renormalizes each row). */
export function scaleArc(arc, t) {
  return arc.map((row) => row.map((v) => v / t));
}

/**
 * Precision, coverage, and recall of shown multi-word brackets per threshold.
 * @param {object[]} records biaffine prediction records
 * @param {{ decodeArcTree: Function, buildPhrases: Function, gatePhrases: Function, phraseSpans: Function }} d
 * @param {number} t arc temperature
 * @param {number[]} thresholds
 */
export function gatingCurve(records, d, t, thresholds) {
  const acc = thresholds.map(() => ({ shown: 0, correct: 0 }));
  let predicted = 0;
  let gold = 0;
  for (const r of records) {
    const tree = d.decodeArcTree(scaleArc(r.arc_scores, t), r.rel_candidates);
    const rels = tree.relations.map(base);
    const items = d.buildPhrases(tree.heads, r.pred_upos, rels);
    const goldSpans = multi(d.phraseSpans(d.buildPhrases(r.gold_head, r.gold_upos, r.gold_rel)));
    gold += goldSpans.length;
    predicted += multi(d.phraseSpans(items)).length;
    thresholds.forEach((th, i) => {
      const shown = multi(d.phraseSpans(d.gatePhrases(items, tree, th)));
      acc[i].shown += shown.length;
      acc[i].correct += matches(goldSpans, shown);
    });
  }
  return thresholds.map((threshold, i) => ({
    threshold,
    precision: acc[i].shown ? acc[i].correct / acc[i].shown : null,
    coverage: predicted ? acc[i].shown / predicted : 0,
    recall: gold ? acc[i].correct / gold : 0,
    shown: acc[i].shown,
  }));
}

/**
 * Lowest threshold with precision ≥ minPrecision and at least one bracket shown (highest
 * coverage); the highest threshold if none.
 */
export function chooseThreshold(curve, minPrecision) {
  const ok = curve.find((r) => r.precision !== null && r.precision >= minPrecision);
  return (ok ?? curve[curve.length - 1]).threshold;
}

/** Relation candidates at temperature t (renormalized over the stored top-k; T59 role gate). */
export function scaleRel(candidates, t) {
  return candidates.map((cs) => {
    const q = cs.map((c) => Math.pow(c.prob, 1 / t));
    const z = q.reduce((a, b) => a + b, 0) || 1;
    return cs.map((c, i) => ({ relation: c.relation, prob: q[i] / z }));
  });
}

/** Role thresholds evaluated (0 = no role gate). */
export const ROLE_THRESHOLDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

/**
 * Role units of labeled phrases: a role on a bracket (role, start, end), on a word (role, w, w),
 * or a badge on a collapsed bracket's head word (matched by role and head word).
 */
function roleUnits(items) {
  const out = [];
  const walk = (x) => {
    if ("word" in x) {
      if (x.role) out.push(x.badge ? { badge: `${x.role}|${x.word}` } : { span: `${x.role}|${x.word}|${x.word}` });
      return;
    }
    if (x.role) out.push({ span: `${x.role}|${x.start}|${x.end}` });
    x.children.forEach(walk);
  };
  items.forEach(walk);
  return out;
}

/**
 * Precision, coverage, and recall of shown roles per role threshold, with brackets gated at
 * bracketThreshold (labelPhrases with badges; d.labelPhrases injected from phraseLabeler.ts).
 * A role is correct if the gold tree's labeled phrases have the same role on the same span
 * (badge: on a bracket or word with the same head word).
 */
export function roleCurve(records, d, arcT, relT, bracketThreshold, thresholds) {
  const acc = thresholds.map(() => ({ shown: 0, correct: 0 }));
  let gold = 0;
  for (const r of records) {
    const tree = d.decodeArcTree(scaleArc(r.arc_scores, arcT), scaleRel(r.rel_candidates, relT));
    const items = d.gatePhrases(d.buildPhrases(tree.heads, r.pred_upos, tree.relations.map(base)), tree, bracketThreshold);
    const goldItems = d.buildPhrases(r.gold_head, r.gold_upos, r.gold_deprel.map(base));
    const goldLabeled = d.labelPhrases(goldItems, r.gold_head, r.gold_deprel, r.gold_upos);
    const spans = new Set();
    const byHead = new Set();
    const walk = (x) => {
      const h = "word" in x ? x.word : x.head;
      if (x.role) {
        spans.add("word" in x ? `${x.role}|${x.word}|${x.word}` : `${x.role}|${x.start}|${x.end}`);
        byHead.add(`${x.role}|${h}`);
      }
      if (!("word" in x)) x.children.forEach(walk);
    };
    goldLabeled.forEach(walk);
    gold += spans.size;
    const confidence = tree.relationProbs.map((p, i) => p * tree.headProbs[i]);
    thresholds.forEach((threshold, i) => {
      const units = roleUnits(d.labelPhrases(items, tree.heads, tree.relations, r.pred_upos, { confidence, threshold }));
      acc[i].shown += units.length;
      acc[i].correct += units.filter((u) => (u.span ? spans.has(u.span) : byHead.has(u.badge))).length;
    });
  }
  const all = acc[0].shown;
  return thresholds.map((threshold, i) => ({
    threshold,
    precision: acc[i].shown ? acc[i].correct / acc[i].shown : null,
    coverage: all ? acc[i].shown / all : 0,
    recall: gold ? acc[i].correct / gold : 0,
    shown: acc[i].shown,
  }));
}
