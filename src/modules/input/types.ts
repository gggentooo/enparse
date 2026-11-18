/**
 * src/modules/input/types.ts — types for the input module
 *
 * Description:
 *   Shared types for the preprocessor's result and errors.
 *
 * Layer: modules/ (input)
 *
 * Dependencies:
 *   None. Used by: ./textInput.ts, ./index.ts.
 *
 * Status: implemented (Phase 3 pre-work).
 */

/** Categories of characters the preprocessor removes. */
export type RemovalCategory = "nonLatin" | "emoji" | "control";

/** Count and a few example runs of removed text for one category. */
export type RemovalEntry = {
  count: number;
  samples: string[];
};

/** What the preprocessor removed, per category (counts are code points). */
export type RemovalReport = Record<RemovalCategory, RemovalEntry>;

/** Clean text plus a report of what changed. */
export type PreprocessResult = {
  text: string;
  originalLength: number;
  cleanLength: number;
  removed: RemovalReport;
  /** True if any non-Latin, emoji, or control text was removed. */
  hasRemovals: boolean;
};

/** Thrown when input exceeds the maximum length; input is never truncated. */
export class InputTooLongError extends Error {
  readonly length: number;
  readonly maxLength: number;

  constructor(length: number, maxLength: number) {
    super(`Input has ${length} characters; the maximum is ${maxLength}.`);
    this.name = "InputTooLongError";
    this.length = length;
    this.maxLength = maxLength;
  }
}
