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
 *   0. a possible phrasal verb from neighbouring words (query.phrase: "ran
 *      out" → run out), if it is a headword;
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
 * Glosses (T102; owner, T100): short definitions of many words at once (the
 *   vocabulary statistics and word lists of a parsed text). Same key order;
 *   the first entry with the word's part of speech gives the Korean gloss
 *   (its first translation group, at most GLOSS_KOREAN_WORDS words) and the
 *   English one (its first sense). No match of the part of speech: null.
 *
 * Dependencies:
 *   Internal: ./staticDb.ts (StaticDb), ./types.ts; utils/helpers.ts (lookupKey).
 *   Used by: ./index.ts (services/dictionaryService.ts).
 *
 * Status: implemented (T46). Tests: dictionary.test.ts.
 */

import { lookupKey } from "../../utils/helpers";
import { DictionaryLoadError } from "./types";
import type { BulkOptions, StaticDb } from "./staticDb";
import type {
  DictionaryEntry,
  DictionaryIndex,
  DictionaryLoadReason,
  DictionaryQuery,
  LookupResult,
  MatchKind,
  PosGroup,
} from "./types";

/** Recent lookups kept in memory. */
export const LOOKUP_CACHE_SIZE = 200;

const toReason = (e: unknown): DictionaryLoadReason => (e instanceof DictionaryLoadError ? e.reason : "network");

/** Parser tags that share a dictionary part of speech. */
const UPOS_ALIASES: Readonly<Record<string, string>> = { AUX: "VERB", PROPN: "NOUN" };

/** Parts of speech with the queried one first (stable otherwise). */
export function orderPos(groups: readonly PosGroup[], upos: string | null | undefined): PosGroup[] {
  if (!upos) return [...groups];
  const want = UPOS_ALIASES[upos] ?? upos;
  return [...groups.filter((g) => g.upos === want), ...groups.filter((g) => g.upos !== want)];
}

/** Korean words of a gloss at most (owner, T100). */
export const GLOSS_KOREAN_WORDS = 3;

/** Short definitions of one word (T102); null fields when the entry has none. */
export type Gloss = { headword: string; ko: string | null; en: string | null };
/** Glosses in query order (null: no entry with the word's part of speech, or its shard failed). */
export type GlossResult = { glosses: Array<Gloss | null>; error: DictionaryLoadReason | null };

export interface Dictionary {
  lookup(query: DictionaryQuery): Promise<LookupResult>;
  glosses(queries: readonly DictionaryQuery[], options?: BulkOptions): Promise<GlossResult>;
}

/** Entry keys of a query in lookup order (see the header), each with how it matched. */
function candidateKeys(idx: DictionaryIndex, query: DictionaryQuery): Array<[string, MatchKind]> {
  const word = lookupKey(query.word);
  const lemma = query.lemma ? lookupKey(query.lemma) : null;
  const keys: Array<[string, MatchKind]> = [];
  const add = (key: string, match: MatchKind): void => {
    if (key && !keys.some(([k]) => k === key)) keys.push([key, match]);
  };
  const phrase = query.phrase ? lookupKey(query.phrase.lemma) : null;
  if (phrase && idx.headwords.has(phrase)) add(phrase, "phrase");
  if (lemma && idx.headwords.has(lemma)) add(lemma, "lemma");
  if (idx.headwords.has(word)) add(word, "headword");
  for (const k of idx.forms.get(word) ?? []) add(k, "form");
  if (lemma && !idx.headwords.has(lemma)) for (const k of idx.forms.get(lemma) ?? []) add(k, "form");
  return keys;
}

/** The gloss of an entry for a part of speech, or null if the entry lacks that part of speech. */
export function glossOf(entry: DictionaryEntry, upos: string | null | undefined): Gloss | null {
  const want = upos ? (UPOS_ALIASES[upos] ?? upos) : null;
  const group = want ? entry.pos.find((g) => g.upos === want) : entry.pos[0];
  if (!group) return null;
  const words = group.korean.find((k) => k.words.length > 0)?.words.slice(0, GLOSS_KOREAN_WORDS) ?? [];
  const en = group.senses.find((s) => s.definition.trim() !== "")?.definition ?? null;
  return { headword: entry.headword, ko: words.length > 0 ? words.join(", ") : null, en };
}

export function createDictionary(db: StaticDb): Dictionary {
  const recent = new Map<string, Promise<LookupResult>>();

  async function run(query: DictionaryQuery): Promise<LookupResult> {
    const idx = await db.index();
    const keys = candidateKeys(idx, query);
    const entries: LookupResult["entries"] = [];
    for (const [key, match] of keys) {
      const e: DictionaryEntry | null = await db.entry(key);
      if (e) entries.push({ entry: { ...e, pos: orderPos(e.pos, query.upos) }, match });
    }
    return { query, entries };
  }

  return {
    lookup(query) {
      const id = `${query.word}\u0000${query.lemma ?? ""}\u0000${query.upos ?? ""}\u0000${query.phrase?.lemma ?? ""}`;
      const hit = recent.get(id);
      if (hit) return hit;
      const p = run(query);
      recent.set(id, p);
      p.catch(() => recent.delete(id)); // failures (offline) are retried next time
      while (recent.size > LOOKUP_CACHE_SIZE) recent.delete(recent.keys().next().value as string);
      return p;
    },

    async glosses(queries, options) {
      let idx: DictionaryIndex;
      try {
        idx = await db.index();
      } catch (e) {
        return { glosses: queries.map(() => null), error: toReason(e) };
      }
      const perQuery = queries.map((q) => candidateKeys(idx, q).map(([k]) => k));
      const { entries, error } = await db.entries(perQuery.flat(), options);
      const glosses = queries.map((q, i) => {
        for (const key of perQuery[i] ?? []) {
          const e = entries.get(key);
          const g = e ? glossOf(e, q.upos) : null;
          if (g) return g;
        }
        return null;
      });
      return { glosses, error: error?.reason ?? null };
    },
  };
}

/**
 * Particles of phrasal verbs (identical to training/dictionary/common.py → PARTICLES): a verb
 * directly followed by one of these may form a phrasal verb headword ("run out").
 */
export const PHRASAL_PARTICLES: ReadonlySet<string> = new Set(
  (
    "about across after along apart around aside away back by down forth in into off on onto out" +
    " over round through together under up upon with without"
  ).split(" "),
);
