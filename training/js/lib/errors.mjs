/**
 * training/js/lib/errors.mjs — find and classify test errors (Phase 7 task 5)
 *
 * Description:
 *   Turns one prediction record (scripts/evaluate.py *_predictions.jsonl) plus
 *   its decoded tree (the app's treeDecoder.ts, injected by the caller) into
 *   error units, each with an area and a type:
 *     upos      word-level tag errors (noun/verb homographs, ...)
 *     chunk     gold chunks not predicted exactly, and predicted chunks that
 *               overlap no gold chunk (spans read like seqeval's default mode:
 *               a stray I-X starts a chunk, as the planned BIO repair does)
 *     head      words attached to the wrong head in the decoded tree
 *               (PP attachment, coordination, clause attachment, ...)
 *     relation  right head, wrong relation (type = "gold → predicted")
 *   Also classifies missed multi-word brackets of the nested view by cause
 *   (an attachment error inside the gold span, or label/boundary only).
 *
 * Phase: 7 task 5 (reports/errors.md).
 * Dependencies: none (decoder functions injected). Used by: ../error_analysis.mjs,
 *   ../tests/errors.test.mjs.
 *
 * Status: implemented (Phase 7).
 */

const FUNCTION_WORDS = new Set(["ADP", "SCONJ", "ADV", "PART", "CCONJ"]);
const CLAUSE_RELS = new Set(["root", "ccomp", "xcomp", "advcl", "acl", "parataxis", "csubj", "list"]);
const ARGUMENT_RELS = new Set(["nsubj", "obj", "iobj", "expl"]);
const MODIFIER_RELS = new Set(["advmod", "amod", "nmod", "obl", "nummod", "appos", "compound", "det", "discourse"]);

/** Type of a UPOS error (gold ≠ predicted). */
export function uposType(gold, pred) {
  const pair = new Set([gold, pred]);
  const both = (set) => set.has(gold) && set.has(pred);
  if (both(new Set(["NOUN", "VERB"]))) return "noun/verb homograph";
  if (both(new Set(["NOUN", "PROPN"]))) return "proper vs common noun";
  if (pair.has("ADJ") && (both(new Set(["ADJ", "NOUN", "PROPN"])) || both(new Set(["ADJ", "VERB"]))))
    return "adjective vs noun/verb (participles, modifiers)";
  if (both(new Set(["ADJ", "ADV"]))) return "adjective vs adverb";
  if (pair.has("NUM") && both(new Set(["NUM", "NOUN", "PROPN", "X", "SYM"]))) return "numbers and codes";
  if (both(new Set(["AUX", "VERB"]))) return "auxiliary vs main verb";
  if (both(FUNCTION_WORDS)) return "function word (ADP/SCONJ/ADV/PART/CCONJ)";
  if (both(new Set(["PRON", "DET"]))) return "pronoun vs determiner";
  if (pair.has("X") || pair.has("SYM") || pair.has("PUNCT") || pair.has("INTJ")) return "symbols, foreign words (X), interjections";
  return "other";
}

/** Chunk spans {type, start, end} (inclusive word indices) from BIO labels, seqeval default mode. */
export function chunkSpans(labels) {
  const spans = [];
  let cur = null;
  labels.forEach((l, i) => {
    const [prefix, type] = l === "O" ? ["O", null] : l.split("-");
    if (prefix === "O") {
      cur = null;
      return;
    }
    if (prefix === "I" && cur && cur.type === type) {
      cur.end = i;
      return;
    }
    cur = { type, start: i, end: i };
    spans.push(cur);
  });
  return spans;
}

const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
const sameSpan = (a, b) => a.start === b.start && a.end === b.end;

/** Chunk error units: missed/mistyped/misbounded gold chunks and spurious predicted chunks. */
export function chunkErrors(goldLabels, predLabels) {
  const gold = chunkSpans(goldLabels);
  const pred = chunkSpans(predLabels);
  const out = [];
  for (const g of gold) {
    if (pred.some((p) => sameSpan(p, g) && p.type === g.type)) continue;
    const same = pred.find((p) => sameSpan(p, g));
    let kind;
    if (same) kind = `wrong type (${g.type} → ${same.type})`;
    else if (pred.some((p) => overlaps(p, g) && p.type === g.type)) {
      const p = pred.find((q) => overlaps(q, g) && q.type === g.type);
      const longer = p.start <= g.start && p.end >= g.end;
      const shorter = p.start >= g.start && p.end <= g.end;
      kind = `${g.type} boundary: ${longer ? "too long (joined with a neighbor)" : shorter ? "too short (split)" : "shifted"}`;
    }
    else if (pred.some((p) => overlaps(p, g))) kind = `${g.type} split/merged with other types`;
    else kind = `${g.type} missed (tagged O)`;
    out.push({ type: kind, chunk: g.type, start: g.start, end: g.end });
  }
  for (const p of pred) {
    if (!gold.some((g) => overlaps(g, p))) out.push({ type: `spurious ${p.type}`, chunk: p.type, start: p.start, end: p.end });
  }
  return out;
}

const base = (rel) => rel.split(":")[0];

