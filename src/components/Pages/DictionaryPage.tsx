/**
 * src/components/Pages/DictionaryPage.tsx — dictionary lookup page (#/dictionary)
 *
 * Description:
 *   Search box and full dictionary entry view (English and Korean
 *   definitions, examples, subword breakdown).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. Labeled search input → useDictionary().lookup.
 *   2. Entry view: senses, definitions, Korean translations, examples.
 *   3. Subword breakdown via useSubword.
 *   4. "Add to vocab list" via useVocab.
 *   5. Not-found and error states; `strings` constant.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useDictionary.ts, hooks/useSubword.ts, hooks/useVocab.ts,
 *             components/Shared/*, ./DictionaryPage.module.css.
 *   Used by: src/routes.tsx.
 *
 * Open items (todo.md): lookup trigger; sense selection.
 *
 * Status: header only; not implemented.
 */
