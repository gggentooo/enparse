/**
 * src/hooks/useParser.ts — React hook for parsing
 *
 * Description:
 *   Exposes parserService to components: current annotation, model status
 *   (checking, loading progress, ready, failed reason), the pre-flight
 *   report, and parse actions.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. Read service state with useSyncExternalStore(subscribe, getSnapshot).
 *   2. Return { annotation, status, preflight, canParse, notice, error,
 *      isParsing, parseText, retryLoad }. canParse is true only when status
 *      is `ready`. preflight is the PreflightReport (null until checked).
 *   3. Local pending/error state per call.
 *   4. Tests in useParser.test.ts with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/parserService.ts. Must not import modules directly.
 *   Used by: InputPage, OutputPage, Header (model status indicator),
 *            Shared/DiagnosticsPanel (pre-flight details).
 *
 * Status: header only; not implemented.
 */
