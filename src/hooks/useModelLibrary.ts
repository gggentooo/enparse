/**
 * src/hooks/useModelLibrary.ts — model library state and actions for components
 *
 * Description:
 *   Exposes the model library held by parserService: offered models with
 *   descriptions, sizes, accuracy, speed, device fit, download state, the
 *   active model, and actions (choose, download, cancel, delete).
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. Read the library part of parserService state with
 *      useSyncExternalStore(subscribe, getSnapshot) (selector; stable refs).
 *   2. Return { models (catalog entries + state + fitness), activeId,
 *      recommendedId, chooseModel, downloadModel, cancelDownload,
 *      deleteModel, error }.
 *   3. chooseModel(id): download if needed, then load (parserService).
 *      Action errors are kept in `error` (cleared by the next action) and
 *      not rethrown, so components can call actions from event handlers.
 *   4. Tests in useModelLibrary.test.ts with a mocked service (passed as the
 *      optional argument).
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/parserService.ts. Must not import modules directly.
 *   Used by: components/Pages/ModelsPage.tsx, components/Layout/Header.tsx,
 *            components/Pages/InputPage.tsx (no-model prompt).
 *
 * Status: implemented (T52). Tests: useModelLibrary.test.ts.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  type CardBadge,
  type CatalogEntry,
  type LibrarySnapshot,
  type ModelFitness,
  type ModelId,
  type ModelState,
  type ParserService,
  parserService,
} from "../services/parserService";

export type { CardBadge, CatalogEntry, ModelFitness, ModelId, ModelState } from "../services/parserService";

/** One offered model with its state on this device. */
export type LibraryModel = {
  entry: CatalogEntry;
  state: ModelState;
  fitness: ModelFitness | null;
  badges: readonly CardBadge[];
  recommended: boolean;
  active: boolean;
  /** Download size for this device's variant (null if no variant fits). */
  downloadBytes: number | null;
};

export type UseModelLibrary = {
  /** Catalog order; empty until the catalog has loaded. */
  models: readonly LibraryModel[];
  activeId: ModelId | null;
  recommendedId: ModelId | null;
  chooseModel: (id: ModelId) => Promise<void>;
  downloadModel: (id: ModelId) => Promise<void>;
  cancelDownload: (id: ModelId) => Promise<void>;
  deleteModel: (id: ModelId) => Promise<void>;
  error: Error | null;
};

const NOT_DOWNLOADED: ModelState = { state: "not-downloaded" };

function toModels(lib: LibrarySnapshot): LibraryModel[] {
  return (lib.catalog?.models ?? []).map((entry) => ({
    entry,
    state: lib.states[entry.id] ?? NOT_DOWNLOADED,
    fitness: lib.fitness.find((f) => f.id === entry.id) ?? null,
    badges: lib.badges[entry.id] ?? [],
    recommended: lib.recommendedId === entry.id,
    active: lib.activeId === entry.id,
    downloadBytes: lib.downloadBytes[entry.id] ?? null,
  }));
}

export function useModelLibrary(service: ParserService = parserService()): UseModelLibrary {
  const getLibrary = useCallback(() => service.getSnapshot().library, [service]);
  const library = useSyncExternalStore(service.subscribe, getLibrary, getLibrary);
  const models = useMemo(() => toModels(library), [library]);
  const [error, setError] = useState<Error | null>(null);

  const action = useCallback(
    (fn: (id: ModelId) => Promise<void>) =>
      async (id: ModelId): Promise<void> => {
        setError(null);
        try {
          await fn(id);
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      },
    [],
  );
  const actions = useMemo(
    () => ({
      chooseModel: action(service.chooseModel),
      downloadModel: action(service.downloadModel),
      cancelDownload: action(service.cancelDownload),
      deleteModel: action(service.deleteModel),
    }),
    [action, service],
  );

  return { models, activeId: library.activeId, recommendedId: library.recommendedId, ...actions, error };
}
