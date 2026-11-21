/**
 * src/hooks/useAppUpdate.ts — app update prompt state for components (T69)
 *
 * Layer: hooks/. Dependencies: react, services/appUpdateService.ts.
 * Status: implemented (T69).
 */

import { useSyncExternalStore } from "react";
import { appUpdateService } from "../services/appUpdateService";

export function useAppUpdate(): { updateAvailable: boolean; apply: () => void } {
  const s = appUpdateService();
  const snap = useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
  return { updateAvailable: snap.updateAvailable, apply: s.apply };
}
