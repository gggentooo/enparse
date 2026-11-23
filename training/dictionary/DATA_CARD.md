<!--
training/dictionary/DATA_CARD.md — data card of the Enparse dictionary data (T70)

Description:
  Sources, versions, licenses, attribution, build steps, format, and known
  limits of the dictionary data served at /dict/v<N>/. Kept in sync with
  configs/dictionary.yaml (pins), dictionary/build.py (format), and the app's
  About page (src/components/Pages/AboutPage.tsx → DICTIONARY).

Status: v1 built (2026-11-23, T70).
-->

# Enparse dictionary data — data card

English–Korean learner dictionary data for Enparse, built by `training/dictionary/` (T70) and served from the app's own origin at `/dict/v<N>/` (Cloudflare R2, key prefix `dict/`; `functions/dict/[[path]].ts`).

## License

The built data combines the sources below and is shared under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/), because Wiktionary content is share-alike (owner, 2026-11-23). The app's source code keeps its own license (PolyForm Noncommercial 1.0.0); the dictionary data is a separate work.

## Sources and attribution

Pinned in `training/configs/dictionary.yaml` (URL, local file, SHA-256). Each version's `manifest.json` repeats them.

| Source | Version | Used for | License |
|---|---|---|---|
| Open English WordNet | 2025 edition | English definitions and examples (noun, verb, adjective, adverb), irregular word forms, phrasal verbs | CC BY 4.0 |
| English Wiktionary, via the kaikki.org English extract (wiktextract) | downloaded once (date in the YAML); a pinned subset is kept | Korean translations, inflected forms, parts of speech, definitions for parts of speech WordNet lacks (pronouns, determiners, prepositions, conjunctions, …), how widely a word is translated (headword ranking) | CC BY-SA 4.0 |
| Tatoeba | export of the download date | English–Korean example sentence pairs | CC BY 2.0 FR |
| New General Service List | 1.2 | headword selection | CC BY-SA 4.0 |
| UD English EWT | r2.19 (already in `data/raw/ud_ewt/`) | headword selection, coverage report | CC BY-SA 4.0 |

Attribution texts (shown on the About page):

- Open English WordNet 2025 (https://en-word.net/), by John P. McCrae and the Open English WordNet contributors, based on Princeton WordNet 3.0, CC BY 4.0.
- English Wiktionary (https://en.wiktionary.org/), by Wiktionary contributors, CC BY-SA 4.0; extracted with wiktextract by Tatu Ylonen (kaikki.org).
- Tatoeba (https://tatoeba.org), by the Tatoeba contributors, CC BY 2.0 FR. Each example keeps its Tatoeba sentence ids (`tatoeba: [english id, korean id]`), so it can be traced to its contributor.

Changes made to the sources: selection of headwords, senses, forms, translations, and examples; lower-casing of keys; trimming to the fields below; no text was rewritten.

## Build

From `training/` (Python 3.12 venv; Node for the wink step):

```bash
.venv/bin/python -m dictionary.fetch --pin     # download what is missing, check or pin SHA-256
.venv/bin/python -m dictionary.extract         # once: Wiktionary subset from the 3.2 GB extract (then deletable)
.venv/bin/python -m dictionary.build           # data/dict/v1/ + reports/dictionary.md
```

`build.py` runs `js/dict_lemmas.mjs` (through `npx tsx`), which applies the app's own `lookupKey` (`src/utils/helpers.ts`) and wink lemmatizer (`winkBackend.lemmaOf`) to every headword and form, so keys and lemmas match the running app.

**Headwords (owner, 2026-11-23):** NGSL headwords and UD EWT lemmas that have a WordNet or Wiktionary entry, then WordNet words with a Korean translation in Wiktionary (most widely translated first) up to 15,000 single words; plus phrasal verbs (verb + particle) whose verb is a headword. Proper nouns are not headwords.

**Entries (owner, 2026-11-23):** per part of speech (UPOS), WordNet senses with up to two examples each — or Wiktionary definitions where WordNet has no senses for that part of speech — and, separately, Korean translations grouped under Wiktionary's own sense labels. Translations are not matched to WordNet senses. Up to three Tatoeba pairs per headword, shortest first (3–14 English words).

**Inflection index:** Wiktionary inflected forms (plural, past, participles, third person, comparative, superlative; variants tagged obsolete, nonstandard, misspelling, etc. are left out), WordNet irregular forms, and "verb particle" forms of phrasal verbs. Corpus words (UD EWT, Tatoeba) whose wink lemma is a headword are added. The build report gives the share of index forms whose wink lemma is their headword.

## Format (schema 1)

All files are UTF-8 JSON, keys sorted.

- `manifest.json`: `schema`, `version`, `built`, `license`, `hash` (`fnv1a32-utf8`, `shards`, an `example` key and its shard), `counts`, `sources` (as above, with SHA-256), `files` (every other file: `bytes`, `sha256`). Revalidated by the server; the app checks each file against it.
- `index.json`: `headwords` (sorted keys), `forms` (form key → headword keys). Loaded on the first lookup.
- `shards/NNN.json` (000–127): key → entry, for keys with `FNV-1a-32(UTF-8 key) mod 128 = NNN`.

Keys are `lookupKey(text)`: NFKC, lower case, collapsed spaces; phrasal verbs as "verb particle".

Entry:

```json
{
  "headword": "run",
  "pos": [
    {
      "upos": "VERB",
      "from": "wordnet",
      "senses": [{ "def": "move fast by using one's feet …", "examples": ["Don't run — you'll be out of breath"] }],
      "ko": [{ "sense": "to move swiftly", "words": ["달리다", "뛰다"] }]
    }
  ],
  "examples": [{ "en": "…", "ko": "…", "tatoeba": [1234, 5678] }]
}
```

Parts of speech are ordered by number of senses; the app shows the predicted part of speech first (T25).

## Known limits

- Wiktionary's Korean translations exist for part of the headwords only (see `reports/dictionary.md`), and their sense labels are Wiktionary's, not WordNet's.
- WordNet lists many rare senses; all are kept (T25: all senses).
- Tatoeba has about 11,600 English–Korean pairs, so many headwords have no example.
- kaikki.org serves only its latest extract: a rebuild uses the pinned subset (`wiktionary.subset` in the YAML); a newer extract means a new data version.
