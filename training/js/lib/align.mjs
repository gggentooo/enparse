/**
 * training/js/lib/align.mjs — map UD words and labels onto runtime words
 *
 * Description:
 *   Pure alignment logic for Phase 3 (no I/O, no wink): locates UD words in
 *   the preprocessed sentence text, groups them with the runtime words that
 *   overlap them, transfers labels (UPOS, chunk, head, relation), and checks
 *   the result (valid BIO, valid tree).
 *
 * Phase: 3 — Tokenization alignment with runtime.
 *
 * Rules (plan-training.md → Phase 3 → Decisions and tasks 3–5):
 *   exact       one UD word = one runtime word (same span).
 *   merge       one runtime word covers several UD words. It takes the UPOS,
 *               chunk type, head, and relation of the span's head word: the
 *               UD word whose head lies outside the span (if several: prefer
 *               non-punctuation, then the one closest to the root, then the
 *               first). Arcs into the span point to the merged word.
 *   split       one UD word becomes several runtime words. The main piece
 *               (the first piece with a letter or digit, else the first piece)
 *               keeps all labels; the others attach to it with `goeswith`,
 *               UPOS X (PUNCT if the piece has no letter or digit), and the
 *               same chunk.
 *   complex     overlaps that are neither (a runtime word covers part of a UD
 *               word and part of another); handled with the same two rules.
 *   Chunk prefixes come from chunk identity: a runtime word gets B- when its
 *   chunk (the UD chunk of its head word) differs from the previous runtime
 *   word's chunk, else I-. So merges never join two UD chunks.
 *
 *   Metric categories (by-design, not counted in agreement):
 *     merge:hyphen  runtime word is a hyphenated word (owner rule).
 *     merge:glued   runtime word is one written token without an apostrophe.
 *
 * Dependencies: none. Used by: ../align_tokens.mjs, ../tests/align.test.mjs.
 *
 * Status: implemented (Phase 3).
 */

/** Runtime-piece UPOS for split pieces with / without a letter or digit. */
export const SPLIT_PIECE_UPOS = "X";
export const SPLIT_PUNCT_UPOS = "PUNCT";
export const SPLIT_RELATION = "goeswith";

const HYPHENATED_RE = /^[\p{L}\p{N}]\S*-\S*[\p{L}\p{N}]$/u;
const HAS_ALNUM_RE = /[\p{L}\p{N}]/u;

/**
 * Character spans of each UD word in `text` (preprocessed sentence text).
 * Multiword tokens: if the normalized word forms concatenate to the surface
 * form, each word gets its own part; otherwise every word gets the whole
 * surface span.
 * @param {string} text
 * @param {import("./conllu.mjs").UdSentence} sentence
 * @param {(s: string) => string} normalize
 * @returns {Array<{start: number, end: number}>}
 */
export function locateUdWords(text, sentence, normalize) {
  const spans = new Array(sentence.words.length);
  const index = new Map(sentence.words.map((w, i) => [w.id, i]));
  const mwtByStart = new Map(sentence.mwts.map((m) => [m.start, m]));
  let cursor = 0;
  const find = (form, what) => {
    const at = text.indexOf(form, cursor);
    if (at < 0) throw new Error(`${sentence.sentId}: ${what} ${JSON.stringify(form)} not found after ${cursor}`);
    return at;
  };
  for (let i = 0; i < sentence.words.length; i++) {
    const w = sentence.words[i];
    const mwt = mwtByStart.get(w.id);
    if (mwt) {
      const surface = normalize(mwt.form);
      const at = find(surface, "multiword token");
      const ids = [];
      for (let id = mwt.start; id <= mwt.end; id++) ids.push(index.get(id));
      const forms = ids.map((k) => normalize(sentence.words[k].form));
      if (forms.join("") === surface) {
        let o = at;
        ids.forEach((k, j) => {
          spans[k] = { start: o, end: o + forms[j].length };
          o += forms[j].length;
        });
      } else {
        for (const k of ids) spans[k] = { start: at, end: at + surface.length };
      }
      cursor = at + surface.length;
      i = ids[ids.length - 1];
      continue;
    }
    const form = normalize(w.form);
    const at = find(form, "word");
    spans[i] = { start: at, end: at + form.length };
    cursor = at + form.length;
  }
  return spans;
}

