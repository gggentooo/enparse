/**
 * training/js/lib/metrics.mjs — UPOS accuracy and CoNLL-style chunk scores
 *
 * Description:
 *   Word-level UPOS accuracy (overall and per gold tag) and span-level chunk
 *   precision / recall / F1 (overall and per type), equivalent to seqeval's
 *   default (IOB2, non-strict) mode: a chunk starts at B-X, or at I-X when the
 *   previous tag is not of type X; a predicted chunk is correct only if type,
 *   start, and end all match a gold chunk.
 *
 * Phase: 5 — Baseline evaluation (also usable in Phase 7 for JS-side checks).
 *
 * Dependencies: none. Used by: ../evaluate_baselines.mjs, ../tests/baselines.test.mjs.
 *
 * Status: implemented (Phase 5).
 */

/**
 * Chunk spans of one BIO sequence as "TYPE:start:end" strings (end inclusive).
 * @param {string[]} tags
 * @returns {string[]}
 */
export function spansFromBio(tags) {
  const spans = [];
  let type = null;
  let start = 0;
  const close = (end) => {
    if (type !== null) spans.push(`${type}:${start}:${end}`);
    type = null;
  };
  tags.forEach((tag, i) => {
    if (tag === "O") return close(i - 1);
    const [prefix, t] = [tag.slice(0, 1), tag.slice(2)];
    if (prefix === "B" || t !== type) {
      close(i - 1);
      type = t;
      start = i;
    }
  });
  close(tags.length - 1);
  return spans;
}

/**
 * Span-level chunk scores over many sentences.
 * @param {string[][]} gold
 * @param {string[][]} pred
 * @returns {{ overall: Score, perType: Record<string, Score> }}
 * @typedef {{ precision: number, recall: number, f1: number, gold: number, pred: number, correct: number }} Score
 */
export function chunkScores(gold, pred) {
  if (gold.length !== pred.length) throw new Error("gold and pred have different sentence counts");
  const counts = new Map(); // type -> {gold, pred, correct}
  const bump = (type, key) => {
    const c = counts.get(type) ?? { gold: 0, pred: 0, correct: 0 };
    c[key]++;
    counts.set(type, c);
  };
  gold.forEach((g, i) => {
    const p = pred[i];
    if (g.length !== p.length) throw new Error(`sentence ${i}: gold and pred lengths differ`);
    const gs = new Set(spansFromBio(g));
    const ps = spansFromBio(p);
    for (const s of gs) bump(s.split(":")[0], "gold");
    for (const s of ps) {
      bump(s.split(":")[0], "pred");
      if (gs.has(s)) bump(s.split(":")[0], "correct");
    }
  });
  const score = ({ gold: g, pred: p, correct: c }) => {
    const precision = p ? c / p : 0;
    const recall = g ? c / g : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { precision, recall, f1, gold: g, pred: p, correct: c };
  };
  const total = { gold: 0, pred: 0, correct: 0 };
  const perType = {};
  for (const [type, c] of [...counts].sort()) {
    perType[type] = score(c);
    total.gold += c.gold;
    total.pred += c.pred;
    total.correct += c.correct;
  }
  return { overall: score(total), perType };
}

/**
 * UPOS accuracy overall and per gold tag (recall of that tag).
 * @param {string[]} gold
 * @param {string[]} pred
 * @returns {{ accuracy: number, total: number, correct: number, perTag: Record<string, {total: number, correct: number, accuracy: number}>, confusions: Array<[string, number]> }}
 */
export function uposScores(gold, pred) {
  if (gold.length !== pred.length) throw new Error("gold and pred lengths differ");
  const perTag = {};
  const confusions = new Map();
  let correct = 0;
  gold.forEach((g, i) => {
    const t = (perTag[g] ??= { total: 0, correct: 0, accuracy: 0 });
    t.total++;
    if (g === pred[i]) {
      t.correct++;
      correct++;
    } else {
      const key = `${g} → ${pred[i]}`;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
  });
  for (const t of Object.values(perTag)) t.accuracy = t.total ? t.correct / t.total : 0;
  return {
    accuracy: gold.length ? correct / gold.length : 0,
    total: gold.length,
    correct,
    perTag,
    confusions: [...confusions].sort((a, b) => b[1] - a[1]),
  };
}
