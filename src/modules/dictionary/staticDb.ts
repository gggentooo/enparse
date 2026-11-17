/**
 * src/modules/dictionary/staticDb.ts — static dictionary database adapter
 *
 * Description:
 *   Loads and queries the precompiled static dictionary database. Only
 *   fetches static files from the app's own static host; no live APIs.
 *
 * Layer: modules/ (dictionary)
 *
 * Tasks:
 *   1. Locate shards by headword (sharding scheme TBD) and fetch lazily.
 *   2. Parse and validate shard data (unknown → narrowed types).
 *   3. Keep loaded shards in memory; optional persistent cache.
 *   4. Throw DictionaryLoadError on fetch/parse failures.
 *
 * Dependencies:
 *   Internal: ./types.ts. Browser APIs: fetch.
 *   External: possibly SQLite-WASM (only if chosen; needs approval).
 *   Used by: ./dictionary.ts.
 *
 * Open items (plan.md → Undecided): data sources and licensing; storage
 *   format (JSON vs SQLite-WASM); hosting, sharding, offline caching; build
 *   pipeline location.
 *
 * Status: header only; not implemented.
 */
