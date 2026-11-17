/**
 * src/modules/dictionary/index.ts — public API of the dictionary module (proposed file)
 *
 * Description:
 *   Word lookup against the static local dictionary database. Other layers
 *   import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (dictionary)
 *
 * Tasks:
 *   1. Re-export lookup() from ./dictionary.ts.
 *   2. Re-export public types and errors from ./types.ts.
 *   3. Do not export staticDb internals.
 *
 * Dependencies:
 *   Internal: ./dictionary.ts, ./types.ts.
 *   Used by: services/dictionaryService.ts.
 *
 * Status: header only; not implemented.
 */
