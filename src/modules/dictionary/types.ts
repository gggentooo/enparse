/**
 * src/modules/dictionary/types.ts — types for the dictionary module
 *
 * Description:
 *   Shapes of the dictionary data (T70; training/dictionary/DATA_CARD.md,
 *   schema 1), of lookups and their results, and of the offline download
 *   state; DictionaryLoadError.
 *
 * Layer: modules/ (dictionary)
 *
 * Dependencies:
 *   None. Used by: ./staticDb.ts, ./dictionary.ts, ./index.ts.
 *
 * Status: implemented (T46).
 */

/** Data format version this app reads (manifest → schema). */
export const DICTIONARY_SCHEMA = 1;

/** One file of the data: size and SHA-256 (hex), from the manifest. */
export type DictFile = { bytes: number; sha256: string };

/** A source of the data, with its license and attribution (About page). */
export type DictionarySource = {
  key: string;
  name: string;
  url: string;
  license: string;
  license_url: string;
  attribution: string;
};

/** manifest.json of one data version (only the fields the app reads). */
export type DictionaryManifest = {
  schema: number;
  version: number;
  license: { name: string; url: string };
  /** Shard of a key: FNV-1a 32 of its UTF-8 bytes mod `shards`. */
  hash: { name: string; shards: number };
  sources: DictionarySource[];
  /** Every other file of the version (index.json, shards/NNN.json) by relative path. */
  files: Record<string, DictFile>;
};

/** index.json: headword keys and the inflection index (form key → headword keys). */
export type DictionaryIndex = { headwords: ReadonlySet<string>; forms: ReadonlyMap<string, readonly string[]> };

/** One sense: a definition and its examples. */
export type Sense = { definition: string; examples: string[] };

/** Korean translations under one of Wiktionary's sense labels (not matched to WordNet senses; owner, T70). */
export type KoreanGroup = { sense: string; words: string[] };

/** One part of speech of an entry. */
export type PosGroup = {
  /** UPOS tag (NOUN, VERB, ADJ, ADV, PRON, DET, ADP, …). */
  upos: string;
  /** Where the definitions come from: WordNet, or Wiktionary where WordNet has none. */
  from: "wordnet" | "wiktionary" | null;
  senses: Sense[];
  korean: KoreanGroup[];
};

/** An English–Korean example pair from Tatoeba, with its sentence ids (attribution). */
export type Example = { en: string; ko: string; tatoeba: [number, number] };

/** A dictionary entry. */
export type DictionaryEntry = {
  /** Lookup key (lookupKey of the headword). */
  key: string;
  /** Headword as written ("run", "I", "look up"). */
  headword: string;
  /** Parts of speech; the queried part of speech first (lookup). */
  pos: PosGroup[];
  examples: Example[];
};

/** A lookup: what the user typed or clicked. */
export type DictionaryQuery = {
  /** Surface form ("ran", "Looked up"). */
  word: string;
  /** Lemma from the parse (wink, T71); tried first for parse clicks. */
  lemma?: string | null;
  /** Part of speech from the parse (UPOS); its senses are shown first. */
  upos?: string | null;
  /**
   * A possible phrasal verb the parse did not mark: the word with its neighbouring verb or
   * particle ("ran out" → lemma "run out"). Tried first; ignored unless it is a headword.
   */
  phrase?: { word: string; lemma: string } | null;
};

/** How an entry was found ("phrase": a possible phrasal verb from neighbouring words, tried first). */
export type MatchKind = "phrase" | "lemma" | "headword" | "form";

export type LookupResult = {
  query: DictionaryQuery;
  /** Matching entries in order (a form can belong to several headwords: "saw" → saw, see). */
  entries: Array<{ entry: DictionaryEntry; match: MatchKind }>;
};

/** Offline availability of the dictionary on this device. */
export type OfflineState = {
  /** none: nothing stored; partial: some files (looked-up shards); complete: every file. */
  state: "none" | "partial" | "complete";
  cachedFiles: number;
  totalFiles: number;
  cachedBytes: number;
  totalBytes: number;
};

/** Byte progress of the offline download. */
export type DownloadProgress = (bytesDone: number, bytesTotal: number) => void;

/** Why dictionary data could not be loaded. */
export type DictionaryLoadReason = "network" | "integrity" | "storage" | "format" | "cancelled";

export class DictionaryLoadError extends Error {
  readonly reason: DictionaryLoadReason;
  constructor(reason: DictionaryLoadReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DictionaryLoadError";
    this.reason = reason;
  }
}
