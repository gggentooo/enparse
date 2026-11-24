/**
 * src/modules/output/wordList.ts — the words of a parsed text (T101)
 *
 * Description:
 *   One entry per word of an annotation, for the vocabulary statistics popup
 *   (T105) and the word list made from a text (T106). Rules (owner, T100):
 *   - A word is its lemma (lower case) and part of speech (UPOS) in the
 *     primary reading: "run" (noun) and "run" (verb) are two words; "ran",
 *     "runs", "running" (verb) are one. Meanings within one part of speech
 *     cannot be told apart (the parse has none) and count as one word.
 *   - Left out: punctuation, symbols, numbers written with digits, and
 *     unclassified tokens (PUNCT, SYM, NUM with a digit, X). Proper nouns
 *     and auxiliaries keep their own parts of speech.
 *   - A phrasal verb marked by the parse ("looked … up") counts once, as
 *     the phrasal verb ("look up", VERB), not as its two words.
 *   - Shown form: the lemma; proper nouns as first written.
 *
 * Layer: modules/ (output)
 *
 * Exports: wordList, sortWords, POS_ORDER, WordEntry, WordSort.
 *
 * Dependencies:
 *   Internal: ./types.ts; utils/helpers.ts (lookupKey).
 *   Used by: ./index.ts (services/parserService.ts).
 *
 * Status: implemented (T101). Tests: wordList.test.ts.
 */

import { lookupKey } from "../../utils/helpers";
import type { Annotation } from "./types";

/** One word of a text. */
export type WordEntry = {
  /** Identity: lemma key and part of speech. */
  key: string;
  /** Shown form: the lemma ("run", "look up"), or a proper noun as first written ("Paris"). */
  word: string;
  /** Lemma (lower case). */
  lemma: string;
  upos: string;
  /** Times it occurs in the text. */
  count: number;
  /** Distinct written forms in order of first use ("ran", "runs"). */
  forms: string[];
  /** Text of the first sentence it occurs in. */
  sentence: string;
  /** A phrasal verb marked by the parse (verb + particle). */
  phrasal: boolean;
  /** What to look up in the dictionary (structurally a DictionaryQuery). */
  query: { word: string; lemma: string; upos: string };
};

/** Sort orders of the statistics popup. */
export type WordSort = "alpha" | "pos" | "frequency";

/** Part-of-speech order of the "part of speech" sort; other tags follow. */
export const POS_ORDER: readonly string[] = [
  "NOUN",
  "PROPN",
  "PRON",
  "VERB",
  "AUX",
  "ADJ",
  "ADV",
  "ADP",
  "DET",
  "NUM",
  "CCONJ",
  "SCONJ",
  "PART",
  "INTJ",
];

const LEFT_OUT = new Set(["PUNCT", "SYM", "X"]);
const DIGIT = /\p{Nd}/u;

/** The words of an annotation (primary readings), in order of first use. */
export function wordList(annotation: Annotation): WordEntry[] {
  const byKey = new Map<string, WordEntry>();
  const add = (lemma: string, upos: string, written: string, sentence: string, phrasal: boolean): void => {
    const key = `${lookupKey(lemma)}\u0000${upos}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.count++;
      if (!hit.forms.includes(written)) hit.forms.push(written);
      return;
    }
    byKey.set(key, {
      key,
      word: upos === "PROPN" ? written : lemma,
      lemma,
      upos,
      count: 1,
      forms: [written],
      sentence,
      phrasal,
      query: { word: written, lemma, upos },
    });
  };
  for (const s of annotation.sentences) {
    for (const t of s.tokens) {
      if (t.phrasal) {
        // Counted once, at the verb; the particle is part of it.
        if (t.index === t.phrasal.verb) add(t.phrasal.text, "VERB", t.phrasal.written, s.text, true);
        continue;
      }
      if (LEFT_OUT.has(t.upos) || (t.upos === "NUM" && DIGIT.test(t.text))) continue;
      const lemma = t.lemma ?? lookupKey(t.text);
      if (lemma.trim() === "") continue;
      add(lemma, t.upos, t.upos === "PROPN" ? t.text : t.text.toLowerCase(), s.text, false);
    }
  }
  return [...byKey.values()];
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const posRank = (upos: string): number => {
  const i = POS_ORDER.indexOf(upos);
  return i < 0 ? POS_ORDER.length : i;
};
const byWord = (a: WordEntry, b: WordEntry): number =>
  collator.compare(a.word, b.word) || posRank(a.upos) - posRank(b.upos) || a.upos.localeCompare(b.upos);

/**
 * Sorted copy: alphabetical (case-insensitive; same words by part of speech); by part of speech
 * (POS_ORDER), then alphabetical; by frequency (most used first), then alphabetical.
 */
export function sortWords(entries: readonly WordEntry[], by: WordSort): WordEntry[] {
  const out = [...entries];
  if (by === "alpha") return out.sort(byWord);
  if (by === "pos") return out.sort((a, b) => posRank(a.upos) - posRank(b.upos) || byWord(a, b));
  return out.sort((a, b) => b.count - a.count || byWord(a, b));
}
