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
 *      time on this device's backend). Rule (proposed; todo.md →
 *      [Modules/modelLibrary]): among models not blocked and without
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
 * Open items (todo.md): model library (recommendation rule).
 *
 * Status: implemented (T37; rule confirmed by the owner, T22). Tests:
 *   selection.test.ts.
 */

import { type AppStorage, appStorage } from "../../core/storage";
import { downloadBytes } from "./catalog";
import type { CardBadge, Catalog, FitnessLike, ModelId } from "./types";

/** Storage key of the user's model choice. */
export const CHOICE_KEY = "modelLibrary/choice";

/** The saved choice, or null; a choice no longer in the catalog is cleared. */
export async function getSavedChoice(
  catalog: Catalog | null,
  storage: AppStorage = appStorage(),
): Promise<ModelId | null> {
  const v = await storage.get(CHOICE_KEY);
  if (typeof v !== "string") return null;
  if (catalog && !catalog.models.some((m) => m.id === v)) {
    await storage.remove(CHOICE_KEY);
    return null;
  }
  return v;
}

export async function saveChoice(id: ModelId, storage: AppStorage = appStorage()): Promise<void> {
  await storage.set(CHOICE_KEY, id);
}

export async function clearChoice(storage: AppStorage = appStorage()): Promise<void> {
  await storage.remove(CHOICE_KEY);
}

/**
 * Recommended model (owner, T22): among models not blocked, the highest chunk F1 whose
 * expected parse time on this device (its backend and speed tier; T65) is within
 * `budgetSeconds` (unknown times count as within); ties → smaller download for the device's
 * variant. Memory only warns device-wide (owner, T65: no per-model memory requirement).
 */
export function recommendModel(
  catalog: Catalog,
  fitness: readonly FitnessLike[],
  budgetSeconds: number,
): ModelId | null {
  const byId = new Map(fitness.map((f) => [f.id, f]));
  const candidates = catalog.models.filter((m) => {
    const f = byId.get(m.id);
    if (!f || f.verdict === "blocked" || f.variant === null) return false;
    return f.expectedParseSeconds === null || f.expectedParseSeconds <= budgetSeconds;
  });
  const size = (id: ModelId): number => {
    const m = catalog.models.find((x) => x.id === id);
    const v = byId.get(id)?.variant;
    return m && v ? downloadBytes(m, v) : Infinity;
  };
  candidates.sort((a, b) => b.metrics.chunk_f1 - a.metrics.chunk_f1 || size(a.id) - size(b.id));
  return candidates[0]?.id ?? null;
}

/** Card labels (T22): most accurate offered model; fastest on this device (expected parse time). */
export function cardBadges(catalog: Catalog, fitness: readonly FitnessLike[]): Record<ModelId, CardBadge[]> {
  const out: Record<ModelId, CardBadge[]> = Object.fromEntries(catalog.models.map((m) => [m.id, []]));
  const best = [...catalog.models].sort((a, b) => b.metrics.chunk_f1 - a.metrics.chunk_f1)[0];
  if (best) out[best.id]?.push("most-accurate");
  const timed = fitness.filter((f) => f.verdict !== "blocked" && f.expectedParseSeconds !== null);
  const fastest = [...timed].sort((a, b) => (a.expectedParseSeconds as number) - (b.expectedParseSeconds as number))[0];
  if (fastest && timed.length > 1) out[fastest.id]?.push("fastest-here");
  return out;
}
