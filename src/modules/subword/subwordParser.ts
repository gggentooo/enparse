/**
 * src/modules/subword/subwordParser.ts — rule-based word segmenter
 *
 * Description:
 *   Splits a word (plus its wink lemma) into prefixes, base, suffixes, and
 *   inflection, e.g. unhappiness → un- + happy + -ness.
 *
 * Layer: modules/ (subword)
 *
 * Tasks:
 *   1. Inflection from lemma: running + run → run + -ing.
 *   2. Strip derivational affixes from ./affixes.ts, longest match first,
 *      with spelling rules (e.g., happi- → happy).
 *   3. Accept a split only if the remaining base is a known word or lemma
 *      (under ≠ un- + der). The known-word check is an injected predicate
 *      (isKnownWord), since this module cannot import modules/dictionary.
 *   4. Return SubwordSegmentation (ordered segments with type and gloss id).
 *   5. Unit tests in subwordParser.test.ts (false splits, stacked affixes).
 *
 * Dependencies:
 *   Internal: ./affixes.ts, ./types.ts. External: none.
 *   Used by: services/subwordService.ts (via ./index.ts).
 *
 * Rules:
 *   - Inflection comes from the wink lemma: the word minus the lemma, with
 *     spelling changes (running, making, happier, cities); an unrelated form
 *     (ran ← run) is an irregular inflection.
 *   - Derivation: prefixes and suffixes from ./affixes.ts are stripped,
 *     longest spelling first, restoring the base's spelling (happi → happy,
 *     fam → fame, creat → create, abil → able, deci → decide). A split counts
 *     only if what remains is a known word (isKnownWord) at every step
 *     (unhappiness → happiness → happy; under ≠ un- + der); the word's own
 *     lemma counts as known.
 *   - Best split: most affixes; then the longest base; then the longest affixes;
 *     then more suffixes (really = real + -ly, not re- + ally).
 *   - Bases are at least MIN_BASE_LENGTH letters; NO_SPLIT lists frequent
 *     words that look derived but are not (corner ≠ corn + -er).
 *
 * Status: implemented (T41). Tests: subwordParser.test.ts.
 */

import { spellings } from "./affixes";
import type { Affix, KnownWordPredicate, Segment, SubwordSegmentation } from "./types";

/** Shortest base kept after stripping an affix. */
export const MIN_BASE_LENGTH = 3;
/** Most affixes stripped from one word. */
export const MAX_AFFIXES = 4;

/**
 * Words that look derived but whose apparent base is an unrelated English word (manage ≠ man +
 * -age; really ≠ re- + ally; design ≠ de- + sign). Found by running the parser over all NGSL
 * headwords and reviewing every split (T41, 2026-11-21). They can still be bases of other words
 * (unimportant = un- + important).
 */
// prettier-ignore
export const NO_SPLIT: ReadonlySet<string> = new Set([
  "agent", "ally", "arise", "army", "belly", "bother", "bully", "busy", "capability", "capable", "career",
  "carry", "center", "city", "comedy", "copy", "corner", "counter", "county", "define", "delay", "delight",
  "depress", "depression", "deserve", "design", "designer", "detail", "device", "devote", "discount",
  "discover", "discovery", "disease", "dismiss", "display", "early", "earth", "encounter", "entire",
  "entirely", "entry", "ever", "every", "exact", "exactly", "except", "exception", "excite", "excitement",
  "explain", "expose", "exposure", "express", "expression", "extend", "extension", "extent", "final",
  "finally", "finance", "financial", "finish", "flower", "former", "forth", "hammer", "hunger", "image",
  "importance", "important", "impose", "impress", "impression", "impressive", "improve", "improvement",
  "inform", "information", "insist", "insurance", "insure", "intend", "legal", "letter", "listen", "listener",
  "logic", "manage", "management", "manager", "manner", "many", "mature", "mention", "message", "metal",
  "meter", "mission", "mister", "moment", "moral", "north", "notion", "number", "offer", "party", "passion",
  "pension", "pity", "policy", "portion", "present", "preserve", "pretend", "primarily", "primary", "profile",
  "profit", "proper", "properly", "proportion", "proposal", "propose", "protest", "random", "ready",
  "recent", "record", "recover", "recovery", "relate", "remain", "remark", "remember", "remind", "remove",
  "repair", "report", "represent", "representation", "representative", "reserve", "resign", "resolution",
  "resolve", "resort", "resource", "restore", "restrict", "restriction", "retail", "retire", "retirement",
  "return", "salary", "seal", "secretary", "section", "secure", "security", "sentence", "several", "shoulder",
  "shower", "station", "story", "summary", "summer", "talent", "tender", "tension", "than", "then", "theory",
  "they", "tooth", "topic", "translate", "trial", "understand", "university", "unless", "until", "website",
  "youth",
]);

const PREFIX_SPELLINGS = spellings("prefix");
const SUFFIX_SPELLINGS = spellings("suffix");
const INFLECTIONS = ["ing", "est", "ed", "er", "es", "s", "d"];
const VOWEL = /[aeiou]/;

/** Inflectional ending of `word` relative to its lemma, or null if the form is irregular. */
export function inflectionEnding(word: string, lemma: string): string | null {
  for (const e of INFLECTIONS) {
    if (word === lemma + e) return e;
    // making ← make, closed ← close
    if (lemma.endsWith("e") && word === lemma.slice(0, -1) + e) return e;
    // running ← run, bigger ← big
    const last = lemma.slice(-1);
    if (last && !VOWEL.test(last) && word === lemma + last + e) return e;
    // happier, cities, tried ← happy, city, try
    if (lemma.endsWith("y") && word === `${lemma.slice(0, -1)}i${e}`) return e;
  }
  return null;
}

