/**
 * src/services/appUpdateService.ts — app updates and offline shell (T69)
 *
 * Description:
 *   Registers the service worker in production builds (core/pwa.ts) and holds whether a new
 *   version is waiting; apply() switches to it after the user accepts (update prompt).
 *   subscribe()/getSnapshot() for hooks/useAppUpdate.ts.
 *
 * Layer: services/. Dependencies: core/pwa.ts. No React; no other services.
 * Status: implemented (T69). Tests: appUpdateService.test.ts.
 */

import { type PendingUpdate, registerServiceWorker } from "../core/pwa";

export type AppUpdateSnapshot = { updateAvailable: boolean };

export type AppUpdateService = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AppUpdateSnapshot;
  /** Register the service worker (production only; idempotent). */
  start(): Promise<void>;
  /** Switch to the waiting version (the page reloads). */
  apply(): void;
};

export function createAppUpdateService(
  register: typeof registerServiceWorker = registerServiceWorker,
  enabled: boolean = import.meta.env.PROD,
): AppUpdateService {
  let snapshot: AppUpdateSnapshot = { updateAvailable: false };
  let update: PendingUpdate | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (s: AppUpdateSnapshot): void => {
    snapshot = s;
    for (const l of listeners) l();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async start() {
      if (started || !enabled) return;
      started = true;
      try {
        await register((u) => {
          update = u;
          set({ updateAvailable: true });
        });
      } catch {
        // No offline shell (e.g. blocked service workers); the app still works online.
      }
    },
    apply() {
      update?.apply();
    },
  };
}

let shared: AppUpdateService | null = null;
export function appUpdateService(): AppUpdateService {
  shared ??= createAppUpdateService();
  return shared;
}