function depths(ud) {
  const byId = new Map(ud.map((w, i) => [w.id, i]));
  const memo = new Array(ud.length);
  const depth = (i, guard = 0) => {
    if (memo[i] !== undefined) return memo[i];
    const h = ud[i].head;
    if (h === 0 || guard > ud.length) return (memo[i] = 0);
    return (memo[i] = depth(byId.get(h), guard + 1) + 1);
  };
  return ud.map((_, i) => depth(i));
}

function chunkType(tag) {
  return tag === "O" ? null : tag.slice(2);
}

/** Index of the first word of the chunk containing word i (UD order). */
function chunkStart(ud, i) {
  let k = i;
  while (k > 0 && ud[k].chunk.startsWith("I-")) k--;
  return k;
}

/**
 * Check a tag sequence is valid BIO over the chunk types.
 * @param {string[]} tags
 * @returns {string | null}
 */
export function bioProblem(tags) {
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t === "O") continue;
    if (!/^[BI]-(NP|VP|PP|ADJP|ADVP)$/.test(t)) return `bad tag ${t} at ${i + 1}`;
    if (t.startsWith("I-") && (i === 0 || tags[i - 1].slice(2) !== t.slice(2))) return `${t} at ${i + 1} does not continue a chunk`;
  }
  return null;
}

/**
 * Check heads form one tree: heads in range, exactly one root, no cycles.
 * @param {number[]} heads 1-based heads per word (0 = root)
 * @returns {string | null} problem description, or null if valid
 */
export function treeProblem(heads) {
  const n = heads.length;
  const roots = heads.filter((h) => h === 0).length;
  if (roots !== 1) return `${roots} roots`;
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(heads[i]) || heads[i] < 0 || heads[i] > n) return `head out of range at ${i + 1}`;
    if (heads[i] === i + 1) return `self-loop at ${i + 1}`;
  }
  for (let i = 0; i < n; i++) {
    let k = i + 1;
    for (let steps = 0; k !== 0; steps++) {
      if (steps > n) return `cycle through ${i + 1}`;
      k = heads[k - 1];
    }
  }
  return null;
}

/**
 * Align one sentence.
 * @param {import("./conllu.mjs").UdWord[]} ud UD words (sentence order)
 * @param {Array<{start: number, end: number}>} udSpans spans from locateUdWords
 * @param {Array<{text: string, start: number, end: number, sent: number}>} rt runtime words
 * @returns {{
 *   words: Array<{form: string, start: number, end: number, upos: string, chunk: string,
 *                 head: number, deprel: string, reviewed: boolean, wink_sent: number,
 *                 ud: number[], rule: string}>,
 *   udCategory: string[],
 *   multiExitMerges: number,
 *   chunkChanges: number,
 * }}
 */