/** Spellings of the base before `suffix` was added to `stem` (stem = word minus the suffix). */
function baseCandidates(stem: string, suffix: string): string[] {
  const out = [stem];
  // A final e drops before a vowel suffix (fame → famous, create → creative).
  if (/^[aeiouy]/.test(suffix)) out.push(`${stem}e`);
  if (stem.endsWith("i")) out.push(`${stem.slice(0, -1)}y`);
  if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1) && !VOWEL.test(stem.slice(-1)))
    out.push(stem.slice(0, -1));
  if (stem.endsWith("bil")) out.push(`${stem.slice(0, -3)}ble`); // ability ← able
  if (suffix === "sion") out.push(`${stem}de`, `${stem}d`); // decision ← decide, extension ← extend
  if (suffix === "ation" || suffix === "ion") out.push(`${stem}ate`); // creation ← create (via -ion)
  if (suffix === "ly" && stem.endsWith("al")) out.push(stem.slice(0, -2)); // basically ← basic
  if (suffix === "ly") out.push(`${stem}le`, `${stem}l`); // simply ← simple, fully ← full
  return [...new Set(out)];
}

type Parse = {
  prefixes: Array<{ text: string; affix: Affix }>;
  base: string;
  suffixes: Array<{ text: string; affix: Affix }>;
};

const affixCount = (p: Parse): number => p.prefixes.length + p.suffixes.length;
const better = (a: Parse, b: Parse | null): boolean => {
  if (!b) return true;
  if (affixCount(a) !== affixCount(b)) return affixCount(a) > affixCount(b);
  if (a.base.length !== b.base.length) return a.base.length > b.base.length;
  const len = (p: Parse): number => [...p.prefixes, ...p.suffixes].reduce((s, x) => s + x.text.length, 0);
  if (len(a) !== len(b)) return len(a) > len(b);
  // Suffix analyses are more reliable than prefix ones (really = real + -ly, not re- + ally).
  return a.suffixes.length > b.suffixes.length;
};

/**
 * Best derivational parse of `x`: each stripped affix must leave a known word (unhappiness →
 * happiness → happy), so short spellings cannot chain into false analyses; null if `x` is not
 * known. The caller treats the word itself as known.
 */
function derive(
  x: string,
  known: (w: string) => boolean,
  depth: number,
  memo: Map<string, Parse | null>,
): Parse | null {
  const key = `${x}|${depth}`;
  if (memo.has(key)) return memo.get(key) as Parse | null;
  if (!known(x)) {
    memo.set(key, null);
    return null;
  }
  let best: Parse = { prefixes: [], base: x, suffixes: [] };
  if (depth < MAX_AFFIXES && !NO_SPLIT.has(x)) {
    for (const p of PREFIX_SPELLINGS) {
      if (!x.startsWith(p.text)) continue;
      const rest = x.slice(p.text.length).replace(/^-/, "");
      if (rest.length < MIN_BASE_LENGTH) continue;
      const sub = derive(rest, known, depth + 1, memo);
      if (sub) {
        const cand = { ...sub, prefixes: [p, ...sub.prefixes] };
        if (better(cand, best)) best = cand;
      }
    }
    for (const sfx of SUFFIX_SPELLINGS) {
      if (!x.endsWith(sfx.text)) continue;
      const stem = x.slice(0, -sfx.text.length).replace(/-$/, "");
      for (const b of baseCandidates(stem, sfx.text)) {
        if (b.length < MIN_BASE_LENGTH) continue;
        const sub = derive(b, known, depth + 1, memo);
        if (sub) {
          const cand = { ...sub, suffixes: [...sub.suffixes, sfx] };
          if (better(cand, best)) best = cand;
        }
      }
    }
  }
  memo.set(key, best);
  return best;
}

/**
 * Segment a word into prefixes, base, suffixes, and inflection (see the header).
 * @param word the word as written
 * @param lemma its wink lemma (Token.lemma); null → the word itself
 * @param isKnownWord known-word check for bases (lower-case input)
 */
export function segment(word: string, lemma: string | null, isKnownWord: KnownWordPredicate): SubwordSegmentation {
  const w = word.toLowerCase();
  const lem = (lemma ?? word).toLowerCase();
  const known = (x: string): boolean => x === lem || isKnownWord(x);
  const parse = /^[a-z][a-z'-]*$/.test(lem) ? derive(lem, known, 0, new Map()) : null; // lem is known by definition
  const segments: Segment[] = [];
  if (parse && affixCount(parse) > 0) {
    for (const p of parse.prefixes) segments.push({ text: p.text, kind: "prefix", affix: p.affix });
    segments.push({ text: parse.base, kind: "base" });
    for (const s of parse.suffixes) segments.push({ text: s.text, kind: "suffix", affix: s.affix });
  } else segments.push({ text: lem, kind: "base" });
  if (w !== lem) {
    const ending = inflectionEnding(w, lem);
    segments.push(
      ending === null ? { text: w, kind: "inflection", irregular: true } : { text: ending, kind: "inflection" },
    );
  }
  return { word, lemma: lem, segments };
}
