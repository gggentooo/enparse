/**
 * src/components/Shared/DiagnosticsPanel.tsx — pre-flight and model status details
 *
 * Description:
 *   Shows the pre-flight report: each check with its status (pass, warn,
 *   fail, skipped), what was measured and what is required, plus the model
 *   load status. Used when loading fails or warnings exist, and on demand
 *   from the Header status badge.
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Read { status, preflight } from useParser().
 *   2. List checks grouped by stage (device, model); failures first.
 *   3. Plain-language reason and what the user can do (e.g., use a newer
 *      browser, free storage, retry); retry button → useParser().retryLoad.
 *   4. Accessible: list semantics, status not conveyed by color alone,
 *      focusable retry button.
 *   5. `strings` constant for user-facing text (check names, reasons).
 *   6. Component test in DiagnosticsPanel.test.tsx with a mocked hook.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, components/Shared/Button.tsx,
 *             ./DiagnosticsPanel.module.css.
 *   Used by: Layout/Header.tsx (details popover/modal), Pages/InputPage.tsx,
 *            Pages/ModelsPage.tsx (why a model is not supported).
 *
 * Open items (todo.md): pre-flight checks (diagnostics display);
 *   interface language.
 *
 * Status: header only; not implemented.
 */
