/**
 * src/modules/input/index.ts — public API of the input module (proposed file)
 *
 * Description:
 *   Text preprocessor: normalizes and validates raw text before parsing.
 *   Other layers import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (input)
 *
 * Tasks:
 *   1. Re-export preprocess() and MAX_INPUT_CHARS from ./textInput.ts.
 *   2. Re-export public types and errors from ./types.ts.
 *
 * Dependencies:
 *   Internal: ./textInput.ts, ./types.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: header only; not implemented.
 */
