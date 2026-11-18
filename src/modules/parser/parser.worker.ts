/**
 * src/modules/parser/parser.worker.ts — Web Worker entry for parsing
 *
 * Description:
 *   All parsing runs here, never on the main thread (agents.md → Parser and
 *   worker code). Loads the model once, reports load status, and answers
 *   parse requests via postMessage only when the model is ready. There is no
 *   fallback parser (architecture.md → Model readiness).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Typed message protocol (in ./types.ts): load(model: ModelRef), unload,
 *      retry, parse, status;
 *      responses status (idle | loading + progress | ready | failed + reason),
 *      parseResult, error.
 *   2. On load: load wink-nlp (tokenizer) and transformerBackend, with progress
 *      messages for download and initialization; status becomes `ready` only
 *      after the self-test parse passes.
 *   3. Reject parse messages unless status is `ready` (ParserNotReadyError).
 *      On ParserLoadError, status `failed` with the reason; `retry` reloads.
 *      One model in memory at a time: load(model) while another is loaded
 *      unloads it first; `unload` returns to `idle`.
 *   4. Route parse requests to ./parser.ts with the loaded backend.
 *   5. Serialize errors as typed messages; no silent failures.
 *   6. Register new backends here (agents.md → Adding a parser backend).
 *
 * Dependencies:
 *   Internal: ./parser.ts, ./transformerBackend.ts, ./winkBackend.ts (tokenizer), ./types.ts.
 *   Browser APIs: Worker global scope (self.postMessage / onmessage).
 *   Created by: services/parserService.ts (new Worker(new URL(...), { type: 'module' })).
 *
 * Status: header only; not implemented.
 */
