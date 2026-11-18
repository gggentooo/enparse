/**
 * src/modules/parser/winkBackend.ts — wink-nlp support: sentences, runtime words, lemmas
 *
 * Description:
 *   Used for sentence splitting, word tokenization, and lemmas. Not a
 *   ParserBackend and not used for tagging: the app parses only with the
 *   model (architecture.md → Model readiness).
 *
 * Layer: modules/ (parser). Runs only inside parser.worker.ts at runtime.
 *   Training tools run tokenize() directly via tsx (training/js/align_tokens.mjs),
 *   so training words match runtime words (plan-training.md → Phase 3).
 *
 * Word rules (on top of wink tokens; plan-training.md → Phase 3 *Decisions*):
 *   1. URLs and e-mail addresses are one word, and a sentence never ends
 *      inside one ("www.juancole.com", "Warner@ENRON"). Trailing sentence
 *      punctuation is not part of the URL.
 *   2. Hyphenated words are one word: tokens joined by a single "-" with no
 *      spaces and a letter or digit on both sides are merged
 *      ("mis-matches", "F-16-launched").
 *   3. Runs of one repeated symbol are one word ("***", "-----", ".........").
 *   4. Contractions are always split: 'm, 's, 're, 've, 'll, 'd, and n't
 *      become separate words ("I'm" → "I" + "'m", "don't" → "do" + "n't").
 *   If a merge crosses a wink sentence boundary, those sentences are joined.
 *   Input must already be preprocessed (input/preprocess: ASCII apostrophes).
 *
 * Tasks:
 *   1. Load wink-nlp with wink-eng-lite-web-model once. (done)
 *   2. tokenize(text) → sentences and words with character offsets. (done)
 *      TODO(lemma): lemmas per word, including split contraction pieces.
 *   3. Unit tests in winkBackend.test.ts. (tokenization done)
 *
 * Dependencies:
 *   External: wink-nlp 2.4.0, wink-eng-lite-web-model 1.8.1.
 *   Internal: ./types.ts.
 *   Used by: ./parser.worker.ts, ./parser.ts; training/js/align_tokens.mjs and
 *            training/js/evaluate_baselines.mjs (via tsx).
 *
 * Status: tokenization implemented (Phase 3 pre-work); lemmas pending.
 */

import winkNLP, { type ItemSentence, type WinkMethods } from "wink-nlp";
import model from "wink-eng-lite-web-model";
import { type SentenceSpan, TokenizerError, type WordSpan } from "./types";

/** Contraction endings split off as their own word (matched case-insensitively). */
export const CONTRACTION_SUFFIXES: readonly string[] = ["n't", "'m", "'s", "'re", "'ve", "'ll", "'d"];

/**
 * Top-level domains that mark a bare domain ("paulhastings.com") as a URL.
 * TLDs that are also English words (in, it, me, no, be, at, us, co, ...) are
 * left out so typos like "done.It" stay ordinary words; such domains are
 * still caught when written with a scheme or "www.". Must be lowercase in text.
 */
export const URL_TLDS: readonly string[] = [
  "com", "org", "net", "edu", "gov", "mil", "info", "biz", "io", "uk", "ca", "au", "nz", "de",
  "fr", "es", "nl", "ch", "se", "dk", "fi", "pl", "ru", "jp", "kr", "cn", "tw", "hk", "sg", "br",
  "mx", "za",
];

