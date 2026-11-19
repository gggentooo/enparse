/**
 * training/js/lib/nested.mjs — nested-phrase and repaired-tree scores
 *
 * Description:
 *   Scores predictions against gold trees with the app's own decoder
 *   (src/modules/parser/treeDecoder.ts, passed in so this file stays free of
 *   TypeScript imports): decode the group B candidates into a repaired tree,
 *   build nested phrases for prediction and gold, and compare brackets.
 *
 * Phase: 7 (test evaluation), 9 (parity of the nested view).
 *
 * Metrics:
 *   nested_f1            labeled bracket F1 (type, start, end; multiset)
 *   nested_unlabeled_f1  bracket F1 ignoring labels
 *   tree_uas / tree_las  after decoding and repair (what the app shows)
 *   repaired_share       sentences whose tree needed repair
 *
 * Dependencies: none (decoder functions injected).
 *   Used by: ../nested_eval.mjs, ../tests/nested.test.mjs.
 *
 * Status: implemented (Phase 7).
 */

function f1(gold, pred) {
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
  return { gold: gold.length, pred: pred.length, correct };
}

const finish = ({ gold, pred, correct }) => {
  const p = pred ? correct / pred : 0;
  const r = gold ? correct / gold : 0;
  return { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
};

/**
 * @param {Array<object>} records evaluate.py *_predictions.jsonl records
 * @param {{ decodeTree: Function, buildPhrases: Function, phraseSpans: Function }} decoder
 */
export function scoreNested(records, decoder) {
  const lab = { gold: 0, pred: 0, correct: 0 };
  const unl = { gold: 0, pred: 0, correct: 0 };
  let words = 0;
  let uas = 0;
  let las = 0;
  let repaired = 0;
  for (const r of records) {
    const tree = decoder.decodeTree(r.dep_candidates, r.pred_upos);
    if (tree.repaired) repaired++;
    tree.heads.forEach((h, i) => {
      words++;
      if (h === r.gold_head[i]) {
        uas++;
        if (tree.relations[i] === r.gold_rel[i]) las++;
      }
    });
    const goldSpans = decoder.phraseSpans(decoder.buildPhrases(r.gold_head, r.gold_upos, r.gold_rel));
    const predSpans = decoder.phraseSpans(decoder.buildPhrases(tree.heads, r.pred_upos, tree.relations));
    const key = (s, labeled) => (labeled ? `${s.type}:${s.start}:${s.end}` : `${s.start}:${s.end}`);
    for (const [acc, labeled] of [
      [lab, true],
      [unl, false],
    ]) {
      const c = f1(
        goldSpans.map((s) => key(s, labeled)),
        predSpans.map((s) => key(s, labeled)),
      );
      acc.gold += c.gold;
      acc.pred += c.pred;
      acc.correct += c.correct;
    }
  }
  const l = finish(lab);
  return {
    sentences: records.length,
    words,
    nested_f1: l.f1,
    nested_precision: l.precision,
    nested_recall: l.recall,
    nested_unlabeled_f1: finish(unl).f1,
    tree_uas: words ? uas / words : 0,
    tree_las: words ? las / words : 0,
    repaired_share: records.length ? repaired / records.length : 0,
  };
}
