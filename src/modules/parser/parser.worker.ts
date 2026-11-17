/**
 * src/modules/parser/parser.worker.ts — Web Worker entry for parsing
 *
 * Description:
 *   All parsing runs here, never on the main thread (agents.md → Parser and
 *   worker code). Loads backends once, switches between model and fallback
 *   mode, and answers parse requests via postMessage.
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Typed message protocol (in ./types.ts): load, parse, status; responses
 *      parseResult, progress, modeChanged, error.
 *   2. On start: load winkBackend immediately (fallback ready), then
 *      transformerBackend in the background with progress messages.
 *   3. Fallback rules: use winkBackend while loading, on ParserLoadError, or
 *      on low-memory devices (rules from plan-training.md Phase 10).
 *   4. Route parse requests to ./parser.ts with the active backend.
 *   5. Serialize errors as typed messages; no silent failures.
 *   6. Register new backends here (agents.md → Adding a parser backend).
 *
 * Dependencies:
 *   Internal: ./parser.ts, ./transformerBackend.ts, ./winkBackend.ts, ./types.ts.
 *   Browser APIs: Worker global scope (self.postMessage / onmessage).
 *   Created by: services/parserService.ts (new Worker(new URL(...), { type: 'module' })).
 *
 * Status: header only; not implemented.
 */
