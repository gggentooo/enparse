/**
 * src/core/storage.ts — persistent storage wrapper
 *
 * Description:
 *   Async key-value persistence for the app. LocalStorage for small data,
 *   IndexedDB for larger datasets. Infrastructure layer: imports no other layer.
 *
 * Layer: core/
 *
 * Tasks:
 *   1. Async API: get<T>(key), set<T>(key, value), remove(key), keys(prefix).
 *   2. Pick backend per call site or by size threshold (STORAGE_SIZE_THRESHOLD).
 *   3. Values serialized as JSON; validate on read (unknown → narrowed by caller).
 *   4. Typed errors: StorageUnavailableError, StorageQuotaError.
 *   5. Namespace keys with an app prefix and schema version.
 *
 * Dependencies:
 *   Browser APIs: localStorage, indexedDB. No external libraries.
 *   Used by: modules/vocab (vocabManager), services (via modules).
 *
 * Open items (todo.md): LocalStorage vs IndexedDB threshold;
 *   backup and data-loss warnings.
 *
 * Status: header only; not implemented.
 */
