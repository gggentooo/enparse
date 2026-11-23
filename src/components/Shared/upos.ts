/**
 * src/components/Shared/upos.ts — catalog key of a part-of-speech tag
 *
 * Description:
 *   Maps a UPOS tag to its i18n catalog key ("upos.NOUN" → "Noun (NOUN)" /
 *   "명사 (NOUN)"), or null for an unknown tag (shown as is). Shared by the
 *   word panel (WordDetails) and the dictionary views (T53).
 *
 * Layer: components/ (shared helper; no React)
 *
 * Status: implemented (T57; moved here in T53).
 */

import type { MessageKey } from "../../hooks/useI18n";

const UPOS_TAGS = new Set([
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "PUNCT",
  "SCONJ",
  "SYM",
  "VERB",
  "X",
]);

/** Catalog key of a UPOS tag, or null for an unknown tag (shown as is). */
export const uposKey = (upos: string): MessageKey | null =>
  UPOS_TAGS.has(upos) ? (`upos.${upos}` as MessageKey) : null;
