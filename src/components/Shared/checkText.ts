/**
 * src/components/Shared/checkText.ts — display text for pre-flight checks
 *
 * Description:
 *   Maps pre-flight check ids to their catalog keys (name and "what to do"
 *   hint) and formats measured / required values by unit. Shared by
 *   DiagnosticsPanel and the model cards (fitness reasons).
 *
 * Layer: components/ (Shared; display mapping only)
 *
 * Dependencies:
 *   Internal: hooks/useI18n.ts (MessageKey type), hooks/useParser.ts (CheckResult type).
 *   Used by: ./DiagnosticsPanel.tsx, Pages/ModelCard.tsx.
 *
 * Status: implemented (T55).
 */

import type { I18n, MessageKey } from "../../hooks/useI18n";
import type { CheckResult } from "../../hooks/useParser";

const HINTS: Readonly<Record<CheckResult["id"], MessageKey>> = {
  "module-workers": "hint.browser",
  wasm: "hint.browser",
  "wasm-simd": "hint.browser",
  "wasm-threads": "hint.threads",
  webgpu: "hint.webgpu",
  "cache-storage": "hint.cache",
  "storage-quota": "hint.storage",
  "memory-hint": "hint.memory",
  "manifest-schema": "hint.files",
  "wink-versions": "hint.wink",
  "model-size": "hint.storage",
  "files-cached": "hint.files",
  "files-integrity": "hint.files",
  "model-memory": "hint.memory",
  "model-storage": "hint.storage",
  "model-variant": "hint.variant",
  "parse-time": "hint.speed",
};

const BYTE_CHECKS = new Set<CheckResult["id"]>(["storage-quota", "model-storage", "model-size", "webgpu"]);
const GB_CHECKS = new Set<CheckResult["id"]>(["memory-hint", "model-memory"]);

/** Catalog key of a check's name. */
export const checkNameKey = (id: CheckResult["id"]): MessageKey => `check.${id}`;

/** Catalog key of what the user can do when a check warns or fails. */
export const checkHintKey = (id: CheckResult["id"]): MessageKey => HINTS[id];

/** A measured or required value with its unit; null when there is nothing to show. */
export function formatCheckValue(
  id: CheckResult["id"],
  value: CheckResult["measured"],
  i18n: Pick<I18n, "formatBytes" | "formatNumber" | "t">,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  // A count of missing files is internal detail; the status and hint say what matters.
  if (id === "files-cached") return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "number") {
    if (BYTE_CHECKS.has(id)) return i18n.formatBytes(value);
    if (GB_CHECKS.has(id)) return `${i18n.formatNumber(value)} GB`;
    if (id === "parse-time") return i18n.t("models.seconds", { n: i18n.formatNumber(value) });
    return i18n.formatNumber(value);
  }
  return value;
}
