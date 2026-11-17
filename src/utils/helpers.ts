/**
 * src/utils/helpers.ts — shared utility functions
 *
 * Description:
 *   Small, pure helpers shared across layers: string normalization, date
 *   formatting, debounce/throttle. Infrastructure layer: imports no other layer.
 *
 * Layer: utils/
 *
 * Tasks:
 *   1. String helpers: whitespace collapse, case folding for lookups.
 *   2. Date formatting (ISO for exports; display format depends on UI language).
 *   3. debounce(fn, ms) and throttle(fn, ms) with typed signatures.
 *   4. Unit tests in helpers.test.ts.
 *
 * Dependencies:
 *   None (no external libraries, no other layers).
 *   Used by: modules/*, services/*, hooks/*.
 *
 * Open items (plan.md → Undecided): interface language (date display format).
 *
 * Status: header only; not implemented.
 */
