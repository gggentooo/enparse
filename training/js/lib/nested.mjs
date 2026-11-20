/**
 * training/js/lib/nested.mjs — nested-phrase and repaired-tree scores
 *
 * Description:
 *   Scores predictions against gold trees with the app's own decoder
 *   (src/modules/parser/treeDecoder.ts, passed in so this file stays free of
 *   TypeScript imports): decode each record into a tree (decodeRecord: MST
 *   over arc_scores for biaffine records, else the rel_pos_v1 group B
 *   candidates with repair), build nested phrases for prediction and gold,
 *   and compare brackets. Relations are compared without subtypes.
 *
 * Phase: 7 (test evaluation), 9 (parity of the nested view).
 *
 * Metrics:
 *   nested_f1            labeled bracket F1 (type, start, end; multiset)
 *   nested_unlabeled_f1  bracket F1 ignoring labels
 *   nested_multiword_f1  labeled bracket F1 over brackets of two or more words
 *                        (nested-view target; single-word wrappers excluded)
 *   tree_uas / tree_las  after decoding and repair (what the app shows)
 *   tree_uas_no_punct / tree_las_no_punct
 *                        same, without words whose gold UPOS is PUNCT
 *                        (nested-view target; punctuation is not bracketed)
 *   repaired_share       sentences whose tree needed repair
 *
 * Dependencies: none (decoder functions injected).
 *   Used by: ../nested_eval.mjs, ../tests/nested.test.mjs.
 *
 * Status: implemented (Phase 7).
 */

const base = (rel) => rel.split(":")[0];

/**
 * Decoded tree of one evaluate.py record (relations without subtypes).
 * @param {object} r record with arc_scores + rel_candidates (biaffine) or dep_candidates (rel_pos_v1)
 * @param {{ decodeTree: Function, decodeArcTree?: Function }} decoder
 */
export function decodeRecord(r, decoder) {
  const tree = r.arc_scores ? decoder.decodeArcTree(r.arc_scores, r.rel_candidates) : decoder.decodeTree(r.dep_candidates, r.pred_upos);
  return { ...tree, fullRelations: tree.relations, relations: tree.relations.map(base) };
}

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
 * @param {{ decodeTree: Function, decodeArcTree?: Function, buildPhrases: Function, phraseSpans: Function }} decoder
 */
export function scoreNested(records, decoder) {
  const lab = { gold: 0, pred: 0, correct: 0 };
  const unl = { gold: 0, pred: 0, correct: 0 };
  const multi = { gold: 0, pred: 0, correct: 0 };
  let words = 0;
  let uas = 0;
  let las = 0;
  let npWords = 0;
  let npUas = 0;
  let npLas = 0;
  let repaired = 0;
  for (const r of records) {
    const tree = decodeRecord(r, decoder);
    if (tree.repaired) repaired++;
    tree.heads.forEach((h, i) => {
      const punct = r.gold_upos[i] === "PUNCT";
      words++;
      if (!punct) npWords++;
      if (h === r.gold_head[i]) {
        uas++;
        if (!punct) npUas++;
        if (tree.relations[i] === r.gold_rel[i]) {
          las++;
          if (!punct) npLas++;
        }
      }
    });
    const goldSpans = decoder.phraseSpans(decoder.buildPhrases(r.gold_head, r.gold_upos, r.gold_rel));
    const predSpans = decoder.phraseSpans(decoder.buildPhrases(tree.heads, r.pred_upos, tree.relations));
    const key = (s, labeled) => (labeled ? `${s.type}:${s.start}:${s.end}` : `${s.start}:${s.end}`);
    const isMulti = (s) => s.end > s.start;
    for (const [acc, labeled, keep] of [
      [lab, true, () => true],
      [unl, false, () => true],
      [multi, true, isMulti],
    ]) {
      const c = f1(
        goldSpans.filter(keep).map((s) => key(s, labeled)),
        predSpans.filter(keep).map((s) => key(s, labeled)),
      );
      acc.gold += c.gold;
      acc.pred += c.pred;
      acc.correct += c.correct;
    }
  }
  const l = finish(lab);
  const m = finish(multi);
  return {
    sentences: records.length,
    words,
    nested_f1: l.f1,
    nested_precision: l.precision,
    nested_recall: l.recall,
    nested_unlabeled_f1: finish(unl).f1,
    nested_multiword_f1: m.f1,
    nested_multiword_precision: m.precision,
    nested_multiword_recall: m.recall,
    tree_uas: words ? uas / words : 0,
    tree_las: words ? las / words : 0,
    tree_uas_no_punct: npWords ? npUas / npWords : 0,
    tree_las_no_punct: npWords ? npLas / npWords : 0,
    repaired_share: records.length ? repaired / records.length : 0,
  };
}
