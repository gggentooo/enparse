/**
 * src/components/Layout/Header.tsx — app header
 *
 * Description:
 *   Branding and global actions, including the model status indicator
 *   (loading progress, ready, or failed with retry).
 *
 * Layer: components/
 *
 * Tasks:
 *   1. App name/logo.
 *   2. Model status from useParser: checking, no model chosen (link to
 *      #/models), downloading/loading progress, ready badge with the active
 *      model's display name (useModelLibrary) and a warning mark if
 *      pre-flight warned, failed reason with a retry button. The badge opens
 *      DiagnosticsPanel; a link opens the model library.
 *   3. `strings` constant for user-facing text.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, hooks/useModelLibrary.ts,
 *             components/Shared/LoadingSpinner.tsx,
 *             components/Shared/DiagnosticsPanel.tsx, components/Shared/Modal.tsx,
 *             ./Header.module.css.
 *   Used by: ./Layout.tsx.
 *
 * Open items (plan.md → Undecided): branding; interface language.
 *
 * Status: header only; not implemented.
 */
