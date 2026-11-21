/**
 * src/modules/subword/index.ts — public API of the subword module (proposed file)
 *
 * Description:
 *   Segments words into prefixes, base, suffixes, and inflection. Other
 *   layers import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (subword)
 *
 * Tasks:
 *   1. Re-export segment() from ./subwordParser.ts and the affix data.
 *   2. Re-export public types from ./types.ts.
 *   3. loadKnownWords(): the bundled NGSL list (T26), loaded on demand.
 *
 * Dependencies:
 *   Internal: ./subwordParser.ts, ./types.ts.
 *   Used by: services/subwordService.ts.
 *
 * Status: implemented (T41). The known-word list is exported lazily
 *   (loadKnownWords) so it stays out of the main bundle.
 */

export { AFFIXES, AFFIX_SOURCE, PREFIXES, SUFFIXES } from "./affixes";
export { MAX_AFFIXES, MIN_BASE_LENGTH, NO_SPLIT, inflectionEnding, segment } from "./subwordParser";
export type { Affix, AffixKind, KnownWordPredicate, Segment, SegmentKind, SubwordSegmentation } from "./types";

/** Load the bundled known-word list (NGSL 1.2, CC BY-SA 4.0; a separate chunk) as a predicate and its source. */
export async function loadKnownWords(): Promise<{
  isKnownWord: (word: string) => boolean;
  source: { name: string; url: string; license: string; attribution: string };
}> {
  const { KNOWN_WORDS, KNOWN_WORDS_SOURCE } = await import("./knownWords.generated");
  const set = new Set(KNOWN_WORDS.split("\n"));
  return { isKnownWord: (w) => set.has(w.toLowerCase()), source: KNOWN_WORDS_SOURCE };
}