const CONTRACTION_RE = new RegExp(`^(.*[\\p{L}\\p{N}])(${CONTRACTION_SUFFIXES.join("|")})$`, "iu");
const ALNUM_END_RE = /[\p{L}\p{N}]$/u;
const ALNUM_START_RE = /^[\p{L}\p{N}]/u;
const SYMBOL_RUN_RE = /^([^\p{L}\p{N}\s])\1*$/u;
const URL_CHARS = "[\\p{L}\\p{N}\\-._~:/?#\\[\\]@!$&*+,;=%]";
const PROTECTED_RE = new RegExp(
  [
    // scheme or www URLs
    `(?:https?://|ftp://|www\\.)${URL_CHARS}+`,
    // e-mail addresses (host may lack a dot: "Warner@ENRON")
    `[\\p{L}\\p{N}._%+\\-]+@[\\p{L}\\p{N}\\-]+(?:\\.[\\p{L}\\p{N}\\-]+)*`,
    // bare domains with a known TLD, optional path
    `(?<![\\p{L}\\p{N}@.])[\\p{L}\\p{N}][\\p{L}\\p{N}\\-]*(?:\\.[\\p{L}\\p{N}\\-]+)*\\.(?:${URL_TLDS.join("|")})(?![\\p{L}\\p{N}])(?:/${URL_CHARS}*)?`,
  ].join("|"),
  "giu",
);
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"]+$/u;
const BARE_DOMAIN_EXEMPT_RE = /^(?:https?:\/\/|ftp:\/\/|www\.)/iu;

/** A runtime word while rules run: span, wink sentence id, and URL lock. */
type Piece = WordSpan & { sent: number; locked: boolean };

let nlp: WinkMethods | null = null;

function getNlp(): WinkMethods {
  // Loaded once; the model is ~4 MB, so loading is deferred to first use.
  nlp ??= winkNLP(model);
  return nlp;
}

function winkPieces(text: string): Piece[] {
  const pieces: Piece[] = [];
  let cursor = 0;
  getNlp()
    .readDoc(text)
    .sentences()
    .each((s: ItemSentence, sent: number) => {
      for (const tok of s.tokens().out()) {
        const start = text.indexOf(tok, cursor);
        if (start < 0) throw new TokenizerError(`token ${JSON.stringify(tok)} not found after offset ${cursor}`);
        pieces.push({ text: tok, start, end: start + tok.length, sent, locked: false });
        cursor = start + tok.length;
      }
    });
  return pieces;
}

/** URL and e-mail spans in the text, without trailing sentence punctuation. */
export function protectedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(PROTECTED_RE)) {
    const raw = m[0];
    const trimmed = raw.replace(TRAILING_PUNCT_RE, "");
    if (trimmed.length === 0) continue;
    if (!BARE_DOMAIN_EXEMPT_RE.test(trimmed) && !trimmed.includes("@")) {
      // Bare domain: its TLD must be written in lowercase ("Seoul.Com" is not a URL).
      const host = trimmed.split("/")[0] as string;
      const tld = host.slice(host.lastIndexOf(".") + 1);
      if (tld !== tld.toLowerCase()) continue;
    }
    spans.push([m.index, m.index + trimmed.length]);
  }
  return spans;
}

function span(text: string, start: number, end: number, sent: number, locked: boolean): Piece {
  return { text: text.slice(start, end), start, end, sent, locked };
}

/** Rule 1: each URL/e-mail span becomes one locked word; token parts outside it stay. */
function applyProtected(pieces: Piece[], text: string): Piece[] {
  const spans = protectedSpans(text);
  if (spans.length === 0) return pieces;
  const out: Piece[] = [];
  let i = 0;
  for (const [a, b] of spans) {
    while (i < pieces.length && (pieces[i] as Piece).end <= a) out.push(pieces[i++] as Piece);
    const covered: Piece[] = [];
    while (i < pieces.length && (pieces[i] as Piece).start < b) covered.push(pieces[i++] as Piece);
    if (covered.length === 0) continue;
    const first = covered[0] as Piece;
    const last = covered[covered.length - 1] as Piece;
    if (first.start < a) out.push(span(text, first.start, a, first.sent, false));
    out.push(span(text, a, b, first.sent, true));
    if (last.end > b) out.push(span(text, b, last.end, last.sent, false));
  }
  while (i < pieces.length) out.push(pieces[i++] as Piece);
  return out;
}

