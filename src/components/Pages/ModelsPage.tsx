/**
 * src/components/Pages/ModelsPage.tsx — model library page (#/models)
 *
 * Description:
 *   Lets the user choose the parser model. Lists every offered model with its
 *   description, download size, accuracy (UPOS, chunk F1; UAS/LAS if the
 *   nested view is available), expected speed and memory on this device, and
 *   pre-flight fit (recommended, warning, not supported). Shows download
 *   progress, which model is active, and size on disk with a delete action.
 *
 * Layer: components/
 *
 * Tasks:
 *   1. One card per model (./ModelCard.tsx) from useModelLibrary().models;
 *      the recommended model is highlighted; blocked models are shown but
 *      cannot be chosen (fitness reasons with hints, Shared/checkText.ts).
 *   2. Actions: Choose (downloads if needed, then loads), Cancel download,
 *      Delete (asks for confirmation; unloads first if active).
 *   3. Download and load progress per card; errors with retry.
 *   4. First visit (no model chosen): explain that a model must be
 *      downloaded once (size shown) before parsing.
 *   5. Accessible: list of cards with headings, buttons with names, progress
 *      with aria attributes; status not by color alone.
 *   6. user-facing text via useI18n() catalog keys (T68) (descriptions come from the
 *      catalog).
 *   7. Component test in ModelsPage.test.tsx with a mocked service.
 *
 * Dependencies:
 *   External: react.
 *   Internal: hooks/useModelLibrary.ts, hooks/useParser.ts (status),
 *             hooks/useI18n.ts, components/Shared/ModelStatus.tsx,
 *             ./ModelCard.tsx, ./ModelsPage.module.css.
 *   Used by: src/routes.tsx (#/models).
 *
 * Open items (todo.md): final display names and descriptions (T43): the
 *   catalog's English drafts are shown (lang="en") until then.
 *
 * Status: implemented (T54). Tests: ModelsPage.test.tsx.
 */

import { useI18n } from "../../hooks/useI18n";
import { useModelLibrary } from "../../hooks/useModelLibrary";
import { useParser } from "../../hooks/useParser";
import { ModelStatus } from "../Shared/ModelStatus";
import { ModelCard } from "./ModelCard";
import styles from "./ModelsPage.module.css";

export function ModelsPage(): React.JSX.Element {
  const { t } = useI18n();
  const library = useModelLibrary();
  const { status } = useParser();
  const nothingDownloaded =
    library.models.length > 0 && library.models.every((m) => m.state.state !== "downloaded") && !library.activeId;

  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("page.models.title")}</h1>
      <p className={styles.intro}>{t("models.intro")}</p>
      {/* With no model yet, the first-visit notice and the cards say it all. */}
      {status.state !== "no-model" && <ModelStatus />}
      {nothingDownloaded && <p className={styles.notice}>{t("models.firstVisit")}</p>}
      {library.error && (
        <p role="alert" className={styles.error}>
          {library.error.message}
        </p>
      )}
      {library.models.length > 0 && (
        <ul className={styles.cards} aria-label={t("models.listLabel")}>
          {library.models.map((m) => (
            <ModelCard
              key={m.entry.id}
              model={m}
              preparing={status.state === "loading" && status.modelId === m.entry.id}
              onUse={() => void library.chooseModel(m.entry.id)}
              onDownload={() => void library.downloadModel(m.entry.id)}
              onCancel={() => void library.cancelDownload(m.entry.id)}
              onDelete={() => void library.deleteModel(m.entry.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
