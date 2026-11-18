/**
 * src/services/parserService.ts — parsing workflow service
 *
 * Description:
 *   Runs the model library and model readiness (pre-flight checks → user's
 *   model choice → download → load) and the parse chain for the UI:
 *   preprocess → parse in the Web Worker → build annotations. Holds parser
 *   state (model status, pre-flight report, library snapshot, last result)
 *   and exposes it via subscribe() / getSnapshot(). One service owns all of
 *   this because services may not import each other and the worker must
 *   have a single owner.
 *
 * Layer: services/
 *
 * Tasks:
 *   1. start() at app start (architecture.md → Model library, Model readiness):
 *      a. status `checking`: modules/preflight runDeviceChecks(); verdict
 *         `blocked` → status `failed: unsupported` (nothing is downloaded).
 *      b. modules/modelLibrary loadCatalog() + getModelStates();
 *         preflight assessModels() → fitness per model; recommendModel().
 *      c. If the saved choice is fully cached: load it (step 2c). Otherwise
 *         status `no-model` (waiting for the user; nothing downloaded).
 *   2. chooseModel(id): (also used when switching models)
 *      a. If not downloaded: status `downloading` with byte progress;
 *         modelLibrary downloadModel() (verified).
 *      b. preflight runModelChecks() for this model; `blocked` →
 *         `failed: invalid-model` (re-download offered).
 *      c. Worker load(ModelRef) (it unloads the previous model first) →
 *         `loading` → self-test → `ready`; saveChoice(id).
 *   3. deleteModel(id): unload first if active (status `no-model`), then
 *      modelLibrary deleteModel(); cancelDownload(id).
 *   4. parseText(raw): Promise<ParseOutcome> — rejects with ParserNotReadyError
 *      unless the model status is `ready` (no worker call); otherwise
 *      modules/input preprocess (surface InputTooLongError and removal report)
 *      → worker parse → modules/output annotate.
 *   5. Shared state: model status (idle | checking | no-model | downloading +
 *      progress | loading + progress | ready + model id | failed + reason),
 *      pre-flight report, library snapshot (catalog, states, fitness,
 *      recommended, active id), last annotation, last removal notice.
 *      subscribe()/getSnapshot() with immutable snapshots.
 *   6. retryLoad(): rerun the failed step (start or chooseModel).
 *   5. Cancel or ignore stale results when a new parse starts.
 *   7. Tests in parserService.test.ts with mocked modules and worker: blocked
 *      pre-flight never creates the worker; nothing is downloaded before a
 *      choice; parseText() rejects before `ready`; switching unloads first;
 *      deleting the active model unloads it.
 *
 * Dependencies:
 *   Internal: modules/input, modules/preflight, modules/modelLibrary,
 *             modules/parser, modules/output (index.ts only).
 *   No React imports; no other services.
 *   Used by: hooks/useParser.ts, hooks/useModelLibrary.ts.
 *
 * Status: header only; not implemented.
 */
