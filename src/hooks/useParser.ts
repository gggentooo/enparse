/**
 * src/hooks/useParser.ts — React hook for parsing
 *
 * Description:
 *   Exposes parserService to components: current annotation, model status
 *   (checking, no-model, downloading/loading progress, ready with the active
 *   model, failed reason), the pre-flight report, and parse actions. Model
 *   choice lives in hooks/useModelLibrary.ts.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. Read service state with useSyncExternalStore(subscribe, getSnapshot).
 *   2. Return { annotation, draft, setDraft, status, preflight, modelChecks,
 *      canParse, notice, error, isParsing, parseText, retryLoad }. canParse
 *      is true only when status is `ready`. preflight is the device
 *      PreflightReport (null until checked); modelChecks the chosen model's
 *      report. draft is the input text kept across pages (T56). shared,
 *      shareKind, shareLink, shareFile, openShared: shared results (T99).
 *      words: the words of the shown text (T101).
 *   3. Local pending/error state per call; a superseded parse is ignored
 *      (resolves null, no error).
 *   4. Tests in useParser.test.ts with a mocked service (passed as the
 *      optional argument; components use the shared service).
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/parserService.ts. Must not import modules directly.
 *   Used by: InputPage, OutputPage, Header (model status indicator),
 *            Shared/DiagnosticsPanel (pre-flight details).
 *
 * Status: implemented (T52). Tests: useParser.test.ts.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  type ModelStatus,
  type ParseOutcome,
  type Annotation,
  ParseSupersededError,
  type ParserService,
  type PreflightReport,
  type PreprocessResult,
  type ShareKind,
  type SharedSource,
  type WordEntry,
  parserService,
  wordsOf,
} from "../services/parserService";

export type {
  AnnotatedNode,
  AnnotatedPhraseNode,
  AnnotatedSentence,
  AnnotatedToken,
  AnnotatedWordNode,
  Annotation,
  CategoryKind,
  CheckResult,
  CheckStatus,
  ChunkKind,
  FailureReason,
  FlatSegment,
  Fork,
  ModelStatus,
  PreflightReport,
  PreprocessResult,
  Reading,
  ReadingNote,
  RoleKind,
  ShareErrorReason,
  ShareKind,
  SharedSource,
  WordEntry,
  WordSort,
} from "../services/parserService";
export {
  MAX_INPUT_CHARS,
  POS_ORDER,
  sortWords,
  SHARE_LINK_MAX_CHARS,
  SHARE_MAX_FILE_BYTES,
  ShareFormatError,
} from "../services/parserService";

export type UseParser = {
  status: ModelStatus;
  preflight: PreflightReport | null;
  modelChecks: PreflightReport | null;
  /** Annotation of the last parse. */
  annotation: Annotation | null;
  /** Input text being edited (kept across pages). */
  draft: string;
  setDraft: (text: string) => void;
  /** Removal report of the last parsed input (null if nothing was removed). */
  notice: PreprocessResult | null;
  canParse: boolean;
  isParsing: boolean;
  /** Error of the last parseText or retryLoad call (cleared by the next call). */
  error: Error | null;
  /** Parse raw input; null if a newer parse replaced it. Errors are also kept in `error`. */
  parseText: (raw: string) => Promise<ParseOutcome | null>;
  retryLoad: () => Promise<void>;
  /** The annotation is a shared result opened from a link or file (T99). */
  shared: boolean;
  /** How the shown result would be shared (null with no result). */
  shareKind: ShareKind | null;
  /** Data part of a share link for the shown result. */
  shareLink: () => Promise<string>;
  /** Content of a share file for the shown result. */
  shareFile: () => string;
  /** Show a shared result; rejects with ShareFormatError if it cannot be read. */
  openShared: (source: SharedSource) => Promise<void>;
  /** The words of the shown text (T101; null with no result). */
  words: readonly WordEntry[] | null;
};

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export function useParser(service: ParserService = parserService()): UseParser {
  const snap = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const parseText = useCallback(
    async (raw: string): Promise<ParseOutcome | null> => {
      setError(null);
      setPending((n) => n + 1);
      try {
        return await service.parseText(raw);
      } catch (e) {
        if (e instanceof ParseSupersededError) return null;
        setError(asError(e));
        throw e;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [service],
  );

  const retryLoad = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await service.retryLoad();
    } catch (e) {
      setError(asError(e));
    }
  }, [service]);

  return {
    status: snap.status,
    preflight: snap.preflight,
    modelChecks: snap.modelChecks,
    annotation: snap.annotation,
    draft: snap.draft,
    setDraft: service.setDraft,
    notice: snap.notice,
    canParse: snap.status.state === "ready",
    isParsing: pending > 0,
    error,
    parseText,
    retryLoad,
    shared: snap.shared,
    shareKind: snap.shareKind,
    shareLink: service.shareLink,
    shareFile: service.shareFile,
    openShared: service.openShared,
    words: snap.annotation ? wordsOf(snap.annotation) : null,
  };
}
