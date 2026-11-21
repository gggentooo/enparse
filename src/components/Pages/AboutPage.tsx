/**
 * src/components/Pages/AboutPage.tsx — About & licenses (attribution)
 *
 * Description:
 *   Lists the app, the parser models, the training data (UD English EWT,
 *   CC BY-SA 4.0), runtime libraries, and dictionary sources with their
 *   licenses (owner, 2026-11-21; T21). Each model card on ModelsPage also
 *   shows its license and source.
 *
 * Layer: components/
 *
 * Tasks (T50):
 *   1. Sections: app (license from T16), models (from the catalog via
 *      useModelLibrary: base model, license, version), data (UD EWT release
 *      and CC BY-SA 4.0 notice with link and changes made), libraries
 *      (Transformers.js, ONNX Runtime Web, wink-nlp, React, react-router),
 *      dictionary sources (T25).
 *   2. user-facing text via useI18n() catalog keys (T68).
 *
 * Dependencies:
 *   External: react. Internal: ./AboutPage.module.css (hooks/useModelLibrary.ts with T54).
 *   Used by: src/routes.tsx (#/about), Layout/Sidebar.tsx link.
 *
 * Status: implemented (T50). Models are listed from a static list of the offered
 *   models until the catalog is loaded through useModelLibrary (TODO(T54));
 *   app license: PolyForm Noncommercial 1.0.0 (owner, T16); dictionary sources
 *   are added with the dictionary build (T25 decided; T46).
 *   Tests: AboutPage.test.tsx (the attribution must match training/MODEL_CARD.md).
 */

import { useI18n } from "../../hooks/useI18n";
import type { MessageKey } from "../../i18n/i18n";
import styles from "./AboutPage.module.css";

/** Training-data attribution: identical to training/MODEL_CARD.md → Attribution (CC BY-SA 4.0 §3(a)); kept in English. */
export const EWT_ATTRIBUTION =
  "This model was trained on the Universal Dependencies English Web Treebank (UD English EWT, release 2.19), annotations © 2013–2021 The Board of Trustees of The Leland Stanford Junior University, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Source: https://github.com/UniversalDependencies/UD_English-EWT. Changes: chunk tags were derived from the dependency trees, words were re-segmented to match wink-nlp, and the data was used to train a token classifier. The model files are shared under CC BY-SA 4.0.";

/** Required Notice of the app's license (identical in LICENSE.md and README.md; T16). */
export const REQUIRED_NOTICE = "Required Notice: Copyright Hankyung Lee (https://github.com/gggentooo/enparse)";

const CC_BY_SA = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };
const POLYFORM = {
  name: "PolyForm Noncommercial License 1.0.0",
  url: "https://polyformproject.org/licenses/noncommercial/1.0.0",
};

/** A credited work: proper name, URL, a catalog key for the description, and the license (a catalog key or a literal name). */
type Credit = { name: string; url: string; detail: MessageKey; license: { key: MessageKey } | { literal: string } };

/** Offered parser models (TODO(T54): read base model, license, and version from catalog.json). */
const MODELS: Credit[] = [
  {
    name: "DeBERTa-v3-xsmall",
    url: "https://huggingface.co/microsoft/deberta-v3-xsmall",
    detail: "about.model.deberta",
    license: { key: "about.license.mitTrained" },
  },
  {
    name: "ModernBERT-base",
    url: "https://huggingface.co/answerdotai/ModernBERT-base",
    detail: "about.model.modernbert",
    license: { key: "about.license.apacheTrained" },
  },
];

/** Word lists shipped with the app (keep in sync with training/configs/dictionary.yaml). */
const WORD_LISTS: Credit[] = [
  {
    name: "New General Service List 1.2",
    url: "https://www.newgeneralservicelist.com/new-general-service-list",
    detail: "about.wordList.ngsl",
    license: { literal: "CC BY-SA 4.0" },
  },
];

/** Libraries shipped with the app (versions pinned in package-lock.json). */
const LIBRARIES: Credit[] = [
  {
    name: "Transformers.js 4.3.2",
    url: "https://github.com/huggingface/transformers.js",
    detail: "about.lib.transformers",
    license: { literal: "Apache 2.0" },
  },
  {
    name: "ONNX Runtime Web",
    url: "https://github.com/microsoft/onnxruntime",
    detail: "about.lib.onnx",
    license: { literal: "MIT" },
  },
  {
    name: "wink-nlp 2.4.0 and wink-eng-lite-web-model 1.8.1",
    url: "https://github.com/winkjs/wink-nlp",
    detail: "about.lib.wink",
    license: { literal: "MIT" },
  },
  { name: "React 19.3.1", url: "https://react.dev", detail: "about.lib.react", license: { literal: "MIT" } },
  {
    name: "React Router 8.5.2",
    url: "https://reactrouter.com",
    detail: "about.lib.router",
    license: { literal: "MIT" },
  },
];

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className={styles.visuallyHidden}> {t("common.opensNewTab")}</span>
    </a>
  );
}

function CreditList({ items }: { items: readonly Credit[] }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <ul className={styles.list}>
      {items.map((c) => (
        <li key={c.name} className={styles.item}>
          <ExternalLink href={c.url}>{c.name}</ExternalLink>
          <span>{t(c.detail)}</span>
          <span className={styles.license}>
            {t("about.licenseLabel")}: {"key" in c.license ? t(c.license.key) : c.license.literal}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** About & licenses: attribution for the app, models, training data, word lists, libraries, and dictionary (T21). */
export function AboutPage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title">{t("about.title")}</h1>
      <p>{t("about.intro")}</p>

      <section aria-labelledby="about-app" className={styles.section}>
        <h2 id="about-app">{t("about.appTitle")}</h2>
        <p>{t("about.appLicense")}</p>
        <p className={styles.notice} lang="en">
          {REQUIRED_NOTICE}
        </p>
        <p className={styles.links}>
          <ExternalLink href={POLYFORM.url}>{POLYFORM.name}</ExternalLink>
        </p>
      </section>

      <section aria-labelledby="about-models" className={styles.section}>
        <h2 id="about-models">{t("about.modelsTitle")}</h2>
        <CreditList items={MODELS} />
      </section>

      <section aria-labelledby="about-data" className={styles.section}>
        <h2 id="about-data">{t("about.dataTitle")}</h2>
        <p>{t("about.dataNote")}</p>
        <blockquote className={styles.attribution} lang="en">
          {EWT_ATTRIBUTION}
        </blockquote>
        <p className={styles.links}>
          <ExternalLink href="https://github.com/UniversalDependencies/UD_English-EWT">
            {t("about.dataSource")}
          </ExternalLink>
          {" · "}
          <ExternalLink href={CC_BY_SA.url}>{CC_BY_SA.name}</ExternalLink>
        </p>
      </section>

      <section aria-labelledby="about-wordlists" className={styles.section}>
        <h2 id="about-wordlists">{t("about.wordListTitle")}</h2>
        <CreditList items={WORD_LISTS} />
      </section>

      <section aria-labelledby="about-libraries" className={styles.section}>
        <h2 id="about-libraries">{t("about.librariesTitle")}</h2>
        <CreditList items={LIBRARIES} />
      </section>

      <section aria-labelledby="about-dictionary" className={styles.section}>
        <h2 id="about-dictionary">{t("about.dictionaryTitle")}</h2>
        <p>{t("about.dictionaryNone")}</p>
      </section>
    </section>
  );
}
