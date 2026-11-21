/**
 * src/core/pwa.test.ts — service worker registration and update handoff (T69)
 */

import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./pwa";

type Listener = (e?: unknown) => void;

function fakeWorker(state = "installing") {
  const listeners: Listener[] = [];
  return {
    state,
    postMessage: vi.fn<(m: unknown) => void>(),
    addEventListener: (_t: string, fn: Listener) => listeners.push(fn),
    fire(newState: string) {
      this.state = newState;
      for (const l of listeners) l();
    },
  };
}

function setup(controlled: boolean, waiting: ReturnType<typeof fakeWorker> | null = null) {
  const regListeners: Listener[] = [];
  const containerListeners = new Map<string, Listener>();
  const reg = {
    waiting,
    installing: null as ReturnType<typeof fakeWorker> | null,
    addEventListener: (_t: string, fn: Listener) => regListeners.push(fn),
  };
  const container = {
    controller: controlled ? {} : null,
    register: vi.fn<(url: string) => Promise<typeof reg>>(async () => reg),
    addEventListener: (t: string, fn: Listener) => containerListeners.set(t, fn),
  };
  return { reg, regListeners, container, containerListeners };
}

describe("registerServiceWorker", () => {
  it("reports a version already waiting, and applying it posts skip-waiting then reloads on takeover", async () => {
    const waiting = fakeWorker("installed");
    const { container, containerListeners } = setup(true, waiting);
    const reload = vi.fn<() => void>();
    const onUpdate = vi.fn<(u: { apply: () => void }) => void>();
    await registerServiceWorker(onUpdate, { container: container as never, reload });
    expect(container.register).toHaveBeenCalledWith("./sw.js");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    onUpdate.mock.calls[0]?.[0].apply();
    expect(waiting.postMessage).toHaveBeenCalledWith("skip-waiting");
    containerListeners.get("controllerchange")?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reports a newly installed version only when a page is already controlled (not the first install)", async () => {
    for (const controlled of [true, false]) {
      const { reg, regListeners, container } = setup(controlled);
      const onUpdate = vi.fn<(u: { apply: () => void }) => void>();
      await registerServiceWorker(onUpdate, { container: container as never, reload: () => undefined });
      const w = fakeWorker();
      reg.installing = w;
      for (const l of regListeners) l();
      w.fire("installed");
      expect(onUpdate).toHaveBeenCalledTimes(controlled ? 1 : 0);
    }
  });

  it("returns null without service worker support", async () => {
    expect(await registerServiceWorker(() => undefined, { container: undefined })).toBeNull();
  });
});
