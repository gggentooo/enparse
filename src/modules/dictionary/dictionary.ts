/**
 * src/modules/dictionary/dictionary.ts — dictionary lookup
 *
 * Description:
 *   Resolves a word (surface form, optional lemma and part of speech) to
 *   dictionary entries (owner decisions T25, T42, T71). Display is in
 *   components.
 *
 * Layer: modules/ (dictionary)
 *
 * Lookup order (keys from utils/helpers.ts → lookupKey, like the build):
 *   1. the lemma from the parse (wink, T71), if it is a headword (parse clicks);
 *   2. the word itself, if it is a headword ("look up", "American");
 *   3. the inflection index: the word as a form of headwords ("ran" → run,
 *      "saw" → saw, see; DictionaryPage resolves inflected forms without wink);
 *   4. the lemma as a form, if the lemma is not a headword.
 *   Duplicates are dropped; each result says how it matched. Senses of the
 *   queried part of speech come first (UPOS; AUX counts as VERB, PROPN as
 *   NOUN); the other parts of speech keep their order.
 *   Recent results are kept (LOOKUP_CACHE_SIZE).
 *
 * Dependencies:
 *   Internal: ./staticDb.ts (StaticDb), ./types.ts; utils/helpers.ts (lookupKey).
 *   Used by: ./index.ts (services/dictionaryService.ts).
 *
 * Status: implemented (T46). Tests: dictionary.test.ts.
 */

import { lookupKey } from "../../utils/helpers";
import type { StaticDb } from "./staticDb";
import type { DictionaryEntry, DictionaryQuery, LookupResult, MatchKind, PosGroup } from "./types";

/** Recent lookups kept in memory. */
export const LOOKUP_CACHE_SIZE = 200;

/** Parser tags that share a dictionary part of speech. */
const UPOS_ALIASES: Readonly<Record<string, string>> = { AUX: "VERB", PROPN: "NOUN" };

/** Parts of speech with the queried one first (stable otherwise). */
export function orderPos(groups: readonly PosGroup[], upos: string | null | undefined): PosGroup[] {
  if (!upos) return [...groups];
  const want = UPOS_ALIASES[upos] ?? upos;
  return [...groups.filter((g) => g.upos === want), ...groups.filter((g) => g.upos !== want)];
}

export interface Dictionary {
  lookup(query: DictionaryQuery): Promise<LookupResult>;
}

export function createDictionary(db: StaticDb): Dictionary {
  const recent = new Map<string, Promise<LookupResult>>();

  async function run(query: DictionaryQuery): Promise<LookupResult> {
    const idx = await db.index();
    const word = lookupKey(query.word);
    const lemma = query.lemma ? lookupKey(query.lemma) : null;
    const keys: Array<[string, MatchKind]> = [];
    const add = (key: string, match: MatchKind): void => {
      if (key && !keys.some(([k]) => k === key)) keys.push([key, match]);
    };
    if (lemma && idx.headwords.has(lemma)) add(lemma, "lemma");
    if (idx.headwords.has(word)) add(word, "headword");
    for (const k of idx.forms.get(word) ?? []) add(k, "form");
    if (lemma && !idx.headwords.has(lemma)) for (const k of idx.forms.get(lemma) ?? []) add(k, "form");
    const entries: LookupResult["entries"] = [];
    for (const [key, match] of keys) {
      const e: DictionaryEntry | null = await db.entry(key);
      if (e) entries.push({ entry: { ...e, pos: orderPos(e.pos, query.upos) }, match });
    }
    return { query, entries };
  }

  return {
    lookup(query) {
      const id = `${query.word}\u0000${query.lemma ?? ""}\u0000${query.upos ?? ""}`;
      const hit = recent.get(id);
      if (hit) return hit;
      const p = run(query);
      recent.set(id, p);
      p.catch(() => recent.delete(id)); // failures (offline) are retried next time
      while (recent.size > LOOKUP_CACHE_SIZE) recent.delete(recent.keys().next().value as string);
      return p;
    },
  };
}
