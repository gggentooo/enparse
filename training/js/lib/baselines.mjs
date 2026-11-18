/**
 * training/js/lib/baselines.mjs — run wink-nlp and compromise on fixed words
 *
 * Description:
 *   Tags the Phase 3 runtime words with each baseline library and maps the
 *   result back onto the words, so baselines and the model are scored on the
 *   same segmentation.
 *
 * Phase: 5 — Baseline evaluation.
 *
 * Method:
 *   - Input: the sentence's words joined by single spaces (same pre-split
 *     view the model gets; labels.json → tokenizer_input). Original spacing
 *     is not used.
 *   - Alignment: each library token is located by character offset; a word
 *     takes the tag of the covering token that ends it best: the last token
 *     with a letter or digit inside the word (English compounds are
 *     head-final: "well-known" → "known"), else the first token.
 *     Zero-length tokens (compromise's implicit contraction terms) are ignored.
 *   - wink-nlp: its POS tags are already UPOS. No chunks (no rule-based
 *     chunker; the app has no fallback mode).
 *   - compromise: tags mapped to UPOS by compromiseTermUpos (punctuation by
 *     form; Conjunction → CCONJ / SCONJ by a closed coordinator list, `to` →
 *     PART; then COMPROMISE_UPOS, first match wins);
 *     chunk type from term.chunk by COMPROMISE_CHUNKS, chunk boundaries from
 *     compromise's own doc.chunks(); prepositions become their own PP chunk
 *     and punctuation / conjunctions / symbols are outside chunks. No other
 *     rules are added (the baseline stays compromise's own chunking).
 *
 * Dependencies: wink-nlp + model and compromise are passed in (instances),
 *   so this file has no imports and is unit-testable with fakes.
 *   Used by: ../evaluate_baselines.mjs, ../tests/baselines.test.mjs.
 *
 * Status: implemented (Phase 5).
 */

const HAS_ALNUM_RE = /[\p{L}\p{N}]/u;

/** compromise tag → UPOS, checked in order (first tag present wins). */
export const COMPROMISE_UPOS = [
  ["Pronoun", "PRON"],
  ["ProperNoun", "PROPN"],
  ["Determiner", "DET"],
  ["Preposition", "ADP"],
  ["Negative", "PART"],
  ["Modal", "AUX"],
  ["Auxiliary", "AUX"],
  ["Copula", "AUX"],
  ["Verb", "VERB"],
  ["Adjective", "ADJ"],
  ["Adverb", "ADV"],
  ["Value", "NUM"],
  ["Expression", "INTJ"],
  ["QuestionWord", "PRON"],
  ["Noun", "NOUN"],
];

/** compromise chunk → chunk type (Pivot: PP if the term is a preposition, else outside). */
export const COMPROMISE_CHUNKS = { Noun: "NP", Verb: "VP", Adjective: "ADJP" };

/**
 * Words joined by single spaces, with each word's span in the joined text.
 * @param {string[]} words
 */
export function joinWords(words) {
  const spans = [];
  let pos = 0;
  for (const w of words) {
    spans.push({ start: pos, end: pos + w.length });
    pos += w.length + 1;
  }
  return { text: words.join(" "), spans };
}

/**
 * Index of the token that decides each word's tag (-1 if none overlaps).
 * @param {Array<{start: number, end: number}>} wordSpans
 * @param {Array<{start: number, end: number, text: string}>} tokens
 * @returns {number[]}
 */
export function tokenForWords(wordSpans, tokens) {
  return wordSpans.map((w) => {
    const over = [];
    tokens.forEach((t, i) => {
      if (t.end > t.start && t.start < w.end && t.end > w.start) over.push(i);
    });
    if (over.length === 0) return -1;
    const alnum = over.filter((i) => HAS_ALNUM_RE.test(tokens[i].text));
    return alnum.length > 0 ? alnum[alnum.length - 1] : over[0];
  });
}

