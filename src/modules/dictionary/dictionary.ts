/**
 * src/modules/dictionary/dictionary.ts — dictionary lookup interface
 *
 * Description:
 *   Resolves a word (surface form + lemma + optional POS) to English and
 *   Korean definitions and example usages. Display is in components.
 *
 * Layer: modules/ (dictionary)
 *
 * Tasks:
 *   1. lookup(query): Promise<DictionaryEntry | null> — try lemma, then
 *      surface form; case-insensitive.
 *   2. Optional POS filter for sense ordering.
 *   3. In-memory LRU cache of recent lookups (DICTIONARY_CACHE_SIZE constant).
 *   4. Typed errors: DictionaryLoadError.
 *   5. Unit tests in dictionary.test.ts with a mocked staticDb.
 *
 * Dependencies:
 *   Internal: ./staticDb.ts, ./types.ts. External: none.
 *   Used by: services/dictionaryService.ts (via ./index.ts).
 *
 * Open items (plan.md → Undecided): lemmatization (headwords vs wink lemmas),
 *   multiword expressions, sense selection.
 *
 * Status: header only; not implemented.
 */
