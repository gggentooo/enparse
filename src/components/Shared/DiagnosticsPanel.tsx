/**
 * src/components/Shared/DiagnosticsPanel.tsx — pre-flight and model status details
 *
 * Description:
 *   Shows the pre-flight report: each check with its status (pass, warn,
 *   fail, not checked), what was measured and what is required, plus the
 *   model load status. Used when loading fails or warnings exist, and on
 *   demand from the Header status badge.
 *
 * Layer: components/ (Shared)
 *
 * Tasks:
 *   1. Read { status, preflight, modelChecks } from useParser().
 *   2. List checks grouped by stage (device, model); failures first, then
 *      warnings, passes, and skipped checks.
 *   3. Plain-language reason and what the user can do (./checkText.ts
 *      hints); retry button → useParser().retryLoad when the status failed.
 *   4. Accessible: list semantics, status as text (not color alone),
 *      focusable retry button.
 *   5. user-facing text via useI18n() catalog keys (T68) (check names, reasons).
 *   6. Component test in DiagnosticsPanel.test.tsx with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useParser.ts, hooks/useI18n.ts, ./ModelStatus.tsx,
 *             ./checkText.ts, ./DiagnosticsPanel.module.css.
 *   Used by: Layout/Header.tsx (details modal), Shared/ModelStatus.tsx (details).
 *
 * Status: implemented (T55). Tests: DiagnosticsPanel.test.tsx.
 */

import { useI18n } from "../../hooks/useI18n";
import { type CheckResult, type PreflightReport, useParser } from "../../hooks/useParser";
import { checkHintKey, checkNameKey, formatCheckValue } from "./checkText";
import styles from "./DiagnosticsPanel.module.css";
import { ModelStatus } from "./ModelStatus";

const ORDER: Readonly<Record<CheckResult["status"], number>> = { fail: 0, warn: 1, pass: 2, skip: 3 };
const MARK: Readonly<Record<CheckResult["status"], string>> = { fail: "✕", warn: "!", pass: "✓", skip: "–" };

function CheckList({ report, title }: { report: PreflightReport | null; title: string }): React.JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const checks = [...(report?.checks ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <section className={styles.stage}>
      <h3 className={styles.stageTitle}>{title}</h3>
      {report === null ? (
        <p className={styles.muted}>{t("diag.notChecked")}</p>
      ) : (
        <>
          <p className={styles.summary}>{t(`diag.summary.${report.verdict}`)}</p>
          <ul className={styles.checks}>
            {checks.map((c) => {
              const measured = formatCheckValue(c.id, c.measured, i18n);
              const required = formatCheckValue(c.id, c.required, i18n);
              return (
                <li key={c.id} className={`${styles.check} ${styles[c.status]}`}>
                  <span className={styles.mark} aria-hidden="true">
                    {MARK[c.status]}
                  </span>
                  <span className={styles.name}>{t(checkNameKey(c.id))}</span>
                  <span className={styles.status}>{t(`checkStatus.${c.status}`)}</span>
                  {(c.status === "fail" || c.status === "warn") && (
                    <span className={styles.hint}>{t(checkHintKey(c.id))}</span>
                  )}
                  {(measured || required) && (
                    <span className={styles.values}>
                      {measured && t("diag.measured", { value: measured })}
                      {measured && required && " · "}
                      {required && t("diag.required", { value: required })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** The full diagnostics view: model status (with retry) and both check stages. */
export function DiagnosticsPanel(): React.JSX.Element {
  const { t } = useI18n();
  const { status, preflight, modelChecks } = useParser();
  return (
    <div className={styles.panel}>
      <ModelStatus showDetails={false} />
      {status.state === "ready" && (
        <p className={styles.muted}>{t("diag.backend", { backend: status.backend.toUpperCase() })}</p>
      )}
      <CheckList report={preflight} title={t("diag.device")} />
      <CheckList report={modelChecks} title={t("diag.model")} />
    </div>
  );
}
