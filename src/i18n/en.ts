/**
 * src/i18n/en.ts — English UI messages (reference catalog)
 *
 * Description:
 *   Every UI message key with its English text. This catalog defines the key set: other
 *   languages must provide every key (checked by the Messages type and tests). Placeholders
 *   are written {name}. Grammar labels pair the term with its abbreviation (T18).
 *
 * Layer: i18n (data; imports nothing).
 * Status: implemented (T68).
 */

export const en = {
  "app.name": "Enparse",
  "app.tagline": "English sentence structure for learners",
  "app.errorTitle": "Something went wrong",
  "app.errorBody": "This page could not be shown. Go back to the input page and try again.",
  "app.errorLink": "Go to the input page",

  "layout.skip": "Skip to content",
  "nav.label": "Pages",
  "nav.input": "Input",
  "nav.output": "Output",
  "nav.vocab": "Vocabulary",
  "nav.dictionary": "Dictionary",
  "nav.models": "Models",
  "nav.about": "About & licenses",

  "language.label": "Language",

  "update.available": "A new version of Enparse is ready.",
  "update.reload": "Reload",
  "common.loading": "Loading",
  "common.close": "Close",
  "common.opensNewTab": "(opens in a new tab)",

  "page.input.title": "Input",
  "page.input.placeholder": "Paste or type English text here to parse it. This page is built in T56.",
  "page.output.title": "Output",
  "page.output.placeholder": "Parsed sentences appear here. This page is built in T57.",
  "page.vocab.title": "Vocabulary",
  "page.vocab.placeholder": "Your vocabulary lists appear here. This page is built in T48.",
  "page.dictionary.title": "Dictionary",
  "page.dictionary.placeholder": "Look up English words here. This page is built in T53.",
  "page.models.title": "Models",
  "page.models.placeholder": "Choose, download, and delete parser models here. This page is built in T54.",

  "about.title": "About & licenses",
  "about.intro":
    "Enparse runs entirely in your browser. The parser models, training data, word lists, and libraries below are used under their licenses.",
  "about.appTitle": "Enparse",
  "about.appLicense":
    "The app's own code is licensed under the PolyForm Noncommercial License 1.0.0: it may be used, changed, and shared for non-commercial purposes, keeping the notice below.",
  "about.modelsTitle": "Parser models",
  "about.dataTitle": "Training data",
  "about.dataNote": "The attribution below is given in English, as required by the license.",
  "about.dataSource": "UD English EWT on GitHub",
  "about.wordListTitle": "Word lists",
  "about.librariesTitle": "Libraries",
  "about.dictionaryTitle": "Dictionary sources",
  "about.dictionaryNone": "No dictionary data is included yet.",
  "about.licenseLabel": "License",
  "about.model.deberta": "Fine-tuned from microsoft/deberta-v3-xsmall (MIT). Trained model files: CC BY-SA 4.0.",
  "about.model.modernbert":
    "Fine-tuned from answerdotai/ModernBERT-base (Apache 2.0). Trained model files: CC BY-SA 4.0.",
  "about.license.mitTrained": "MIT (base) · CC BY-SA 4.0 (trained)",
  "about.license.apacheTrained": "Apache 2.0 (base) · CC BY-SA 4.0 (trained)",
  "about.wordList.ngsl":
    "New General Service List by Browne, C., Culligan, B., and Phillips, J. Used as the known-word list for word parts (lower-cased, de-duplicated).",
  "about.lib.transformers": "Runs the parser models.",
  "about.lib.onnx": "Model inference (WebGPU and WebAssembly).",
  "about.lib.wink": "Sentences, words, and lemmas.",
  "about.lib.react": "User interface.",
  "about.lib.router": "Page navigation.",

  "grammar.NP": "Noun phrase (NP)",
  "grammar.VP": "Verb phrase (VP)",
  "grammar.PP": "Prepositional phrase (PP)",
  "grammar.ADJP": "Adjective phrase (ADJP)",
  "grammar.ADVP": "Adverb phrase (ADVP)",
  "grammar.S": "Clause (S)",
  "role.Subject": "Subject",
  "role.Predicate": "Predicate",
  "role.Object": "Object",
  "role.Indirect Object": "Indirect object",
  "role.Complement": "Complement",
  "role.Modifier": "Modifier",
  "role.Passive subject": "Passive subject",
  "role.Agent": "Agent (by-phrase)",
  "role.Relative clause": "Relative clause",
  "role.Possessive": "Possessive",
  "role.Particle": "Particle",
} as const;

/** Every message key. */
export type MessageKey = keyof typeof en;
/** A complete catalog for one language. */
export type Messages = { readonly [K in MessageKey]: string };
