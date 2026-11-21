/**
 * src/services/subwordService.ts — subword segmentation service
 *
 * Description:
 *   On-demand segmentation of a selected word (surface form + lemma from the
 *   parse result) into prefixes, base, suffixes, and inflection.
 *
 * Layer: services/
 *
 * Tasks:
 *   1. segmentWord(word, lemma): Promise<SubwordSegmentation>.
 *   2. Provide the known-word predicate required by modules/subword: the
 *      bundled NGSL list (owner, T26), loaded on first use.
 *   3. Cache results per (word, lemma).
 *   4. Tests in subwordService.test.ts with a mocked module.
 *
 * Dependencies:
 *   Internal: modules/subword (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useSubword.ts.
 *
 * Status: implemented (T41). Tests: subwordService.test.ts.
 */

import { type KnownWordPredicate, type SubwordSegmentation, loadKnownWords, segment } from "../modules/subword";

export type { SubwordSegmentation } from "../modules/subword";

/** Results kept per (word, lemma); the oldest is dropped beyond this. */
export const SEGMENT_CACHE_SIZE = 500;

export type SubwordService = {
  /** Segment a word (surface form + wink lemma from the parse; null lemma → the word itself). */
  segmentWord(word: string, lemma: string | null): Promise<SubwordSegmentation>;
};

/** Create the service; tests inject the known-word loader. */
export function createSubwordService(
  load: () => Promise<{ isKnownWord: KnownWordPredicate }> = loadKnownWords,
): SubwordService {
  let known: Promise<KnownWordPredicate> | null = null;
  const cache = new Map<string, SubwordSegmentation>();
  return {
    async segmentWord(word, lemma) {
      const key = `${word}\u0000${lemma ?? ""}`;
      const hit = cache.get(key);
      if (hit) return hit;
      known ??= load()
        .then((k) => k.isKnownWord)
        .catch((e: unknown) => {
          known = null; // retry on the next call
          throw e;
        });
      const result = segment(word, lemma, await known);
      cache.set(key, result);
      if (cache.size > SEGMENT_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      return result;
    },
  };
}

let shared: SubwordService | null = null;
/** The app's subword service (created on first use). */
export function subwordService(): SubwordService {
  shared ??= createSubwordService();
  return shared;
}
