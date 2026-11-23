/**
 * src/components/testUtils.tsx — helpers for component tests (test-only; T54–T57)
 *
 * Description:
 *   Renders a page inside a memory router (pages use Link and navigation)
 *   and builds a model library snapshot from the catalog fixture. Test code
 *   may import modules directly; app components may not.
 */

import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { type CardBadge, type ModelState, parseCatalog } from "../modules/modelLibrary";
import fixture from "../modules/modelLibrary/catalog.fixture.json";
import type { ModelFitness } from "../modules/preflight";
import type { LibrarySnapshot } from "../services/parserService";

export const catalog = parseCatalog(fixture);
/** The fixture's models in catalog order: Large (ModernBERT, the default) first, then Compact (DeBERTa; T43). */
export const [MODERNBERT, DEBERTA] = catalog.models as [
  (typeof catalog.models)[number],
  (typeof catalog.models)[number],
];

export const fit = (id: string, over: Partial<ModelFitness> = {}): ModelFitness => ({
  id,
  verdict: "ok",
  variant: "int8",
  reasons: [],
  expectedParseSeconds: 0.4,
  ...over,
});

/** Library with both fixture models (not downloaded, Large recommended) and optional overrides. */
export function fixtureLibrary(over: Partial<LibrarySnapshot> = {}): LibrarySnapshot {
  const states: Record<string, ModelState> = {
    [DEBERTA.id]: { state: "not-downloaded" },
    [MODERNBERT.id]: { state: "not-downloaded" },
  };
  const badges: Record<string, CardBadge[]> = { [MODERNBERT.id]: ["default"], [DEBERTA.id]: ["fastest-here"] };
  return {
    catalog,
    states,
    fitness: [fit(DEBERTA.id), fit(MODERNBERT.id, { expectedParseSeconds: 1.5 })],
    badges,
    recommendedId: MODERNBERT.id,
    downloadBytes: { [DEBERTA.id]: 90_000_000, [MODERNBERT.id]: 150_000_000 },
    activeId: null,
    ...over,
  };
}

/** Render `element` at `path`; other paths render their path name (to check navigation). */
export function renderPage(element: React.JSX.Element, path = "/", initialEntry: string = path) {
  const others = ["/input", "/output", "/models", "/vocab", "/dictionary"].filter((p) => p !== path);
  const router = createMemoryRouter(
    [{ path, element }, ...others.map((p) => ({ path: p, element: <p>route:{p}</p> }))],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
