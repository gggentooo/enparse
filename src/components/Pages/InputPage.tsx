/**
 * src/components/Pages/InputPage.tsx — raw text input page (#/input)
 *
 * Description:
 *   Lets the user enter English text (type, paste, drag-and-drop a text
 *   file) and start parsing.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Labeled <textarea> with live character count vs the max length.
 *   2. Drag-and-drop of plain-text files.
 *   3. Parse button → useParser().parseText; navigate to #/output on success.
 *   4. Show too-long errors (with count) and the removed-text notice.
 *   5. `strings` constant for user-facing text.
 *
 * Dependencies:
 *   External: react, react-router-dom (navigation).
 *   Internal: hooks/useParser.ts, components/Shared/Button.tsx,
 *             components/Shared/LoadingSpinner.tsx, ./InputPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Open items (plan.md → Undecided): limit defaults; interface language.
 *
 * Status: header only; not implemented.
 */
