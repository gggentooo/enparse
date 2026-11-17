/**
 * src/modules/input/textInput.ts — text preprocessor
 *
 * Description:
 *   Cleans and validates raw user text before parsing. Pure logic; the input
 *   UI lives in components/Pages/InputPage.tsx.
 *
 * Layer: modules/ (input)
 *
 * Tasks:
 *   1. Unicode NFKC normalization; curly quotes and dashes → ASCII.
 *   2. Strip control characters, zero-width characters, and emoji.
 *   3. Remove Hangul/CJK and other non-Latin text; report what was removed
 *      (counts and samples) so the UI can show a notice.
 *   4. Collapse repeated whitespace; keep paragraph breaks.
 *   5. Enforce MAX_INPUT_CHARS = 5000 (exported constant); reject longer input
 *      with InputTooLongError carrying the character count. Never truncate.
 *   6. Return a PreprocessResult (clean text + removal report).
 *   7. Unit tests in textInput.test.ts (empty, max length, non-Latin, emoji).
 *
 * Dependencies:
 *   Internal: ./types.ts; utils/helpers.ts.
 *   External: none.
 *   Used by: services/parserService.ts (via ./index.ts).
 *
 * Open items (plan.md → Undecided): limit defaults (5,000 characters).
 *
 * Status: header only; not implemented.
 */
