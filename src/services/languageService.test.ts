// @vitest-environment jsdom
/**
 * src/services/languageService.test.ts — UI language state (T68)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "../core/storage";
import { LANGUAGE_KEY, createLanguageService } from "./languageService";

beforeEach(() => localStorage.clear());

describe("languageService", () => {
  it("defaults to Korean, switches, notifies, sets <html lang>, and persists", async () => {
    const storage = createStorage({ indexedDB: null });
    const s = createLanguageService(storage);
    expect(s.getSnapshot()).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
    const listener = vi.fn<() => void>();
    s.subscribe(listener);
    await s.setLanguage("en");
    expect(s.getSnapshot()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await storage.get(LANGUAGE_KEY)).toBe("en");
    const again = createLanguageService(storage);
    await again.restore();
    expect(again.getSnapshot()).toBe("en");
  });

  it("ignores an invalid saved value", async () => {
    const storage = createStorage({ indexedDB: null });
    await storage.set(LANGUAGE_KEY, "xx");
    const s = createLanguageService(storage);
    await s.restore();
    expect(s.getSnapshot()).toBe("ko");
  });
});
