/**
 * src/core/pwa.ts — service worker registration and update handoff (T69)
 *
 * Description:
 *   Registers dist/sw.js (built from src/pwa/sw.ts) and reports when a new version is
 *   installed and waiting, so the UI can ask before switching (no surprise reloads). Applying
 *   the update tells the waiting worker to take over and reloads the page once it has.
 *
 * Layer: core/ (browser APIs only; imports no other layer).
 * Status: implemented (T69). Tests: pwa.test.ts.
 */

/** A waiting new version; apply() switches to it and reloads. */
export type PendingUpdate = { apply: () => void };

type ContainerLike = Pick<ServiceWorkerContainer, "register" | "controller" | "addEventListener">;

function pending(worker: ServiceWorker, container: ContainerLike, reload: () => void): PendingUpdate {
  return {
    apply() {
      container.addEventListener("controllerchange", () => reload(), { once: true });
      worker.postMessage("skip-waiting");
    },
  };
}

/**
 * Register the service worker; `onUpdate` is called when a new version waits. Returns null
 * where service workers are unavailable (e.g. some private modes).
 */
export async function registerServiceWorker(
  onUpdate: (update: PendingUpdate) => void,
  options: { url?: string; container?: ContainerLike; reload?: () => void } = {},
): Promise<ServiceWorkerRegistration | null> {
  const container = options.container ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  if (!container) return null;
  const reload = options.reload ?? (() => location.reload());
  const reg = await container.register(options.url ?? "./sw.js");
  // A version already waiting from an earlier visit (only an update if a page is controlled).
  if (reg.waiting && container.controller) onUpdate(pending(reg.waiting, container, reload));
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && container.controller) onUpdate(pending(worker, container, reload));
    });
  });
  return reg;
}
