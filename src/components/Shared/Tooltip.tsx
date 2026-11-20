/**
 * src/components/Shared/Tooltip.tsx — shared tooltip / popover
 *
 * Description:
 *   Positioned popover anchored to an element; used for inline word lookup.
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Open on focus/click (and hover if chosen); close on Escape and outside click.
 *   2. aria-describedby or dialog semantics depending on content.
 *   3. Keep within the viewport.
 *
 * Dependencies:
 *   External: react.
 *   Internal: ./Tooltip.module.css.
 *   Used by: OutputPage.
 *
 * Open items (todo.md): lookup trigger (selection, hover, click, tap).
 *
 * Status: header only; not implemented.
 */
