/**
 * src/modules/input/index.ts — public API of the input module
 *
 * Description:
 *   Text preprocessor: normalizes and validates raw text before parsing.
 *   Other layers import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (input)
 *
 * Public API:
 *   preprocess(raw, maxChars?) → PreprocessResult (throws InputTooLongError)
 *   normalizeChars(text)       → NFKC + quote/dash mapping only
 *   MAX_INPUT_CHARS, MAX_REMOVAL_SAMPLES
 *   Types: PreprocessResult, RemovalReport, RemovalEntry, RemovalCategory
 *
 * Dependencies:
 *   Internal: ./textInput.ts, ./types.ts.
 *   Used by: services/parserService.ts; training/js/align_tokens.mjs (via tsx).
 *
 * Status: implemented (Phase 3 pre-work).
 */

export { MAX_INPUT_CHARS, MAX_REMOVAL_SAMPLES, normalizeChars, preprocess } from "./textInput";
export {
  InputTooLongError,
  type PreprocessResult,
  type RemovalCategory,
  type RemovalEntry,
  type RemovalReport,
} from "./types";
