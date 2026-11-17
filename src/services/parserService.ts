/**
 * src/services/parserService.ts — parsing workflow service
 *
 * Description:
 *   Runs the parse chain for the UI: preprocess → parse in the Web Worker →
 *   build annotations. Holds parser state (mode, load progress, last result)
 *   and exposes it via subscribe() / getSnapshot().
 *
 * Layer: services/
 *
 * Tasks:
 *   1. Create the parser worker once (lazy, on first use or app start).
 *   2. parseText(raw): Promise<ParseOutcome> — modules/input preprocess
 *      (surface InputTooLongError and removal report) → worker parse →
 *      modules/output annotate.
 *   3. Shared state: mode (model | basic), model load progress, last
 *      annotation, last removal notice. subscribe()/getSnapshot() with
 *      immutable snapshots.
 *   4. reparse(): re-run the last input once the model is ready (basic → model).
 *   5. Cancel or ignore stale results when a new parse starts.
 *   6. Tests in parserService.test.ts with mocked modules and worker.
 *
 * Dependencies:
 *   Internal: modules/input, modules/parser, modules/output (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useParser.ts.
 *
 * Status: header only; not implemented.
 */
