/**
 * src/hooks/testParserService.ts — mocked parserService for hook tests (T52; test-only)
 */

import { vi } from "vitest";
import {
  type LibrarySnapshot,
  type ModelStatus,
  type ParseOutcome,
  ParserNotReadyError,
  type ParserService,
  type ParserSnapshot,
} from "../services/parserService";

export const library: LibrarySnapshot = {
  catalog: null,
  states: {},
  fitness: [],
  badges: {},
  recommendedId: null,
  downloadBytes: {},
  activeId: null,
};

/** A service whose snapshot the test sets; actions are vi.fn. */
export function mockService(status: ModelStatus = { state: "no-model" }) {
  let snap: ParserSnapshot = {
    status,
    preflight: null,
    modelChecks: null,
    library,
    annotation: null,
    notice: null,
    draft: "",
  };
  const listeners = new Set<() => void>();
  const service: ParserService = {
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snap,
    start: vi.fn<ParserService["start"]>(async () => undefined),
    chooseModel: vi.fn<ParserService["chooseModel"]>(async () => undefined),
    downloadModel: vi.fn<ParserService["downloadModel"]>(async () => undefined),
    cancelDownload: vi.fn<ParserService["cancelDownload"]>(async () => undefined),
    deleteModel: vi.fn<ParserService["deleteModel"]>(async () => undefined),
    retryLoad: vi.fn<ParserService["retryLoad"]>(async () => undefined),
    setDraft: vi.fn<ParserService["setDraft"]>((draft) => update({ draft })),
    parseText: vi.fn<ParserService["parseText"]>(async (): Promise<ParseOutcome> => {
      throw new ParserNotReadyError();
    }),
  };
  const update = (patch: Partial<ParserSnapshot>): void => {
    snap = { ...snap, ...patch };
    for (const l of listeners) l();
  };
  return { service, update };
}
