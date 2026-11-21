/**
 * src/modules/input/textInput.ts — text preprocessor
 *
 * Description:
 *   Cleans and validates raw user text before parsing. Pure logic; the input
 *   UI lives in components/Pages/InputPage.tsx. Also run by training tools
 *   (training/js, via tsx) so training text is normalized exactly like
 *   runtime text (plan-training.md → Phase 3).
 *
 * Layer: modules/ (input)
 *
 * Rules (architecture.md → Preprocessor):
 *   1. Unicode NFKC normalization; curly quotes → ASCII quotes; en dash and
 *      minus → "-"; em dash and horizontal bar → "--".
 *   2. Strip control characters (except newline and tab), zero-width
 *      characters, and emoji (with skin tones, flags, keycaps, joiners).
 *   3. Remove non-Latin letters (Hangul, CJK, Cyrillic, Greek, ...); report
 *      what was removed (counts and samples) so the UI can show a notice.
 *   4. Collapse repeated spaces; a single line break becomes a space; two or
 *      more line breaks become one paragraph break ("\n\n").
 *   5. Reject input longer than MAX_INPUT_CHARS code points (measured on the
 *      raw input) with InputTooLongError. Never truncate.
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none.
 *   Used by: ./index.ts; training/js/align_tokens.mjs (via tsx).
 *
 * Limit: MAX_INPUT_CHARS = 5,000 (owner, 2026-11-20; T09).
 *
 * Status: implemented (Phase 3 pre-work).
 */

import { InputTooLongError, type PreprocessResult, type RemovalCategory, type RemovalReport } from "./types";

/** Maximum input length in code points (proposed default; plan.md → Limit defaults). */
export const MAX_INPUT_CHARS = 5000;

/** Example runs kept per removal category for the UI notice. */
export const MAX_REMOVAL_SAMPLES = 5;

const CHAR_MAP: ReadonlyMap<string, string> = new Map([
  ["‘", "'"], // left single quote
  ["’", "'"], // right single quote / apostrophe
  ["‚", "'"], // single low-9 quote
  ["‛", "'"], // single high-reversed-9 quote
  ["′", "'"], // prime
  ["“", '"'], // left double quote
  ["”", '"'], // right double quote
  ["„", '"'], // double low-9 quote
  ["‟", '"'], // double high-reversed-9 quote
  ["″", '"'], // double prime
  ["‐", "-"], // hyphen
  ["‑", "-"], // non-breaking hyphen
  ["‒", "-"], // figure dash
  ["–", "-"], // en dash
  ["−", "-"], // minus sign
  ["—", "--"], // em dash
  ["―", "--"], // horizontal bar
]);
const CHAR_MAP_RE = new RegExp(`[${[...CHAR_MAP.keys()].join("")}]`, "gu");

// Emoji sequences: pictographs with optional variation selector, skin tone,
// and zero-width-joiner continuations; regional-indicator flags; keycaps.
const EMOJI_RE =
  // oxlint-disable-next-line no-misleading-character-class -- skin-tone modifiers are matched on their own by design
  /(?:\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*(?:‍\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)*)|\p{Regional_Indicator}+|[#*0-9]\u{FE0F}?⃣/gu;
// Leftover emoji parts (stray modifiers, selectors, tags, keycap marks).
// oxlint-disable-next-line no-misleading-character-class -- stray modifiers and keycap marks are matched on their own by design
const EMOJI_PART_RE = /[\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}⃣\u{E0020}-\u{E007F}]/gu;
// Control characters except \t and \n; \r is handled as a line break first.
const CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;
const KEEP_CONTROL = new Set(["\t", "\n"]);
// Letters and marks outside the Latin script; Common/Inherited (digits,
// punctuation, combining marks on Latin letters) are kept.
const NON_LATIN_RE = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+/gu;

function emptyReport(): RemovalReport {
  return {
    nonLatin: { count: 0, samples: [] },
    emoji: { count: 0, samples: [] },
    control: { count: 0, samples: [] },
  };
}

function record(report: RemovalReport, category: RemovalCategory, removed: string): void {
  const entry = report[category];
  entry.count += [...removed].length;
  if (entry.samples.length < MAX_REMOVAL_SAMPLES) entry.samples.push(removed);
}

function removeAll(
  text: string,
  re: RegExp,
  report: RemovalReport,
  category: RemovalCategory,
  keep?: (match: string) => boolean,
): string {
  return text.replace(re, (match) => {
    if (keep?.(match)) return match;
    record(report, category, match);
    // A space keeps neighbouring words apart; spaces are collapsed later.
    return category === "control" ? "" : " ";
  });
}

function collapseWhitespace(text: string): string {
  return text
    .split(/\n[ \t]*\n[\s]*/u) // paragraphs: 2+ line breaks
    .map((p) => p.replace(/[ \t\n]+/gu, " ").trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/** Normalize and validate raw text; throws InputTooLongError if too long. */
export function preprocess(raw: string, maxChars: number = MAX_INPUT_CHARS): PreprocessResult {
  const originalLength = [...raw].length;
  if (originalLength > maxChars) throw new InputTooLongError(originalLength, maxChars);

  const report = emptyReport();
  let text = raw.replace(/\r\n?/gu, "\n").normalize("NFKC");
  text = text.replace(CHAR_MAP_RE, (c) => CHAR_MAP.get(c) ?? c);
  text = removeAll(text, EMOJI_RE, report, "emoji");
  text = removeAll(text, EMOJI_PART_RE, report, "emoji");
  text = removeAll(text, CONTROL_RE, report, "control", (c) => KEEP_CONTROL.has(c));
  text = removeAll(text, NON_LATIN_RE, report, "nonLatin");
  text = collapseWhitespace(text);

  const hasRemovals = report.nonLatin.count + report.emoji.count + report.control.count > 0;
  return { text, originalLength, cleanLength: [...text].length, removed: report, hasRemovals };
}

/** Character-level normalization only (rule 1): NFKC plus quote/dash mapping. */
export function normalizeChars(text: string): string {
  return text.normalize("NFKC").replace(CHAR_MAP_RE, (c) => CHAR_MAP.get(c) ?? c);
}