export function alignSentence(ud, udSpans, rt) {
  const overlaps = (a, b) => a.start < b.end && a.end > b.start;
  // Runtime words overlapping each UD word, and UD words overlapping each runtime word.
  const pieces = ud.map(() => []);
  const covers = rt.map(() => []);
  let lo = 0;
  for (let u = 0; u < ud.length; u++) {
    while (lo < rt.length && rt[lo].end <= udSpans[u].start) lo++;
    for (let r = lo; r < rt.length && rt[r].start < udSpans[u].end; r++) {
      if (overlaps(udSpans[u], rt[r])) {
        pieces[u].push(r);
        covers[r].push(u);
      }
    }
    if (pieces[u].length === 0) throw new Error(`UD word ${ud[u].id} (${ud[u].form}) has no runtime word`);
  }
  for (let r = 0; r < rt.length; r++) {
    if (covers[r].length === 0) throw new Error(`runtime word ${JSON.stringify(rt[r].text)} has no UD word`);
  }

  const depth = depths(ud);
  const idToIdx = new Map(ud.map((w, i) => [w.id, i]));
  // Main piece of each UD word: first piece with a letter or digit (e.g. "'Akkab" → "Akkab").
  const main = pieces.map((ps) => ps.find((r) => HAS_ALNUM_RE.test(rt[r].text)) ?? ps[0]);
  const rep = (u) => main[u] + 1; // runtime word (1-based) that represents UD word u
  let multiExitMerges = 0;
  const chunkOf = new Array(rt.length); // UD chunk (index of its first word) per runtime word

  const words = rt.map((r, ri) => {
    const S = covers[ri];
    const base = { form: r.text, start: r.start, end: r.end, reviewed: true, wink_sent: r.sent };
    const starting = S.filter((u) => main[u] === ri);
    if (starting.length === 0) {
      // Non-main piece of a UD word whose main piece is another runtime word.
      const u = S[0];
      const type = chunkType(ud[u].chunk);
      chunkOf[ri] = type ? chunkStart(ud, u) : null;
      return {
        ...base,
        upos: HAS_ALNUM_RE.test(r.text) ? SPLIT_PIECE_UPOS : SPLIT_PUNCT_UPOS,
        chunk: type ? `I-${type}` : "O",
        head: rep(u),
        deprel: SPLIT_RELATION,
        ud: S.map((k) => ud[k].id),
        rule: "split-piece",
      };
    }
    // Head word: starting UD word whose head lies outside the runtime word.
    const inside = new Set(starting);
    let exits = starting.filter((u) => !inside.has(idToIdx.get(ud[u].head)));
    if (exits.length === 0) exits = starting; // cannot happen in a tree; kept for safety
    if (exits.length > 1) multiExitMerges++;
    const nonPunct = exits.filter((u) => ud[u].upos !== "PUNCT");
    const pool = nonPunct.length > 0 ? nonPunct : exits;
    const h = pool.reduce((best, u) => (depth[u] < depth[best] ? u : best), pool[0]);

    const udHead = ud[h].head;
    let head = 0;
    if (udHead !== 0) head = rep(idToIdx.get(udHead));
    const type = chunkType(ud[h].chunk);
    chunkOf[ri] = type ? chunkStart(ud, h) : null;
    const chunk = type ? `I-${type}` : "O";

    let rule;
    if (S.length === 1 && pieces[S[0]].length === 1) rule = "exact";
    else if (S.length === 1) rule = "split-first";
    else if (S.every((u) => pieces[u].length === 1)) {
      rule = HYPHENATED_RE.test(r.text) && r.text.includes("-") ? "merge:hyphen" : r.text.includes("'") ? "merge:other" : "merge:glued";
    } else rule = "complex";
    return { ...base, upos: ud[h].upos, chunk, head, deprel: ud[h].deprel, ud: S.map((k) => ud[k].id), rule };
  });

  // B- whenever the chunk differs from the previous runtime word's chunk.
  let chunkChanges = 0;
  words.forEach((w, i) => {
    if (w.chunk === "O") return;
    const type = w.chunk.slice(2);
    const continues = i > 0 && chunkOf[i - 1] === chunkOf[i] && words[i - 1].chunk !== "O";
    w.chunk = `${continues ? "I" : "B"}-${type}`;
    const udTag = w.rule === "exact" ? ud[idToIdx.get(w.ud[0])].chunk : null;
    if (udTag !== null && udTag !== w.chunk) chunkChanges++;
  });

  // Per-UD-word category for the agreement metric.
  const udCategory = ud.map((_, u) => {
    const ps = pieces[u];
    if (ps.length > 1) return ps.every((r) => covers[r].length === 1) ? "split" : "complex";
    const r = ps[0];
    if (covers[r].length === 1) {
      const sameSpan = rt[r].start === udSpans[u].start && rt[r].end === udSpans[u].end;
      return sameSpan ? "exact" : "complex";
    }
    return words[r].rule;
  });

  return { words, udCategory, multiExitMerges, chunkChanges };
}

/** Categories not counted in the agreement metric (by design). */
export const EXCLUDED_CATEGORIES = new Set(["merge:hyphen", "merge:glued"]);
