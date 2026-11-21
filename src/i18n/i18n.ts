/**
 * src/i18n/i18n.ts — UI languages, message lookup, and display formats (T68)
 *
 * Description:
 *   The app's i18n plumbing without a dependency (owner, T18/T68): one typed catalog per
 *   language (./en.ts is the reference key set; ./ko.ts the default), translate() with {name}
 *   placeholders, and Intl-based date display per language. Add a language by writing its
 *   catalog and listing it in LANGUAGES (e.g. Japanese, Chinese).
 *
 * Layer: i18n (pure; imports only its catalogs). Used by: services/languageService.ts,
 *   hooks/useI18n.ts, and components (types and translate via the hook).
 *
 * Status: implemented (T68). Tests: i18n.test.ts.
 */

import { type MessageKey, type Messages, en } from "./en";
import { ko } from "./ko";

export type { MessageKey, Messages } from "./en";

/** UI languages: code, native name for the language menu, and catalog. */
export const LANGUAGES = {
  ko: { name: "한국어", messages: ko },
  en: { name: "English", messages: en },
} as const satisfies Record<string, { name: string; messages: Messages }>;

export type Language = keyof typeof LANGUAGES;
/** Default UI language (owner, T18). */
export const DEFAULT_LANGUAGE: Language = "ko";

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && Object.hasOwn(LANGUAGES, v);
}

/** Message text with {name} placeholders filled; unknown placeholders stay visible. */
export function translate(lang: Language, key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const text: string = LANGUAGES[lang].messages[key] ?? en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Date for display in the UI language (stored and exported dates stay ISO; utils/helpers.ts). */
export function formatDisplayDate(date: Date, lang: Language): string {
  return new Intl.DateTimeFormat(lang, { year: "numeric", month: "long", day: "numeric" }).format(date);
}
