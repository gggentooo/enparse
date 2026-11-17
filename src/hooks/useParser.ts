/**
 * src/hooks/useParser.ts — React hook for parsing
 *
 * Description:
 *   Exposes parserService to components: current annotation, mode, model
 *   load progress, and parse actions.
 *
 * Layer: hooks/
 *
 * Tasks:
 *   1. Read service state with useSyncExternalStore(subscribe, getSnapshot).
 *   2. Return { annotation, mode, progress, notice, error, isParsing,
 *      parseText, reparse }.
 *   3. Local pending/error state per call.
 *   4. Tests in useParser.test.ts with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: services/parserService.ts. Must not import modules directly.
 *   Used by: InputPage, OutputPage, Header (mode indicator).
 *
 * Status: header only; not implemented.
 */
