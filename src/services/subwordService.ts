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
 *   2. Provide the known-word predicate required by modules/subword for
 *      base validation (source TBD; see open items).
 *   3. Cache results per (word, lemma).
 *   4. Tests in subwordService.test.ts with a mocked module.
 *
 * Dependencies:
 *   Internal: modules/subword (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useSubword.ts.
 *
 * Open items (plan.md → Undecided): source of the known-word list for base
 *   validation; affix inventory.
 *
 * Status: header only; not implemented.
 */