/** Type of a head error for word i (0-based), from the gold tree. */
export function headType(i, goldHead, goldRel, goldUpos, predRel) {
  const rel = base(goldRel[i]);
  if (goldUpos[i] === "PUNCT") return "punctuation attachment";
  const hasCase = goldHead.some((h, j) => h === i + 1 && base(goldRel[j]) === "case");
  if ((rel === "obl" || rel === "nmod") && hasCase) return "PP attachment";
  if (rel === "conj" || rel === "cc" || base(predRel) === "conj" || base(predRel) === "cc") return "coordination";
  if (CLAUSE_RELS.has(rel)) return "clause attachment (root, ccomp, advcl, acl, ...)";
  if (ARGUMENT_RELS.has(rel)) return "subject/object attachment";
  if (MODIFIER_RELS.has(rel)) return "modifier attachment (advmod, amod, nmod, obl, compound, ...)";
  return "other (aux, mark, case, flat, fixed, goeswith, ...)";
}

const headWord = (words, h) => (h === 0 ? "ROOT" : `${words[h - 1]}#${h}`);

/**
 * All error units of one sentence.
 * @param {object} r prediction record (gold_*, pred_upos, pred_chunk, words)
 * @param {{ heads: number[], relations: string[] }} tree decoded prediction
 */
export function sentenceErrors(r, tree) {
  const out = [];
  r.gold_upos.forEach((g, i) => {
    if (g !== r.pred_upos[i]) out.push({ area: "upos", type: uposType(g, r.pred_upos[i]), start: i, end: i, gold: g, pred: r.pred_upos[i] });
  });
  for (const c of chunkErrors(r.gold_chunk, r.pred_chunk)) out.push({ area: "chunk", ...c });
  tree.heads.forEach((h, i) => {
    if (h !== r.gold_head[i]) {
      out.push({
        area: "head",
        type: headType(i, r.gold_head, r.gold_rel, r.gold_upos, tree.relations[i]),
        start: i,
        end: i,
        gold: `${r.gold_rel[i]} of ${headWord(r.words, r.gold_head[i])}`,
        pred: `${tree.relations[i]} of ${headWord(r.words, h)}`,
      });
    } else if (base(tree.relations[i]) !== base(r.gold_rel[i])) {
      const g = base(r.gold_rel[i]);
      const p = base(tree.relations[i]);
      out.push({ area: "relation", type: `${g} → ${p}`, start: i, end: i, gold: g, pred: p });
    }
  });
  return out;
}

/**
 * Missed gold multi-word brackets of the nested view, by cause (first that applies):
 *   inside     a non-punctuation word inside the gold span has the wrong head
 *   intruder   an outside non-punctuation word is wrongly attached into the span's subtree
 *              (the predicted phrase grows past the gold boundary)
 *   labelOnly  the same span is predicted with another type (e.g. NP vs PP)
 *   other      e.g. punctuation or UPOS changes that move the bracket
 * @returns {{ gold: number, missed: number, inside: number, intruder: number, labelOnly: number, other: number }}
 */
export function bracketCauses(r, tree, decoder) {
  const goldSpans = decoder.phraseSpans(decoder.buildPhrases(r.gold_head, r.gold_upos, r.gold_rel)).filter((s) => s.end > s.start);
  const predSpans = decoder.phraseSpans(decoder.buildPhrases(tree.heads, r.pred_upos, tree.relations)).filter((s) => s.end > s.start);
  const labeled = new Map();
  const unlabeled = new Set();
  for (const s of predSpans) {
    const k = `${s.type}:${s.start}:${s.end}`;
    labeled.set(k, (labeled.get(k) ?? 0) + 1);
    unlabeled.add(`${s.start}:${s.end}`);
  }
  const wrong = (i) => tree.heads[i] !== r.gold_head[i] && r.gold_upos[i] !== "PUNCT";
  const res = { gold: goldSpans.length, missed: 0, inside: 0, intruder: 0, labelOnly: 0, other: 0 };
  for (const s of goldSpans) {
    const k = `${s.type}:${s.start}:${s.end}`;
    const n = labeled.get(k) ?? 0;
    if (n > 0) {
      labeled.set(k, n - 1);
      continue;
    }
    res.missed++;
    let inside = false;
    for (let i = s.start; i <= s.end; i++) if (wrong(i)) inside = true;
    const intruder = tree.heads.some((h, i) => (i < s.start || i > s.end) && wrong(i) && h - 1 >= s.start && h - 1 <= s.end);
    if (inside) res.inside++;
    else if (intruder) res.intruder++;
    else if (unlabeled.has(`${s.start}:${s.end}`)) res.labelOnly++;
    else res.other++;
  }
  return res;
}

/** Deterministic PRNG (mulberry32) for reproducible samples. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k items sampled without replacement (partial Fisher–Yates), in original order. */
export function sample(items, k, seed) {
  const idx = items.map((_, i) => i);
  const rand = rng(seed);
  const n = Math.min(k, idx.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).sort((a, b) => a - b).map((i) => items[i]);
}

/** Sentence with the error span marked: words … ⟦span⟧ … (window of ±8 words). */
export function context(words, start, end, width = 8) {
  const a = Math.max(0, start - width);
  const b = Math.min(words.length, end + 1 + width);
  const parts = [];
  for (let i = a; i < b; i++) {
    let w = words[i];
    if (i === start) w = `⟦${w}`;
    if (i === end) w = `${w}⟧`;
    parts.push(w);
  }
  return `${a > 0 ? "… " : ""}${parts.join(" ")}${b < words.length ? " …" : ""}`;
}