/** Merge runs of pieces for which `joins(prev, next, gap)` holds into one word. */
function mergeRuns(pieces: Piece[], text: string, step: number, joins: (run: Piece[], i: number) => boolean): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < pieces.length) {
    let j = i;
    while (j + step < pieces.length && joins(pieces, j)) j += step;
    const first = pieces[i] as Piece;
    const last = pieces[j] as Piece;
    out.push(j === i ? first : span(text, first.start, last.end, first.sent, false));
    i = j + 1;
  }
  return out;
}

/** Rule 2: `a - b` with no spaces and alphanumeric edges → one word. */
function mergeHyphenated(pieces: Piece[], text: string): Piece[] {
  return mergeRuns(pieces, text, 2, (p, j) => {
    const cur = p[j] as Piece;
    const hyphen = p[j + 1] as Piece;
    const next = p[j + 2] as Piece | undefined;
    return (
      next !== undefined &&
      !cur.locked &&
      !next.locked &&
      hyphen.text === "-" &&
      hyphen.start === cur.end &&
      next.start === hyphen.end &&
      ALNUM_END_RE.test(text.slice(cur.start, cur.end)) &&
      ALNUM_START_RE.test(next.text)
    );
  });
}

/** Rule 3: contiguous pieces made of one repeated symbol → one word. */
function mergeSymbolRuns(pieces: Piece[], text: string): Piece[] {
  return mergeRuns(pieces, text, 1, (p, j) => {
    const cur = p[j] as Piece;
    const next = p[j + 1] as Piece;
    if (cur.locked || next.locked || next.start !== cur.end) return false;
    const joined = text.slice(cur.start, next.end);
    return SYMBOL_RUN_RE.test(joined);
  });
}

/** Rule 4: split contraction endings off as separate words. */
function splitContractions(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const w of pieces) {
    const m = w.locked ? null : CONTRACTION_RE.exec(w.text);
    if (!m) {
      out.push(w);
      continue;
    }
    const cut = w.start + (m[1] as string).length;
    out.push({ ...w, text: w.text.slice(0, cut - w.start), end: cut });
    out.push({ ...w, text: w.text.slice(cut - w.start), start: cut });
  }
  return out;
}

/** Group pieces into sentences; a merged word joins the sentences it crosses. */
function toSentences(pieces: Piece[], original: Piece[]): SentenceSpan[] {
  // A word that spans several wink sentences makes them one sentence.
  // Sentence ids only grow along the text, so a later id maps to an earlier one.
  const root = new Map<number, number>();
  const find = (s: number): number => {
    let r = s;
    while (root.has(r)) r = root.get(r) as number;
    return r;
  };
  let k = 0;
  for (const w of pieces) {
    while (k < original.length && (original[k] as Piece).end <= w.start) k++;
    for (let m = k; m < original.length && (original[m] as Piece).start < w.end; m++) {
      const a = find(w.sent);
      const b = find((original[m] as Piece).sent);
      if (a !== b) root.set(Math.max(a, b), Math.min(a, b));
    }
  }
  const sentences: SentenceSpan[] = [];
  let curId: number | null = null;
  for (const w of pieces) {
    const id = find(w.sent);
    const word: WordSpan = { text: w.text, start: w.start, end: w.end };
    const last = sentences[sentences.length - 1];
    if (last !== undefined && id === curId) {
      last.words.push(word);
      last.end = w.end;
    } else {
      sentences.push({ start: w.start, end: w.end, words: [word] });
      curId = id;
    }
  }
  return sentences;
}

/** Split preprocessed text into sentences and runtime words with character offsets. */
export function tokenize(text: string): SentenceSpan[] {
  if (text.trim() === "") return [];
  const original = winkPieces(text);
  let pieces = applyProtected(original, text);
  pieces = mergeHyphenated(pieces, text);
  pieces = mergeSymbolRuns(pieces, text);
  pieces = splitContractions(pieces);
  return toSentences(pieces, original);
}
