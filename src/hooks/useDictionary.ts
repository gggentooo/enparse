/**
 * src/hooks/useDictionary.ts — React hook for dictionary lookup
 *
 * Description:
 *   Exposes dictionaryService to components with loading and error state.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. lookup(query) action; returns { entry, isLoading, error }.
 *   2. Ignore stale responses when the selection changes.
 *   3. Subscribe to shared service state if the service exposes it.
 *   4. Tests in useDictionary.test.ts with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/dictionaryService.ts. Must not import modules directly.
 *   Used by: OutputPage (inline lookup), DictionaryPage.
 *
 * Status: header only; not implemented.
 */
