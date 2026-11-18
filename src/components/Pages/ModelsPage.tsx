/**
 * src/components/Pages/ModelsPage.tsx — model library page (#/models)
 *
 * Description:
 *   Lets the user choose the parser model. Lists every offered model with its
 *   description, download size, accuracy (UPOS, chunk F1; UAS/LAS if the
 *   nested view is available), expected speed and memory on this device, and
 *   pre-flight fit (recommended, warning, not supported). Shows download
 *   progress, which model is active, and size on disk with a delete action.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. One card per model from useModelLibrary().models; the recommended
 *      model is highlighted; blocked models are shown but cannot be chosen
 *      (reason from DiagnosticsPanel data).
 *   2. Actions: Choose (downloads if needed, then loads), Cancel download,
 *      Delete (asks for confirmation; unloads first if active).
 *   3. Download and load progress per card; errors with retry.
 *   4. First visit (no model chosen): explain that a model must be
 *      downloaded once (size shown) before parsing.
 *   5. Accessible: list of cards with headings, buttons with names, progress
 *      with aria attributes; status not by color alone.
 *   6. `strings` constant for user-facing text (descriptions come from the
 *      catalog).
 *   7. Component test in ModelsPage.test.tsx with a mocked hook.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useModelLibrary.ts, hooks/useParser.ts (status),
 *             components/Shared/Button.tsx, components/Shared/Modal.tsx,
 *             components/Shared/LoadingSpinner.tsx,
 *             components/Shared/DiagnosticsPanel.tsx, ./ModelsPage.module.css.
 *   Used by: src/routes.tsx (#/models).
 *
 * Open items (plan.md → Undecided): model library (presentation, description
 *   language); interface language.
 *
 * Status: header only; not implemented.
 */
