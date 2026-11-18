/**
 * src/modules/modelLibrary/selection.ts — the user's model choice and a recommendation
 *
 * Description:
 *   Persists which model the user chose, and suggests one. The suggestion is
 *   only highlighted in the library; the user always chooses (no automatic
 *   first download).
 *
 * Layer: modules/ (modelLibrary)
 *
 * Tasks:
 *   1. getSavedChoice() / saveChoice(id) / clearChoice(): persisted with
 *      core/storage (key namespaced, schema-versioned). A saved choice that
 *      is no longer in the catalog is cleared.
 *   2. recommendModel(catalog, fitness): ModelId | null — fitness is plain
 *      data per model from pre-flight (blocked / warn / ok, expected parse
 *      time on this device's backend). Rule (proposed; plan.md →
 *      Undecided → Model library): among models not blocked and without
 *      memory warnings, the highest chunk F1 whose expected parse time meets
 *      the 5 s budget; ties → smaller download.
 *   3. On later visits parserService auto-loads the saved choice only if it
 *      is fully cached (no download without the user).
 *   4. Unit tests in selection.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts; core/storage.ts.
 *   Used by: ./index.ts.
 *
 * Open items (plan.md → Undecided): model library (recommendation rule).
 *
 * Status: header only; not implemented.
 */
