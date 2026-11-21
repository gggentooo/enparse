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
 * Open items (todo.md): interface language (date display format, T18).
 *
 * Status: implemented (T28). Tests: helpers.test.ts.
 */

/** Collapse runs of whitespace (incl. Unicode spaces and line breaks) to one space and trim. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Case-fold for lookups: Unicode NFKC, then locale-independent lower case (so "Ｆｉｌｅ",
 * "FILE", and "file" match; Turkish dotted I is not special-cased).
 */
export function foldCase(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** Key for dictionary/vocab lookups: folded case and collapsed whitespace. */
export function lookupKey(text: string): string {
  return collapseWhitespace(foldCase(text));
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Calendar date "YYYY-MM-DD" in UTC (export file names, stored dates). */
export function formatIsoDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid date");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Timestamp "YYYY-MM-DDTHH:MM:SSZ" in UTC, without milliseconds (exports, changelog-style stamps). */
export function formatIsoTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid date");
  return `${formatIsoDate(date)}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

/** A debounced or throttled function with a way to drop the pending call. */
export type Deferred<A extends unknown[]> = ((...args: A) => void) & { cancel: () => void };

/** Call `fn` once `ms` after the last call (trailing edge, last arguments win). */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Deferred<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: A): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as Deferred<A>;
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/**
 * Call `fn` at most once per `ms`: immediately on the first call (leading edge), then once at the
 * end of the window with the latest arguments if more calls arrived (trailing edge).
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Deferred<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const fire = (args: A): void => {
    last = Date.now();
    fn(...args);
  };
  const wrapped = ((...args: A): void => {
    const wait = last + ms - Date.now();
    if (wait <= 0 && timer === null) {
      fire(args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = setTimeout(
        () => {
          timer = null;
          if (pending) {
            const a = pending;
            pending = null;
            fire(a);
          }
        },
        Math.max(0, wait),
      );
    }
  }) as Deferred<A>;
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return wrapped;
}
