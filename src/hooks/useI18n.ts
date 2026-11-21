/**
 * src/hooks/useI18n.ts — UI language and message lookup for components (T68)
 *
 * Description:
 *   Subscribes to services/languageService.ts and returns the current language, `t()` for
 *   catalog keys (i18n/), the language list for the menu, and `setLanguage`. Every
 *   user-facing string in components goes through `t()`.
 *
 * Layer: hooks/. Dependencies: react, services/languageService.ts, i18n/i18n.ts.
 * Status: implemented (T68).
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  LANGUAGES,
  type Language,
  type MessageKey,
  formatBytes,
  formatDisplayDate,
  formatNumber,
  translate,
} from "../i18n/i18n";

export type { MessageKey } from "../i18n/i18n";
import { languageService } from "../services/languageService";

export type I18n = {
  lang: Language;
  t: (key: MessageKey, params?: Readonly<Record<string, string | number>>) => string;
  formatDate: (date: Date) => string;
  formatBytes: (bytes: number) => string;
  formatNumber: (value: number, digits?: number) => string;
  languages: ReadonlyArray<{ code: Language; name: string }>;
  setLanguage: (lang: Language) => Promise<void>;
};

const LANGUAGE_LIST = (Object.keys(LANGUAGES) as Language[]).map((code) => ({ code, name: LANGUAGES[code].name }));

export function useI18n(): I18n {
  const service = languageService();
  const lang = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const t = useCallback<I18n["t"]>((key, params) => translate(lang, key, params), [lang]);
  const formatDate = useCallback((date: Date) => formatDisplayDate(date, lang), [lang]);
  const bytes = useCallback((n: number) => formatBytes(n, lang), [lang]);
  const number = useCallback((n: number, digits?: number) => formatNumber(n, lang, digits), [lang]);
  return {
    lang,
    t,
    formatDate,
    formatBytes: bytes,
    formatNumber: number,
    languages: LANGUAGE_LIST,
    setLanguage: service.setLanguage,
  };
}
