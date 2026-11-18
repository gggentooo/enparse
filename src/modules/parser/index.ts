/**
 * src/modules/parser/index.ts — public API of the parser module (proposed file)
 *
 * Description:
 *   Sentence structure parsing (UPOS + NP/VP/PP/ADJP/ADVP chunks with
 *   alternatives) running in a Web Worker. Other layers import only from
 *   this file (agents.md → Module public API).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Export createParserWorker(): constructs the module worker from
 *      ./parser.worker.ts and returns a typed client (load, retry, parse,
 *      status, onStatus). parse() rejects with ParserNotReadyError unless the
 *      status is `ready`.
 *   2. Re-export public types and errors from ./types.ts.
 *   3. Export MAX_ALTERNATIVES from ./ambiguity.ts.
 *   4. Do not export backends directly (they run only inside the worker).
 *
 * Dependencies:
 *   Internal: ./parser.worker.ts, ./types.ts, ./ambiguity.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: header only; not implemented.
 */
