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
 *   2. recommendModel(catalog, fitness, budget, failed): ModelId | null —
 *      fitness is plain data per model from pre-flight (blocked / warn / ok,
 *      expected parse time on this device). Rule (owner, 2026-11-23; T43):
 *      the first model in catalog order (the default, Large; then its
 *      backup, Compact) that is not blocked, has a variant, meets the 5 s
 *      budget on this device, and has not failed to load here.
 *   2b. cardBadges(): "default" on the catalog's first model (replaces "most
 *      accurate"; owner, T43), "fastest-here" by expected parse time.
 *   3. On later visits parserService auto-loads the saved choice only if it
 *      is fully cached (no download without the user).
 *   4. Unit tests in selection.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts; core/storage.ts.
 *   Used by: ./index.ts.
 *
 * Status: implemented (T37; rule T22, replaced by the default-first rule in T43). Tests:
 *   selection.test.ts.
 */

import { type AppStorage, appStorage } from "../../core/storage";
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
 * Recommended model (owner, 2026-11-23; T43, replaces the T22 chunk-F1 rule): the first model in
 * catalog order (the default first, then its backups) that is not blocked, has a variant for this
 * device, parses 5,000 characters within `budgetSeconds` on it (its backend and speed tier, T65;
 * unknown times count as within), and has not failed to load on this device (`failed`). Memory
 * only warns device-wide (owner, T65).
 */
export function recommendModel(
  catalog: Catalog,
  fitness: readonly FitnessLike[],
  budgetSeconds: number,
  failed: ReadonlySet<ModelId> = new Set(),
): ModelId | null {
  const byId = new Map(fitness.map((f) => [f.id, f]));
  const pick = catalog.models.find((m) => {
    const f = byId.get(m.id);
    if (!f || f.verdict === "blocked" || f.variant === null || failed.has(m.id)) return false;
    return f.expectedParseSeconds === null || f.expectedParseSeconds <= budgetSeconds;
  });
  return pick?.id ?? null;
}

/** Card labels: the default model (the catalog's first; owner, T43); fastest on this device (expected parse time). */
export function cardBadges(catalog: Catalog, fitness: readonly FitnessLike[]): Record<ModelId, CardBadge[]> {
  const out: Record<ModelId, CardBadge[]> = Object.fromEntries(catalog.models.map((m) => [m.id, []]));
  const first = catalog.models[0];
  if (first) out[first.id]?.push("default");
  const timed = fitness.filter((f) => f.verdict !== "blocked" && f.expectedParseSeconds !== null);
  const fastest = [...timed].sort((a, b) => (a.expectedParseSeconds as number) - (b.expectedParseSeconds as number))[0];
  if (fastest && timed.length > 1) out[fastest.id]?.push("fastest-here");
  return out;
}
