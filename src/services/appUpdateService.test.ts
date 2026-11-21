/**
 * src/services/appUpdateService.test.ts — update prompt state (T69)
 */

import { describe, expect, it, vi } from "vitest";
import { createAppUpdateService } from "./appUpdateService";

describe("appUpdateService", () => {
  it("registers once in production, exposes a waiting update, and applies it", async () => {
    const apply = vi.fn<() => void>();
    type Register = (onUpdate: (u: { apply: () => void }) => void) => Promise<null>;
    const register = vi.fn<Register>(async (onUpdate) => {
      onUpdate({ apply });
      return null;
    });
    const s = createAppUpdateService(register, true);
    const listener = vi.fn<() => void>();
    s.subscribe(listener);
    await s.start();
    await s.start();
    expect(register).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().updateAvailable).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    s.apply();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does nothing in development and survives a failed registration", async () => {
    const register = vi.fn<() => Promise<null>>(async () => {
      throw new Error("blocked");
    });
    await createAppUpdateService(register, false).start();
    expect(register).not.toHaveBeenCalled();
    const s = createAppUpdateService(register, true);
    await s.start();
    expect(s.getSnapshot().updateAvailable).toBe(false);
  });
});
