/**
 * src/services/parserService.ts — parsing workflow service
 *
 * Description:
 *   Runs model readiness (pre-flight checks → model load → file verification)
 *   and the parse chain for the UI: preprocess → parse in the Web Worker →
 *   build annotations. Holds parser state (model status, pre-flight report,
 *   last result) and exposes it via subscribe() / getSnapshot().
 *
 * Layer: services/
 *
 * Tasks:
 *   1. start() at app start (architecture.md → Model readiness → Pre-flight checks):
 *      a. status `checking`: modules/preflight runDeviceChecks(); verdict
 *         `blocked` → status `failed: unsupported` (no model download).
 *      b. runModelChecks(labels.json URL); `blocked` → `failed: invalid-model`
 *         (or `unsupported` for quota); warnings are kept in the report.
 *      c. Create the parser worker once and load the model (status `loading`
 *         with progress) → worker self-test → `ready`.
 *      d. verifyModelFiles() after a fresh download; mismatch → `failed:
 *         invalid-model` (bad cache entries already deleted).
 *   2. parseText(raw): Promise<ParseOutcome> — rejects with ParserNotReadyError
 *      unless the model status is `ready` (no worker call); otherwise
 *      modules/input preprocess (surface InputTooLongError and removal report)
 *      → worker parse → modules/output annotate.
 *   3. Shared state: model status (idle | checking | loading + progress |
 *      ready | failed + reason), pre-flight report (PreflightReport | null),
 *      last annotation, last removal notice. subscribe()/getSnapshot() with
 *      immutable snapshots.
 *   4. retryLoad(): rerun start() from step a after a `failed` status.
 *   5. Cancel or ignore stale results when a new parse starts.
 *   6. Tests in parserService.test.ts with mocked modules and worker: blocked
 *      pre-flight never creates the worker; parseText() rejects before
 *      `ready`; integrity failure after load ends in `failed`.
 *
 * Dependencies:
 *   Internal: modules/input, modules/preflight, modules/parser, modules/output
 *             (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useParser.ts.
 *
 * Status: header only; not implemented.
 */
