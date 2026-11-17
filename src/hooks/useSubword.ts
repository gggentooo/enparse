/**
 * src/hooks/useSubword.ts — React hook for subword segmentation
 *
 * Description:
 *   Exposes subwordService to components for a selected word.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. segment(word, lemma) action; returns { segmentation, isLoading, error }.
 *   2. Ignore stale responses when the selection changes.
 *   3. Tests in useSubword.test.ts with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/subwordService.ts. Must not import modules directly.
 *   Used by: OutputPage, DictionaryPage.
 *
 * Status: header only; not implemented.
 */
