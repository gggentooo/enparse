/**
 * src/services/languageService.ts — UI language state (T68)
 *
 * Description:
 *   Holds the UI language (default Korean; owner T18), persists the user's choice with
 *   core/storage (LocalStorage), and keeps <html lang> in sync. subscribe()/getSnapshot()
 *   for hooks/useI18n.ts.
 *
 * Layer: services/. Dependencies: core/storage.ts, i18n/i18n.ts. No React; no other services.
 * Status: implemented (T68). Tests: languageService.test.ts.
 */

import { type AppStorage, appStorage } from "../core/storage";
import { DEFAULT_LANGUAGE, type Language, isLanguage } from "../i18n/i18n";

/** Storage key of the chosen UI language. */
export const LANGUAGE_KEY = "settings/language";

export type LanguageService = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Language;
  /** Switch now (UI updates synchronously) and persist. */
  setLanguage(lang: Language): Promise<void>;
  /** Restore the saved choice (call once at startup). */
  restore(): Promise<void>;
};

function applyToDocument(lang: Language): void {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function createLanguageService(storage?: AppStorage): LanguageService {
  let current: Language = DEFAULT_LANGUAGE;
  const listeners = new Set<() => void>();
  const store = (): AppStorage => storage ?? appStorage();
  const set = (lang: Language): void => {
    if (lang === current) return;
    current = lang;
    applyToDocument(lang);
    for (const l of listeners) l();
  };
  applyToDocument(current);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    async setLanguage(lang) {
      set(lang);
      await store().set(LANGUAGE_KEY, lang, { backend: "local" });
    },
    async restore() {
      try {
        const saved = await store().get(LANGUAGE_KEY);
        if (isLanguage(saved)) set(saved);
      } catch {
        // Storage blocked: keep the default language.
      }
    },
  };
}

let shared: LanguageService | null = null;
/** The app's language service (created on first use). */
export function languageService(): LanguageService {
  shared ??= createLanguageService();
  return shared;
}
