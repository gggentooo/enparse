/**
 * src/components/Shared/UpdateBanner.tsx — "new version available" prompt (T69)
 *
 * Description:
 *   Shown when a new app version has been downloaded and is waiting; the user decides when
 *   to reload (no surprise reloads mid-task).
 *
 * Layer: components/ (Shared). Dependencies: hooks/useAppUpdate.ts, hooks/useI18n.ts,
 *   ./Button.tsx, ./UpdateBanner.module.css. Used by: Layout/Layout.tsx.
 * Status: implemented (T69).
 */

import { useAppUpdate } from "../../hooks/useAppUpdate";
import { useI18n } from "../../hooks/useI18n";
import { Button } from "./Button";
import styles from "./UpdateBanner.module.css";

export function UpdateBanner(): React.JSX.Element | null {
  const { updateAvailable, apply } = useAppUpdate();
  const { t } = useI18n();
  if (!updateAvailable) return null;
  return (
    <div className={styles.banner} role="status">
      <span>{t("update.available")}</span>
      <Button onClick={apply}>{t("update.reload")}</Button>
    </div>
  );
}
