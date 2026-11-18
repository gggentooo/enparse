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
 *   4. Tests in useModelLibrary.test.ts with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/parserService.ts. Must not import modules directly.
 *   Used by: components/Pages/ModelsPage.tsx, components/Layout/Header.tsx,
 *            components/Pages/InputPage.tsx (no-model prompt).
 *
 * Status: header only; not implemented.
 */