/** Locate token strings in text, left to right. */
function locate(text, values) {
  let cursor = 0;
  return values.map((v) => {
    const start = text.indexOf(v, cursor);
    if (start < 0) return { start: cursor, end: cursor, text: v };
    cursor = start + v.length;
    return { start, end: start + v.length, text: v };
  });
}

/**
 * wink-nlp UPOS per word.
 * @param {{ readDoc: Function, its: object }} nlp wink-nlp instance with model
 * @param {string[]} words
 * @returns {string[]}
 */
export function winkUpos(nlp, words) {
  const { text, spans } = joinWords(words);
  const doc = nlp.readDoc(text);
  const values = doc.tokens().out();
  const pos = doc.tokens().out(nlp.its.pos);
  const pick = tokenForWords(spans, locate(text, values));
  return pick.map((i) => (i < 0 ? "X" : pos[i]));
}

/** Coordinators among compromise `Conjunction` terms (the rest are subordinators). */
export const COORDINATORS = new Set(["and", "or", "but", "nor", "yet", "&", "plus"]);

/**
 * UPOS for one compromise term. Order: punctuation and symbols by form (compromise
 * tags some punctuation as nouns); `to` tagged Conjunction is compromise's
 * infinitive marker (PART); Conjunction splits into CCONJ (COORDINATORS) and
 * SCONJ; then COMPROMISE_UPOS.
 */
export function compromiseTermUpos(term) {
  if (!HAS_ALNUM_RE.test(term.text)) return /^[$%&+<=>@#^|~€£¥]+$/u.test(term.text) ? "SYM" : "PUNCT";
  const tags = new Set(term.tags);
  const lower = term.text.toLowerCase();
  if (tags.has("Conjunction") && !tags.has("Preposition")) {
    if (lower === "to") return "PART";
    return COORDINATORS.has(lower) ? "CCONJ" : "SCONJ";
  }
  for (const [tag, upos] of COMPROMISE_UPOS) if (tags.has(tag)) return upos;
  return "X";
}

/**
 * compromise UPOS and BIO chunk tag per word.
 * @param {Function} nlp compromise default export
 * @param {string[]} words
 * @returns {{ upos: string[], chunk: string[] }}
 */
export function compromiseTags(nlp, words) {
  const { text, spans } = joinWords(words);
  const doc = nlp(text);
  // compromise's own chunk boundaries (chunk identity), by character offset.
  const groups = doc.chunks().json({ offset: true }).map((c) => ({ start: c.offset.start, end: c.offset.start + c.offset.length }));
  const groupOf = (start) => groups.findIndex((g) => start >= g.start && start < g.end);
  const terms = doc
    .json({ offset: true, terms: { tags: true, offset: true, chunk: true } })
    .flatMap((s) => s.terms)
    .map((t) => ({
      text: t.text,
      start: t.offset.start,
      end: t.offset.start + t.offset.length,
      tags: t.tags,
      chunk: t.chunk,
      group: groupOf(t.offset.start),
    }));
  const pick = tokenForWords(spans, terms);
  const upos = pick.map((i) => (i < 0 ? "PUNCT" : compromiseTermUpos(terms[i])));
  // Chunk type per word; a new chunk starts when the type or compromise's chunk changes.
  const type = pick.map((i, w) => {
    if (i < 0) return null;
    if (upos[w] === "ADP") return "PP";
    if (["PUNCT", "CCONJ", "SCONJ", "SYM"].includes(upos[w])) return null;
    return COMPROMISE_CHUNKS[terms[i].chunk] ?? null;
  });
  const group = pick.map((i) => (i < 0 ? -1 : terms[i].group));
  const chunk = type.map((t, w) => {
    if (t === null) return "O";
    const continues = w > 0 && type[w - 1] === t && t !== "PP" && group[w - 1] === group[w];
    return `${continues ? "I" : "B"}-${t}`;
  });
  return { upos, chunk };
}
