/**
 * training/js/dict_lemmas.mjs — app keys and wink lemmas for the dictionary build (T70)
 *
 * Description:
 *   The dictionary must use the app's own keys and lemmas (owner, T42), so the
 *   Python build (dictionary/build.py) hands its headwords and word forms to
 *   this step, which runs the app code through tsx:
 *     - lookupKey(text)  (src/utils/helpers.ts) for every text: the only
 *       source of keys in the output (index, shards, hash input);
 *     - lemmaOf(word)    (src/modules/parser/winkBackend.ts) for every single
 *       word: used to check the inflection index against wink and to add
 *       wink-only mappings for corpus words.
 *   Reads data/dict/build/wink_in.json ({ "texts": [...] }); writes
 *   data/dict/build/wink_out.json ({ "keys": {text: key}, "lemmas": {text: lemma} }).
 *
 * Run (from training/js): npx tsx dict_lemmas.mjs   (build.py runs it)
 * Dependencies: tsx; app code: src/utils/helpers.ts, src/modules/parser/winkBackend.ts.
 * Status: implemented (T70).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lemmaOf } from "../../src/modules/parser/winkBackend.ts";
import { lookupKey } from "../../src/utils/helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = resolve(HERE, "..", "data", "dict", "build");
const { texts } = JSON.parse(readFileSync(join(WORK, "wink_in.json"), "utf8"));
const keys = {};
const lemmas = {};
for (const text of texts) {
  keys[text] = lookupKey(text);
  if (!/\s/.test(text)) lemmas[text] = lemmaOf(text);
}
writeFileSync(join(WORK, "wink_out.json"), JSON.stringify({ keys, lemmas }));
console.log(`dict_lemmas: ${texts.length} texts, ${Object.keys(lemmas).length} lemmas`);
