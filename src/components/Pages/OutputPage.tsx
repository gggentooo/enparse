/**
 * src/components/Pages/OutputPage.tsx — annotated results page (#/output)
 *
 * Description:
 *   Displays the parsed text with chunk annotations, alternative parses,
 *   word selection, inline dictionary lookup, and subword breakdown.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Render the annotation model from useParser (chunks color-coded by type).
 *   2. Mark the primary parse "most likely"; show alternatives per sentence.
 *   3. Word selection (click and keyboard) → inline lookup via useDictionary
 *      and useSubword, shown in a Tooltip.
 *   4. "Add to vocab list" via useVocab.
 *   5. Basic-mode notice with a re-parse action once the model is ready.
 *   6. Split into child components next to this file if > ~200 lines
 *      (agents.md → React).
 *   7. `strings` constant for user-facing text.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, hooks/useDictionary.ts, hooks/useSubword.ts,
 *             hooks/useVocab.ts, components/Shared/*, ./OutputPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Open items (todo.md): parse-display style; how alternatives
 *   are displayed; grammar label language; lookup trigger.
 *
 * Status: header only; not implemented.
 */
