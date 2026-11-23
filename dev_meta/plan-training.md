# Enparse Parser Training Plan

## Document Maintaining Guide

This guide applies to all contributors (human and AI) editing this file.

### Rules

1. **Direct edits.** Edits are made directly on the document. Existing content may be modified, reordered, or removed as needed.
2. **Changelog at bottom.** A 'Changelog' section must always exist at the bottom of the document. All changes made with each update are appended to the bottom of the changelog with a summary and timestamp. The [Author] field must be filled in with the username in the case of human contributors, and the model name in the case that an agent makes the update.
3. **Concise language.** Write in brief, clear English. Avoid unnecessary verbosity.
4. **Changelog format.** Each changelog entry must begin with a datetime stamp in ISO 8601 format (e.g., `2026-11-17T10:30:00Z`), followed by a bulleted list of what was added, modified, or removed.

### Format template

```md
## Changelog

### YYYY-MM-DDTHH:MM:SSZ — [Author], [Brief title]

- Added: ...
- Modified: ...
- Removed: ...
```

---

## Overview

- **Goal:** Train the Enparse parser model: a token classifier that gives each word two outputs in one pass:
  - **Flat output:** UPOS tag and chunk tag (NP, VP, PP, ADJP, ADVP).
  - **Structure output:** the word's dependency head and relation. The nested phrase view is built from it (see *Nested phrase structure*).
- **Output:** one quantized ONNX model per candidate base model that meets the acceptance thresholds (up to four), loaded by `parser/transformerBackend.ts` via Transformers.js. The app offers them in a model library and the user chooses (`architecture.md` → *Model library*); no single base model is selected (owner decision, 2026-11-18).
- **Priority:** Accuracy before speed. Runtime budget: ≤ ~5 s per 5,000 characters on a typical laptop.
- **Training machine:** MacBook Pro M5 Pro, 48 GB unified memory. Training uses the PyTorch MPS (Metal) backend.
- **Training framework:** Hugging Face `Trainer` on MPS for every candidate. Unsloth was ruled out in Phase 0.

### Key design decisions

- **Two label groups, one classifier.** Each word gets two labels, predicted together:
  - Group A: `UPOS|CHUNK` (e.g., `NOUN|B-NP`). UPOS and chunk probabilities are recovered by summing group-A probabilities.
  - Group B: dependency head and relation, encoded as a word label (see *Nested phrase structure*).
  - The model is a standard `AutoModelForTokenClassification` whose classifier has `|A| + |B|` outputs. One linear layer with `|A| + |B|` outputs is the same as two linear heads side by side. Training applies a separate softmax and cross-entropy loss to each slice (custom `compute_loss`). `Trainer`, Optimum's `token-classification` export, and Transformers.js work unchanged.
  - Why one packed `logits` output: Transformers.js `*ForTokenClassification` classes keep only the `logits` output and drop any other ONNX outputs (checked in `@huggingface/transformers` 4.3.2, `TokenClassifierOutput`). Separate outputs would need a custom export and a custom runtime model class.
  - `labels.json` records where each group's slice starts and ends (Phase 4 schema).
- **Word unit = runtime word unit.** Training words must match the words wink-nlp produces at runtime (Phase 3).
- **Labels on first subword.** Only the first subword of each word carries a label; others are ignored in the loss (`-100`).
- **Partial labels.** Words without a checked label (e.g., unreviewed words in user feedback) also get `-100`, so the loss uses only labels a person or the treebank confirmed (Phase 4).
- **Traceable outputs.** `labels.json` has a fixed, versioned schema (Phase 4), and the app's `ParseResult` carries the model version and wink word offsets (Phase 11), so any parse, including user feedback, can be traced to the model and word split that produced it.
- **Multi-sentence context.** Training examples are windows of consecutive sentences from the same document, packed the same way at runtime (whole sentences up to 256 subword tokens, no overlap; *Biaffine design* below).
- **Cased models only.** Capitalization is a strong cue for proper nouns and sentence boundaries.
- **Every candidate is trained and may ship.** Phases 7–11 run for each of the four candidates. A model is offered only if its test metrics meet the acceptance thresholds; its nested view is enabled only if it meets the nested-view targets (*Nested phrase structure*). Each offered model ships with its measured size, accuracy, speed, and memory in `public/models/catalog.json`.
- **No rule-based nesting.** The nested phrase view comes from the model's structure output, not from hand-written rules. Runtime steps are strictly deterministic over the predicted tree: decoding and bracketing (`parser/treeDecoder.ts`) plus grammatical role and head-of-parent labeling (`parser/phraseLabeler.ts`, below; approved 2026-11-20); neither overrides attachments with hand-written grammar rules. **One exception (owner, 2026-11-23; T73):** quantity expressions from a closed list (*a number of* …) are displayed as a quantifier of the following noun (`parser/quantifiers.ts`, *Quantity expressions* below). It changes the displayed tree only; the model output and `Token.head` keep the UD analysis.

### Nested phrase structure

Confirmed by owner (2026-11-18): two views and phrase labels as below. **Bracketing order replaced by the owner on 2026-11-23 (T73):** one bracket per phrase instead of one nesting level per dependent (*Decoding* step 3), a quantifier display rule, arrows from each phrase to what it attaches to, and confidence gating per span instead of the whole-bracket product.

**Nested-view acceptance (owner, 2026-11-19; replaces UAS ≥ 97 / LAS ≥ 94, which Phase 7 showed out of reach on EWT):** per model, on the test split:
- UAS excluding punctuation ≥ 93% (punctuation is not bracketed in the view);
- labeled bracket F1 over multi-word brackets ≥ 88%;
- precision of the brackets actually shown ≥ 95% after confidence gating (Phase 8 calibration), with coverage reported. Brackets below the confidence threshold collapse: their words show flat inside the parent phrase.

A model that misses them is offered without the nested view (the flat view is unaffected).

**Planned change (owner, 2026-11-19): biaffine parser head.** After the Phase 7 extended stage, group B (head-position labels) is replaced by a biaffine arc scorer (every word scores every head in its sentence; root via the first special token) plus a per-word relation classifier in the packed logits. Arc scores ship as a second ONNX output (Transformers.js `model.forward()` returns all outputs); `treeDecoder.ts` decodes trees with maximum spanning tree (Chu-Liu-Edmonds), so no head is unresolvable and no root or cycle repair is needed. Measured motivation (Phase 7 test, DeBERTa): the correct head is in the top 5 head labels for 96.7% of words, but 23% of sentences needed repair; MST over the current labels gives no gain. Expected +1–2 UAS (to be measured). All four models are retrained with it (Phase 7 again), with the relation classifier keeping the ten-subtype allowlist (*Head encoding*), then Phases 8–9.

**Biaffine design (owner, 2026-11-20; `todo.md` T04, T06, T07, T08):**
- **Arc scope:** a word scores only heads in its own sentence, plus the root (first special token). Training masks by UD sentence, the runtime by wink sentence (same as the Phase 3 decision; arcs that cross wink sentences attach to the sentence root).
- **Score matrix:** subword-level `[T, T]` (`arc_scores`), read at first-subword positions by the loss and the runtime. The export keeps the standard `input_ids` / `attention_mask` inputs; T05 checks that Transformers.js returns both outputs.
- **Windows:** the runtime packs whole wink sentences into windows of up to 256 subword tokens, exactly like training (no overlap). Only a sentence longer than 256 subwords is split with overlap (32 tokens): each word takes its scores from the window where it is farthest from the edge, and heads outside that window score −∞.
- **BIO repair:** a stray `I-X` (after `O` or another type) becomes `B-X`, the same reading seqeval's default mode already uses for reported chunk F1, so app and metrics agree. Constrained Viterbi stays a possible later experiment.
- **Augmentation:** `lowercase_sentence_start` and `drop_final_punct` run as an experiment in the retrain (kept only if dev scores do not drop); `learner_typos` stays out of v1.
- **Settings:** selection score (mean of dev chunk F1 and LAS) and λ per model (fixed from the base sweep) are confirmed. The learning-rate sweep adds 4e-4 and 5e-4 for DeBERTa-v3-xsmall and ModernBERT, which picked the top rate (3e-4) in the extended stage.

The app shows two views of each sentence:

| View | Example: *The red dog rarely barks loudly.* | Source |
|------|---------------------------------------------|--------|
| Flat phrases | `[NP The red dog] [ADVP rarely] [VP barks] [ADVP loudly] .` | Group A (chunk tags) |
| Nested phrases | `[The red dog] [rarely barks loudly] .` | Group B (dependency tree) |

- **Training data:** EWT already contains gold dependency trees. No new annotation is needed; the Phase 2 chunked files keep `HEAD` and `DEPREL`.
- **Head encoding:** relative-POS encoding from dependency parsing as sequence labeling (Strzyż et al., 2019). Each word's label is `<offset>@<head UPOS>|<relation>`; for example, `+1@NOUN|amod` means "head is the next NOUN to the right; relation amod". The root is `0@ROOT|root`. Base relations only; subtypes such as `nmod:poss` are dropped from group B. They stay in the data and still drive the Phase 2 chunk rules. **Subtypes after the biaffine change (owner, 2026-11-19):** the relation classifier keeps ten learner-relevant subtypes — `nsubj:pass`, `aux:pass`, `obl:agent`, `acl:relcl`, `nmod:poss`, `compound:prt`, `obl:unmarked`, `det:predet`, `advcl:relcl`, `cc:preconj` (passive voice, relative clauses, possessives, phrasal-verb particles, preposition-less time/measure phrases, predeterminers, correlative conjunctions). The other five EWT r2.19 subtypes (`nmod:unmarked`, `nmod:desc`, `nsubj:outer`, `csubj:outer`, `csubj:pass`) fold into their base relation. These are all 15 subtypes in EWT r2.19; the allowlist goes into `configs/` with the biaffine implementation. Decoding uses group A's predicted UPOS to find the head.
- **Decoding (`parser/treeDecoder.ts`):** turns group-B labels into a tree, then into nested phrases.
  1. Read each word's head from its label. If a head cannot be found or makes a cycle, use the next-best label for that word. If that fails too, attach the word to the root.
  2. Exactly one root per sentence: if several, keep the most probable one and attach the others to it.
  3. Build one bracket per phrase (owner, 2026-11-23; T73; replaces the head-outward binary order, which nested the subject and the copula around the predicate noun like modifiers):
     - **Phrase:** a head word with all its dependents, in word order. A dependent without dependents of its own stays a plain word inside the phrase; a dependent with dependents is its own bracket. `[a common name [given [to a number [of species [of fish]]]]]`; `[Most mackerel]`.
     - **Clause:** a head with a subject (`nsubj`, `csubj`, incl. `:pass`) gives a clause bracket holding the subject and the predicate bracket: `[[Mackerel] [is [a common name …]]]`. The predicate bracket holds the head and its other dependents on the head's side of the subject. Dependents on the other side of the subject (fronted adverbials, the auxiliary of a question, `mark`) and clause-level right dependents (`parataxis`, and `conj` whose conjunct has its own subject) stay in the clause bracket, outside the predicate. A one-word predicate is not bracketed.
     - **Copula:** with a `cop` dependent before the head, the head and its dependents after the copula (and after any auxiliary or subject before the head) form the complement bracket inside the predicate: `[are [from the Scombridae family]]`. Clause-level right dependents (`advcl`, `parataxis`, clausal `conj`) stay outside the complement. A one-word complement is not bracketed (`[is happy]`).
     - **Main clause (owner, 2026-11-23; T82):** the sentence's main clause, and clauses coordinated with it, get no clause bracket: the subject bracket and the predicate bracket are the outermost brackets (`[Mackerel] [typically have …]`), always shown even for one word. Below the bracket threshold they are drawn dashed instead of being removed (Phase 8 task 5). Embedded clauses keep their bracket.
     - **Coordination (owner, 2026-11-23; T82):** conjuncts are shown side by side, `[[red apples] and [green pears]]`. The head's dependents before the first conjunct belong to the first conjunct, which gets its own bracket; each later conjunct is its own bracket with its conjunction and punctuation outside it; the head's later dependents are shared. Every conjunct is its own bracket, one-word ones too (owner, T92): `[[as water vapor] or [ice]]`, `[[apples] , [pears] and [oranges]]`. The outer bracket carries the shared role. This regroups the model's attachments without changing any.
     - **Shared preposition (owner, 2026-11-23; T93):** a preposition before a coordination of nouns covers the whole coordination: `[as [[water vapor] or [ice]]]`, `[in [[the house] and [the garden]]]` (UD attaches it to the first conjunct). It stays with the first conjunct when a later conjunct has its own preposition (`[[in the box] or [on the shelf]]`) or is not a noun (`[[with friends] or [alone]]`). Display rule over the predicted tree; attachments are not changed.
     - **Near-ties (owner, 2026-11-23; T83):** when the top reading's share is below 60% (`output/types.ts` → `NEAR_TIE_SHARE`), the app presents the readings as equals: a note on the sentence, the readings list open and lettered A, B, …, the disputed phrase marked with a dashed arrow to each candidate and its share, and a fixed-template sentence per reading saying what it means (which word the phrase goes with; which part of speech a word is).
     - **Prepositions** (`case`) are words of their noun's phrase, so the phrase attaches as a unit: `[given [to …]]`.
     - Each bracket records its level (`phrase`, `complement`, `predicate`, `clause`, `conjunct`) for labeling.
  4. Punctuation is not bracketed. It sits in the innermost bracket of its head that surrounds it; punctuation at the edge of its head's phrase sits in that phrase, and the root's stays outside all brackets.
  5. Each phrase is labeled from its head word (noun → NP, verb → VP, adjective → ADJP, adverb → ADVP; a noun phrase with a `case` dependent → PP; a predicate or subjectless phrase with a copula → VP).
- **Quantity expressions (`parser/quantifiers.ts`; owner, 2026-11-23; T73, T77):** before bracketing, a quantity word *Q* from the closed list — *number, lot, lots, couple, plenty, deal* (only *a great/good deal*), *bit, amount, some* — directly followed by *of* + noun *N* (`N` is `nmod` of `Q` with `case` *of*) is displayed as a quantifier of *N*: *N* takes *Q*'s place in the tree (head and relation), *Q* attaches to *N* (display relation `quant`, role Modifier), *of* attaches to *Q*, and *Q* keeps only its article *a/an*, adjectives, and adverbs; its other dependents move to *N*. Not applied when *Q* has another determiner or a possessive (*the number of students* is not a quantifier). Result: `[to [a number of] species [of fish]]`. The same rule is applied to gold trees in evaluation.
- **Attachments (arrows; T73):** every dependent (its outermost bracket, or the word itself) records the word it attaches to; the app draws an arrow to that word on hover. **Span targets (owner, 2026-11-23; T81):** a modifier before its head (`det`, `amod`, `nummod`, `compound`, `nmod`, `advmod`, quantifier) in the same bracket modifies everything from just after itself through the head word, in noun and verb phrases alike: in *the big red dog*, the → *big red dog*, big → *red dog*, red → *dog*; in *has often quietly slept*, often → *quietly slept*. The span stops at the head word (words after it are not included); every other dependent targets the one word. Model errors such as an adjective attached to a following adjective are shown as predicted (no correction rule; owner). A subject points to the copula if there is one, else to the predicate's head word; a complement points to the subject's head word. If the dependent's role confidence is below `nested.role_threshold` (Phase 8 task 5b), the attachment is marked uncertain and its role is hidden.
- **Role and head labeling (`parser/phraseLabeler.ts`; approved by the owner 2026-11-20, conventions in `architecture.md` → *Parsing engine* → *Role labeling*):** deterministic post-processor over `treeDecoder.ts` output that uses `heads`, `relations`, and `upos` to attach learner-facing grammatical roles on each dependent's bracket or word (e.g., `nsubj` → `NP(Subject)`, predicate bracket → `VP(Predicate)` inside the clause `S`, complement bracket → Complement), mark each bracket's head word (`isHead`), record attachments, and handle UD copulas (`cop`) and head-initial coordination (`conj` + `cc`). Labeling runs on the full phrases; gating runs after it (Phase 8 task 5).
  - **Caveats for training and evaluation:**
    - `phraseLabeler.ts` runs after `treeDecoder.ts` and does not change the nested-phrase F1 span metric evaluated in Phase 7; its accuracy is strictly bounded by the model's UAS/LAS (wrong attachments or relations propagate directly into wrong roles), reinforcing the need for the biaffine head and Phase 8 confidence gating.
    - Group B currently strips UD subtypes. The biaffine relation classifier keeps the ten-subtype allowlist (*Head encoding* above), so `phraseLabeler.ts` can label passives, relative clauses, possessives, and phrasal-verb particles. Rare kept subtypes (`cc:preconj` 81, `advcl:relcl` 121, `det:predet` 177 train words) will have noisy test scores.
    - Discontinuous predicates (questions, inversion, fronted adjuncts where `contiguous: false`) and collapsed low-confidence brackets cannot always be wrapped in a single contiguous `VP(Predicate)` bracket; open conventions are tracked in `todo.md` → `[Modules/parser]` tasks.
- **Why decoding and role labeling are still needed:** a neural network outputs scores for each word, not brackets or learner role badges. Turning per-word predictions into a valid tree, brackets (`treeDecoder.ts`), and grammatical role/head labels (`phraseLabeler.ts`) is a fixed deterministic procedure (like BIO decoding for chunks) and never overrides attachments with hand-written grammar rules.
- **Flat and nested views can differ:** the views use different conventions (for example, `[NP the man] [PP in] [NP the car]` versus `[the [[man] [in [the [car]]]]]`). Both are shown as-is; the UI does not force one to match the other.
- **Expected accuracy:** see *Nested-view acceptance* and *Planned change* above (Phase 7 base results: tree UAS 88–92, LAS 86–90).

### Open questions

Moved to `todo.md` (2026-11-19). Decided items are recorded in the phases below.

---

## Prerequisites

### Hardware

- MacBook Pro M5 Pro, 48 GB memory. Sufficient for every candidate model; no cloud GPU needed.
- ~40 GB free disk space (datasets; checkpoints and ONNX exports for all four candidates).

### System software

| Tool | Purpose |
|------|---------|
| macOS (current release) + Xcode Command Line Tools | Compilers and Metal support for PyTorch MPS |
| Python 3.12 (managed with `uv`) | Training environment |
| Node.js 20+ | Tokenization alignment, JS baselines, Transformers.js benchmarks |
| git + git-lfs | Fetching UD treebanks and model weights; storing shipped model files in `public/models/` |
| Chrome, Safari, Firefox (current) | Browser benchmarks (WebGPU and WASM) |

### Python libraries (`training/requirements.txt`, versions pinned at setup)

| Library | Purpose |
|---------|---------|
| `torch` (MPS build) | Training backend |
| `transformers` | Models, tokenizers, `Trainer` |
| `datasets` | Dataset building and caching |
| `accelerate` | Device handling for `Trainer` |
| `conllu` | Parsing UD `.conllu` files |
| `seqeval` | CoNLL-style chunk precision/recall/F1 |
| `evaluate` | Metric helpers |
| `optimum`, `optimum-onnx` | ONNX export (exporter is in `optimum-onnx` since Optimum 2) and quantization |
| `onnx`, `onnxruntime` | ONNX validation and parity checks |
| `numpy`, `pandas` | Data handling and reports |
| `tensorboard` | Local training logs (no external tracking service) |
| `pytest` | Tests for data conversion scripts |
| `pyyaml` | Reading `configs/*.yaml` |
| `sentencepiece`, `protobuf` | DeBERTa-v3 tokenizer loading and fast-tokenizer conversion |
| `ruff` | Format and lint (dev only) |

### Node libraries (`training/js/package.json`)

| Library | Purpose |
|---------|---------|
| `wink-nlp`, `wink-eng-lite-web-model` | Runtime tokenizer for alignment; POS baseline (Phase 5) |
| `compromise` | Comparison baseline |
| `@huggingface/transformers` (Transformers.js) | ONNX parity and speed tests outside the browser |
| `tsx` | Runs the app's TypeScript (e.g., `winkBackend.ts`, `treeDecoder.ts`) from Node scripts |
| `js-yaml` | Reading `../configs/*.yaml` |

### Data

| Dataset | License | Use |
|---------|---------|-----|
| UD English EWT (latest UD release, pinned tag) | CC BY-SA 4.0 | Primary train/dev/test data (~254k words, web text) |
| UD English GUM | CC BY-NC-SA 4.0 (UD release) | Not used (non-commercial; Phase 1) |

### Base model candidates

Approximate shipped size at int8 ≈ 1 MB per million parameters. All four are trained; each one that meets the acceptance thresholds is offered in the app.

| Model | License | Params | Approx. int8 size | Notes |
|-------|---------|--------|-------------------|-------|
| `distilbert-base-cased` | Apache 2.0 | ~65M | ~65 MB | Fast, well supported in Transformers.js |
| `microsoft/deberta-v3-xsmall` | MIT | ~70M | ~70 MB | Strong accuracy for its size |
| `bert-base-cased` | Apache 2.0 | ~110M | ~110 MB | Larger; balanced accuracy and speed |
| `answerdotai/ModernBERT-base` | Apache 2.0 | ~150M | ~150 MB | Largest; accuracy upper bound |

---

## Training directory layout

```
training/
├── README.md (setup and run commands)
├── .gitignore (data/, weights, caches)
├── .python-version (3.12, used by uv)
├── pyproject.toml (ruff and pytest settings only; no dependencies)
├── requirements.txt
├── configs/
│   ├── data.yaml (UD release tag, paths, window size)
│   ├── eval.yaml (calibration, export, parity, benchmark settings) (proposed)
│   ├── catalog.yaml (model library display names and descriptions; owner-editable)
│   ├── dictionary.yaml (pinned word-list and dictionary sources with SHA-256, licenses, attribution: NGSL (T41), Open English WordNet 2025, Wiktionary via kaikki.org with a pinned subset, Tatoeba (T70))
│   └── train_<model>.yaml (hyperparameters per candidate; one file per model)
├── data/ (git-ignored: raw UD files, processed datasets, checkpoints, ONNX exports)
├── scripts/
│   ├── check_env.py (Phase 0 MPS and Unsloth check) (proposed)
│   ├── fetch_data.sh
│   ├── derive_chunks.py (UD trees → chunk tags)
│   ├── prepare_data.py (labels, windows, splits)
│   ├── train.py
│   ├── calibrate.py
│   ├── export_onnx.py
│   ├── evaluate.py
│   ├── metrics.py (word-level predictions; UPOS, chunk F1, UAS/LAS; shared by train.py and evaluate.py)
│   ├── run_smoke.sh, smoke_report.py (Phase 7 task 0)
│   └── package_models.py (Phase 11: public/models/<model-id>/ and catalog.json)
├── dictionary/ (dictionary build pipeline, not a model phase; owner T42, built T70: fetch.py (pinned downloads), extract.py (Wiktionary subset), sources.py, build.py (headwords, entries, inflection index, shards, manifest, report), DATA_CARD.md)
├── js/
│   ├── package.json (scripts: align, test)
│   ├── align_tokens.mjs (runtime words vs UD words; Phase 3)
│   ├── lib/ (conllu.mjs, align.mjs: Phase 3; baselines.mjs, metrics.mjs: Phase 5; inference.mjs: word encoding and argmax, Phases 7–10; nested.mjs, errors.mjs: Phase 7)
│   ├── tests/ (node:test unit tests, e.g. align.test.mjs)
│   ├── evaluate_baselines.mjs (wink-nlp POS, compromise)
│   ├── benchmark.mjs (Transformers.js speed and parity)
│   ├── nested_eval.mjs (nested-phrase F1 via treeDecoder.ts; Phase 7)
│   ├── error_analysis.mjs (reports/errors.md; Phase 7 task 5)
│   ├── bench_browsers.mjs, bench_report.mjs (Phase 10 driver and report; T67 serve mode)
│   ├── build_known_words.mjs (NGSL → src/modules/subword/knownWords.generated.ts; npm run known-words; T41)
│   └── bench-page/ (Vite page for Phase 10 and the T31 spike: index.html, bench.mjs, vite.config.mjs, vm-sampler.ps1)
├── tests/ (pytest for derive_chunks and prepare_data; conftest.py)
├── reports/ (metrics, error samples, benchmark results; README.md index)
└── MODEL_CARD.md
```


**Dictionary pipeline (owner, 2026-11-21; T42).** The app's dictionary data is built here too, separate from the model phases: Python in `training/dictionary/` reads pinned sources (Open English WordNet, Wiktionary extracts from kaikki.org, Tatoeba EN–KO, NGSL; T25), and a `training/js` step runs the app's `winkBackend` lemmatizer and `lookupKey` (via `tsx`, like `align_tokens.mjs`) so headwords and the inflection index match runtime words. Output: index + hash-sharded entry JSON + manifest (sizes, SHA-256, sources, licenses), uploaded to R2. Raw sources stay in git-ignored `data/`. Build task: T70 (`todo.md`).

**Dictionary build (T70; owner decisions 2026-11-23).** `python -m dictionary.fetch --pin` → `python -m dictionary.extract` (once) → `python -m dictionary.build` writes `data/dict/v1/` and `reports/dictionary.md`. kaikki.org serves only its latest extract, so the build reads a pinned, byte-reproducible subset (`wiktionary.subset`). Headwords: NGSL ∪ UD EWT lemmas with an entry (lower case or capitalized, e.g. *I*, *American*), filled to 15,000 single words with WordNet words that have a Korean translation in Wiktionary (most widely translated first), plus phrasal verbs of headword verbs. Entries per part of speech: WordNet senses (Wiktionary definitions only for parts of speech WordNet lacks, or for words whose only Wiktionary entries are forms of another word, e.g. *me*), Korean translations under Wiktionary's sense labels (not matched to WordNet senses), up to three Tatoeba pairs. Inflection index: Wiktionary forms of the parts of speech WordNet confirms, WordNet irregular forms, NGSL form lists, and corpus words whose wink lemma is a headword. Shards: FNV-1a 32 of the UTF-8 `lookupKey` mod 128. The combined data is CC BY-SA 4.0. v1 results: `reports/dictionary.md` (16,659 headwords; 99.1% of EWT test words resolve). Format and attribution: `dictionary/DATA_CARD.md`.

---

## Phases

Each phase lists tasks, deliverables, and an exit criterion. Do not start a phase until the previous exit criterion is met.

### Phase pre-0 — Pre-flight check

Pre-flight review run on 2026-11-17 against the training machine and the repository. Everything below must be done before Phase 0 starts, except items in *Gates for later phases*, which must be done before the phase named.

**Machine check (2026-11-17)**

| Item | Required | Found | Status |
|------|----------|-------|--------|
| Hardware | M5 Pro, 48 GB | Apple M5 Pro, 48 GB, macOS 27.0.1 | Ready |
| Free disk | ~20 GB | ~595 GB | Ready |
| Xcode CLT | Installed | `/Library/Developer/CommandLineTools` | Ready |
| `uv` | Installed | 0.13.5 | Ready |
| Python 3.12 | Installed via `uv` | 3.12.15 (uv-managed); pinned by `training/.python-version` (global pyenv default stays 3.15.2) | Ready |
| Node.js | 20+ | 26.13.1, npm 11.20.0 | Ready |
| git-lfs | Installed and active | 3.8.1; LFS filter configured; `.gitattributes` patterns tracked; repo hooks installed (checked 2026-11-18) | Ready |
| Repository scaffold | `training/` layout | Created; all files are headers only | Ready |

**Tasks**
1. Install git-lfs and run `git lfs install` inside the repository so the LFS hooks are added; confirm `git lfs track` lists the patterns in `.gitattributes`. *Status: done.*
2. Install Python 3.12 with `uv python install 3.12`. Pin it for `training/` with `training/.python-version`. *Status: done.*
3. Add `training/pyproject.toml` with `ruff` and `pytest` settings only; dependencies stay in `requirements.txt`. *Status: done.*
4. Confirm Unsloth support (open risk): check Unsloth's current docs for Apple Silicon (MPS) and encoder token-classification support. If neither is supported, plan for `Trainer` and keep Unsloth only as a Phase 0 check. *Status: done, will use Huggingface Trainer.*
5. Owner: confirm the gate schedule below. *Status: done.*

**Gates for later phases**

| Needed before | Item | Owner of decision | Tracked in |
|---------------|------|-------------------|------------|
| Phase 1 exit | CC BY-SA 4.0 position for derived data and trained weights (legal advice before commercial release); GUM decision | Owner | Done: Phase 1 *Outcome* |
| Phase 3 | `src/modules/parser/winkBackend.ts` tokenization and `src/modules/input/textInput.ts` preprocessing implemented (alignment runs them via `tsx`); root `package.json` pins the same `wink-nlp` and `@huggingface/transformers` versions as `training/js/` | Dev | Done 2026-11-18 (Phase 3 *Pre-flight check 2*) |
| Phase 7 | `src/modules/parser/treeDecoder.ts` implemented (nested-phrase F1 runs it via `tsx`) | Dev | Done 2026-11-18 |
| Phase 7 exit | Acceptance thresholds; they decide which models are offered | Owner | Done: UPOS ≥ 97%, chunk F1 ≥ 94% (2026-11-18); nested-view targets (2026-11-19, *Nested phrase structure*) |
| Phase 10 | Vite tooling set up in the app (bench page uses the same Vite version) | Dev | Done 2026-11-18: Vite 8.3.8 in root and `training/js` |
| Phase 10 exit | Pre-flight policies (memory, storage, multi-threaded WASM) | Owner | `todo.md` → `[Modules/preflight]` |
| Phase 4 exit | `LabelConfig` in `src/modules/parser/types.ts` matches `labels.json` schema v1 | Dev | Done 2026-11-18 (Phase 4 *Outcome*) |
| Phase 11 | Hosting and storage limits for several models (file size, LFS quota) | Owner | `todo.md` → `[Project]` deployment and hosting |
| Phase 11 | Where the app shows attribution; `transformerBackend.ts` implemented for the integration test; `ParseResult` carries model version and wink word offsets | Owner, dev | `todo.md` → `[UI]` attribution display; `architecture.md` → *Model* |

**Deliverables:** git-lfs active; Python 3.12 pinned for `training/`; Python tool config; Unsloth support note; confirmed gate schedule.
**Exit criterion:** every row in *Machine check* is Ready, tasks 1–4 are done, and the owner has confirmed the gate schedule.

### Phase 0 — Environment setup and tooling check

**Tasks**
1. Confirm Phase pre-0 is complete.
2. Create a `uv` virtual environment with Python 3.12 in `training/.venv`; install and pin `requirements.txt`. Install and pin `training/js/package.json` with npm (lockfile committed).
3. Confirm PyTorch sees MPS: `torch.backends.mps.is_available()` returns `True` (`scripts/check_env.py`).
4. **Unsloth check:** load `distilbert-base-cased` as a token-classification model through Unsloth on MPS and run 50 training steps on dummy labels.
   - Pass → use Unsloth for all training.
   - Fail (unsupported architecture, task, or device) → use Hugging Face `Trainer` directly. Note the outcome in this document.
5. Check Unsloth with `deberta-v3-xsmall`, `bert-base-cased`, and `ModernBERT-base` the same way.

**Deliverables:** pinned `requirements.txt` and `training/js` lockfile; a note in this document on which framework is used per model.
**Exit criterion:** a dummy training run completes on MPS for every candidate model.

**Outcome (2026-11-18): exit criterion met.**

- Environment: Python 3.12.15, torch 2.15.0 (MPS available), transformers 4.57.6. Full pin list in `requirements.txt`; `training/js/package-lock.json` committed.
- `scripts/check_env.py`: 50 steps, batch 8, 10 dummy labels, length 256, fp32, no `PYTORCH_ENABLE_MPS_FALLBACK` (settings in `configs/eval.yaml` → `env_check`).
- Unsloth 2026.11.6 (throwaway venv): on macOS, `FastModel.from_pretrained` goes to the MLX backend, not PyTorch MPS, and failed for every model. Its dependency `unsloth-zoo` is LGPL-3.0-or-later, which the dependency policy does not allow. Unsloth is not in `requirements.txt`.

| Model | Framework | Dummy run (HF `Trainer`, MPS) |
|-------|-----------|-------------------------------|
| `distilbert-base-cased` | `hf_trainer` | Pass, 7.2 s |
| `microsoft/deberta-v3-xsmall` | `hf_trainer` | Pass, 13.2 s |
| `bert-base-cased` | `hf_trainer` | Pass, 15.6 s |
| `answerdotai/ModernBERT-base` | `hf_trainer` | Pass, 21.2 s |

- Notes for later phases:
  - DeBERTa-v3: the fast-tokenizer conversion warns that byte fallback is not supported. Check unknown-token rates in Phase 3 and parity in Phase 9.
  - `training/js` versions were picked here (`wink-nlp` 2.4.0, `@huggingface/transformers` 4.3.2). The root `package.json` must use the same versions (Phase 3 gate).
  - Some npm dev dependencies are not under a permissive license: `sharp-libvips` (LGPL-3.0, via Transformers.js, Node image support) and `lightningcss` (MPL-2.0, via Vite). They are not shipped. Accepted by owner (2026-11-18): weak-copyleft transitive dependencies that are never shipped in the app bundle are allowed (`agents.md` → *Dependency policy*).
  - npm 11 blocked install scripts (`onnxruntime-node`, `esbuild`, `protobufjs`). All packages still load in Node without them.
  - `js-yaml` 5 has no default export. Use `import * as yaml from "js-yaml"`.

### Phase 1 — Data acquisition and licensing

**Tasks**
1. `fetch_data.sh`: clone UD English EWT at a pinned release tag into `training/data/raw/`.
2. Record the release tag, commit hash, and file checksums in `configs/data.yaml`.
3. Review CC BY-SA 4.0 obligations:
   - Attribution text required in the app and in `MODEL_CARD.md`.
   - Whether share-alike applies to the derived chunk dataset (likely yes) and to trained weights (unsettled; get legal advice before commercial release).
4. Decide on GUM: check each subcorpus license; include only compatible ones.

**Deliverables:** raw data with pinned versions; a license summary in `MODEL_CARD.md`.
**Exit criterion:** license position recorded and accepted by the project owner.

**Outcome (2026-11-18): exit criterion met (owner accepted the license position and GUM exclusion).**

- `fetch_data.sh` implemented: reads `configs/data.yaml`, shallow-clones the tag, verifies commit and SHA-256 (idempotent; exit 2 if values are unpinned).
- UD English EWT pinned at `r2.19` (latest UD release), commit `6b021622f3ab7902730f313fa5955a8b8cdd52b8`. Checksums for train/dev/test and `LICENSE.txt` in `data.yaml`.
- Size: train 12,544 / dev 2,001 / test 2,077 sentences; 204,578 / 25,148 / 25,094 words.
- License summary and attribution text in `MODEL_CARD.md`. Position (owner-accepted):
  - Raw and derived data are not redistributed (git-ignored).
  - Trained weights are treated as CC BY-SA 4.0 derived material and shipped under CC BY-SA 4.0 with attribution. Legal advice before commercial release.
- GUM: excluded (owner decision). The UD r2.19 release is CC BY-NC-SA 4.0 as a whole (per-text sources vary: wikiHow and fiction are BY-NC-SA). `gum.enabled: false`.

### Phase 2 — Chunk derivation from UD trees

UD has dependency trees, not chunks. `derive_chunks.py` converts them to flat, non-recursive chunks in the style of the CoNLL-2000 standard.

**Rules (initial)**

| Chunk | Head | Includes | Excludes |
|-------|------|----------|----------|
| NP | `NOUN`, `PROPN`, `PRON`, `NUM` (nominal use) | Left dependents: `det`, `amod`, `nummod`, `compound`, `nmod:poss`, `flat`, `fixed` | Post-modifiers (PPs, relative clauses); these form their own chunks |
| VP | `VERB`, `AUX` (as predicate) | `aux`, `aux:pass`, `cop`, negation `advmod` (*not*) and `compound:prt` (phrasal-verb particle) if contiguous | Objects and complements |
| PP | `ADP` with `case` relation | Multiword prepositions (`fixed`, e.g. *because of*) | The NP that follows (separate chunk) |
| ADJP | `ADJ` not inside an NP | Left `advmod` (*very* happy) | — |
| ADVP | `ADV` not absorbed by VP or ADJP | Left `advmod` | — |
| O | Punctuation, conjunctions, other | — | — |

- Chunks must be contiguous; a non-contiguous span is split at the gap.
- Output BIO tags: `B-NP`, `I-NP`, …, `O`.

**Rule details (added during the Phase 2 review; owner-accepted 2026-11-18)**

| Area | Detail |
|------|--------|
| NP heads | Also: DET used as a pronoun (`all`, `some`); ADJ with `det`/`nmod:poss`/`case` dependent or as subject/object (`the same`, `Most of them`); VERB with `det` (`the following`); SYM with nominal dependents or role (`$ 5`, `50 %`). |
| NP members | Possessor's own left modifiers and `'s` (`my brother 's friend`); right-adjacent `nummod` (`$ 5`); adjacent `nmod:unmarked` (dates and times: `October 4th`, `05:09 PM`); `nmod:desc` right before the head (`President Putin`); left `advmod` of a NUM head (`more than 200`); `else` after a pronoun; adverbs between pre-modifiers (`a largely Sunni clan`). |
| NP coordination | Coordinated pre-modifiers stay in one NP with their `cc` (`red and blue cars`, `any and all info`). Coordinated heads are separate NPs (`[NP cats] and [NP dogs]`). |
| VP | Infinitive `to` joins the VP (`[VP to go]`). Adverbs strictly inside the verb group join it (`has always been`). Verb chains are separate VPs (`[VP want] [VP to go]`). A verb-group piece without a verb, auxiliary, or `to` (stranded particle or `not`) becomes ADVP (`picked it [ADVP up]`). `advmod` particles annotated as ADV (EWT `moving in`) are ADVP. |
| Copula | `cop`, `aux`, `to`, and `not` of a non-verbal predicate form a VP; the predicate keeps its own chunk (`[VP is not] [NP a teacher]`). |
| PP | Adjacent `case` words of one head form one PP (`out of`). A `mark` with a preposition lemma (`of`, `by`, `in`, `on`, `with`, `without`, `about`, `from`, `into`, `at`, `upon`, `through`) on a VERB is PP (`[PP by] [VP giving]`). Possessive `'s` and SYM `case` (`5 - 10`) are not PP. |
| ADJP/ADVP | Left `advmod`/`amod`/`det` join only if the gap is filled by their own subtree or the chunk (`so close together`, `the sooner`). `at least`, `at most` are one ADVP. |
| O | `cc` and `cc:preconj` with their `fixed` parts (`as well as`); subordinators (`because`, `that`, `if`); interjections; punctuation. |
| Punctuation | `-`, `–`, `/`, `,`, `+`, and quotes join a chunk only when they sit between two of its words and their head is in it (`a well - known author`). Brackets and sentence punctuation never join. |
| Not handled | Number ranges (`3 to 4 days`), addresses, place names with commas, `mark` on ADJ predicates (`on how agreeable`). See `reports/chunk_review.md`. |

**Tasks**
1. Implement `derive_chunks.py` with the rules above.
2. Unit tests (`tests/`) for ~30 hand-written sentences covering each rule and edge cases (coordination, possessives, phrasal verbs, passives, questions).
3. Manual review: sample 200 dev sentences; mark errors; fix rules; repeat until the error rate is < 2% of chunks.
4. Report chunk-type distribution per split in `reports/chunks.md`.

**Deliverables:** `derive_chunks.py`, tests, review log.
**Exit criterion:** tests pass; manual review error rate < 2%.

- Nested structure: the chunked files are full CoNLL-U, so `HEAD` and `DEPREL` are kept for group B. Phase 2 needs no rework.

**Outcome (2026-11-18): exit criterion met (owner accepted the rule details and the agent-run review).**

- `derive_chunks.py` writes `data/processed/chunked/*.conllu`: the raw EWT files with `Chunk=<BIO tag>` added to MISC of each word line. Comments and multiword-token lines are unchanged (checked: removing `Chunk=` restores the raw files exactly).
- Tests: 48 pass (`tests/test_derive_chunks.py`: 39 hand-written sentences covering every rule, plus multiword tokens, file annotation, and BIO validation).
- Review: 200 dev sentences (seed 13), two rounds. Round 1 ~2.5% errors; round 2 **0.36%** (5 of 1,375 chunks). Reviewer: Claude Opus 5.5. Log: `reports/chunk_review.md`.
- Distribution (`reports/chunks.md`): train 111,872 chunks — NP 50.7%, VP 24.2%, PP 15.3%, ADVP 6.5%, ADJP 3.2%.
- The review sample contains corpus text, so it stays in git-ignored `data/processed/review/`.

### Phase 3 — Tokenization alignment with runtime

At runtime, wink-nlp splits text into words before the model runs. Training words must match.

**Decisions (owner, 2026-11-18)**

| Topic | Decision |
|-------|----------|
| One implementation | `align_tokens.mjs` runs the app's `preprocess()` (`src/modules/input`) and `tokenize()` (`src/modules/parser/winkBackend.ts`) through `tsx`. No copied settings. |
| Contractions | Always separate words: `'m`, `'s`, `'re`, `'ve`, `'ll`, `'d`, `n't` (`I'm` → `I` + `'m`). Done in `winkBackend.ts`, because wink is inconsistent (`it's` split, `I'm` not). |
| Hyphenated words | Always one word (`well-known`, `F-16-launched`), even where wink or UD splits them. |
| URLs and e-mail addresses | One word; a sentence never ends inside one (`www.juancole.com`, `Warner@ENRON`). Trailing sentence punctuation stays separate. |
| Symbol runs | A run of one repeated symbol is one word (`***`, `---------`, `.........`). |
| Labels for merged words | A wink word covering several UD words takes the UPOS, chunk type, head, and relation of the span's head word (the UD word whose head lies outside the span). Its chunk tag is `B-` if the span starts a chunk, else `I-`. |
| Changed sentences | Sentences where `preprocess()` removes text (non-Latin, emoji, control) are dropped from training. |
| Sentence boundaries | Training keeps UD sentence boundaries. At runtime, trees are built per wink sentence; a head outside the sentence attaches to the sentence root (`treeDecoder.ts`). Effect measured in Phase 7. |
| Main piece of a split (dev detail) | The first piece with a letter or digit keeps the labels (`'Akkab` → `Akkab`); if none, the first piece. Other pieces: `goeswith`, UPOS `X` (`PUNCT` if no letter or digit), same chunk. |
| Chunk prefixes (dev detail) | From chunk identity: a runtime word gets `B-` when its chunk (its head word's UD chunk) differs from the previous runtime word's, else `I-`. Merges never join two UD chunks (`I'ma sophomore` → `[NP I'ma] [NP sophomore]`). |
| Agreement metric | On **each** split (train, dev, test), ≥ 99.5% of counted UD words map to exactly one runtime word. Not counted (by design, still covered by merge rules): UD words merged by the hyphen rule, and UD words inside one written token (no space, no apostrophe) that the runtime keeps whole (`others`, `5pm`, `2/3`, `in.`). Every other mismatch is covered by a documented merge or split rule. |

**Tasks**
1. `align_tokens.mjs`: for each EWT sentence, run `preprocess()` on the raw text (`# text =`), drop it if anything was removed, and `tokenize()` the clean text. Normalize UD word forms with `normalizeChars()` and locate them in the clean text.
2. Handle UD multiword tokens (e.g., *don't* → *do* + *n't*): use the form that matches the runtime split.
3. Measure word-level agreement (metric above). For mismatches, add mapping rules (merge or split) and apply the label-transfer decision.
4. Store the final word segmentation in the processed dataset, so training uses wink-style words. Each word keeps its character offsets (`start`, `end`) into the sentence text, the same offsets wink gives at runtime.
5. **Remap dependency heads** onto wink words (group B):
   - Merge (several UD words → one wink word): the merged word takes the head and relation of the UD word whose head lies outside the span. Arcs into the span point to the merged word.
   - Split (one UD word → several wink words): the first piece keeps the head and relation; other pieces attach to the first with relation `goeswith`.
   - Check that every remapped sentence is a valid tree (one root, no cycles). Projectivity is not required.

**Pre-flight check 1 (2026-11-18)**

Probe: wink-nlp 2.4.0 + wink-eng-lite-web-model 1.8.1 (`training/js`) on the raw `# text` of each EWT sentence, no preprocessing or mapping rules; a UD word counts as aligned if a wink token has exactly its character span.

| Item | Found | Status |
|------|-------|--------|
| `training/js` packages | Installed at pinned versions; wink loads in Node 26.13.1 | Ready |
| Chunked input (Phase 2) | `data/processed/chunked/*.conllu` present | Ready |
| Raw word agreement | dev 98.10% (24,669 / 25,148); train 98.61% (201,740 / 204,578). Target 99.5% needs mapping rules | Expected |
| Sentence split | wink splits 95 of 2,001 dev sentences (4.7%) and 488 of 12,544 train sentences into more than one sentence | Needs decision |
| `winkBackend.ts` tokenization (gate) | Header only | Blocked |
| Root `package.json` pins (gate) | Header only; no dependencies | Blocked |
| `input/textInput.ts` preprocessor | Header only. Runtime text is normalized (NFKC, curly quotes → ASCII, emoji and non-Latin removed) before wink, so alignment must use the same normalization. 79 train sentences have curly quotes, 97 have non-ASCII text | Blocked |
| App test tooling | Undecided (`plan.md` → *Tooling*); `winkBackend.test.ts` needs it | Needs decision |
| `configs/data.yaml` → `paths.aligned` | Planned, not set | Set in Phase 3 |

Mismatch types on train (raw), for the mapping rules:

| Type | Count | Examples |
|------|-------|----------|
| wink keeps a token UD splits (no apostrophe) | 637 | `others` (UD: `other` + `s`), `its` (= *it's*), `cockerspaniel` |
| wink keeps a contraction UD splits | 478 | `I'm`, `Here's`; `Kerry’s` (curly apostrophe; fixed by preprocessing) |
| wink splits URLs, e-mail addresses, abbreviations | 399 | `www.juancole.com` → `www . juancole . com`; `Rev.` → `Rev .` |
| wink splits symbol runs | 394 | `***`, `====…`, `’’` |
| wink keeps hyphenated words UD splits | 351 | `AK-47`, `F-16-launched` |
| wink keeps word + punctuation | 322 | `in.`, `2/3` |
| wink splits hyphenated words UD keeps | 97 | `socio-political`, `Get-A-Free-House.com` |
| Other splits (apostrophes, numbers with units) | 159 | `'72`, `50's`, `86M` |

Merges can join words from different chunks (`I'm` = NP + VP), so label transfer needs a rule. wink is inconsistent with contractions (`it's` is split, `I'm` is not).

**Pre-flight check 2 (2026-11-18, after the decisions above)**

Probe: the app's own `preprocess()` + `tokenize()` (run from `training/js` via `tsx`) on EWT, UD forms normalized with `normalizeChars()`.

| Item | Found | Status |
|------|-------|--------|
| Root `package.json` | wink-nlp 2.4.0, wink-eng-lite-web-model 1.8.1, @huggingface/transformers 4.3.2 (runtime); typescript 7.0.2, vite 8.3.8, vitest 5.1.0 (dev); same pins as `training/js` | Ready |
| `input/textInput.ts` | Implemented; 11 Vitest tests pass | Ready |
| `winkBackend.ts` tokenization | Implemented (sentences, words, offsets, word rules); 11 Vitest tests pass; `npm run typecheck` clean | Ready |
| App code from `training/js` | `tsx` runs `src/` modules and resolves wink from the root `node_modules` | Ready |
| Sentences dropped by `preprocess()` | dev 1 / 2,001; train 1 / 12,544 | Ready |
| Contraction mismatches | Gone (were 478 on train) | Ready |
| URL, e-mail, symbol-run rules | Implemented; 4 more Vitest tests (26 total) | Ready |
| Agreement (metric above) | **dev 99.59%, train 99.77%, test 99.61%** (all words, nothing excluded: dev 97.76%, train 98.24%, test 97.86%) | **Met** |
| wink sentence split | Splits 50 dev / 306 train / 55 test UD sentences (was 95 / 489 before the URL rule) | Handled by decision |

Mismatches on train (UD words), final word rules:

| Type | Count | Examples | Handled by |
|------|-------|----------|------------|
| Hyphenated word kept whole | 2,171 | `15-year`, `Al-Zaman` | Merge rule (not counted) |
| UD splits inside one written token | 962 | `others` (UD `other` + `s`), `5pm`, `2/3`, `in.` | Merge rule (not counted) |
| Runtime splits a UD word (apostrophes, mixed symbols, file names) | 419 | `'72`, `50's`, `?!?!?`, `UnleadedStocks.pdf` | Split rule |
| Other merges across a space-free boundary with apostrophes | 38 | `Q1'02`, `I'ma` | Merge rule |

Known weakness (no rule; for Phase 7 error analysis): wink treats some sentence-final words as abbreviations and keeps the period (`in.`, `No.`, `s.`); 102 train sentences end in a glued period, mostly real abbreviations (`etc.`, `p.m.`, `Inc.`).

**Phase 3 can start:** gates met; decisions recorded; agreement target met with the final word rules (the remaining Phase 3 work is the alignment script, mapping rules, head remapping, and `reports/alignment.md`).

**Deliverables:** alignment script, mismatch report (`reports/alignment.md`), mapping rules for labels and heads.
**Exit criterion:** agreement metric (*Decisions*) ≥ 99.5% on each split; remaining mismatches documented; every remapped sentence is a valid tree.

**Outcome (2026-11-18): exit criterion met.**

- `js/align_tokens.mjs` (`npm run align` in `training/js`, ~2 s) writes `data/processed/aligned/{train,dev,test}.jsonl`: one record per UD sentence with `doc_id`, `sent_id`, clean `text`, and runtime words (`form`, `start`, `end`, `upos`, `chunk`, `head`, `deprel`, `reviewed`, `wink_sent`, `ud`, `rule`). Every word's offsets slice back to its form; every chunk sequence is valid BIO.
- Agreement: **train 99.76%, dev 99.56%, test 99.56%** (all-word agreement 98.24% / 97.75% / 97.86%). Full counts and examples: `reports/alignment.md`.
- Trees: every written sentence is a valid tree (0 invalid, 0 alignment errors). Head remapping: 310 train merges had more than one outside arc (mostly `in.`, `its`); only the head word's arc is kept.
- Dropped: 1 sentence per split (preprocessing removed text).
- Runtime sentence split: 306 train UD sentences span more than one wink sentence; 719 train arcs cross wink sentences (attach to the sentence root at runtime; Phase 7 measures it).
- Tests: 16 `node:test` tests for `js/lib/` (`npm test` in `training/js`).


### Phase 4 — Dataset building

**Tasks**
1. `prepare_data.py`: combine UPOS and chunk tags into `UPOS|CHUNK` labels (group A); build the label map; drop label combinations seen < 5 times in train and map them to the nearest valid label.
   - Group B: encode each word's head and base relation as `<offset>@<head UPOS>|<relation>` (see *Nested phrase structure*). Labels seen < 5 times in train are merged the same way. Report how many training heads cannot be encoded after merging; target < 0.5% of words.
2. Build windows: consecutive sentences from the same document (`# newdoc id`) packed up to 256 subword tokens (same window size as the runtime), with sentence boundaries kept. Long single sentences are split at 256 with 32-token overlap.
3. Subword alignment: label the first subword of each word; set the rest to `-100`.
4. **Partial labels:** each input word has a `reviewed` flag (`true` for all EWT words).
   - Unreviewed words get `-100` on every subword, in both label groups; they still appear in the input as context.
   - Label counts (task 1) use reviewed words only. Windows with no reviewed word are dropped.
   - Chunk F1 is computed only on sentences where every word is reviewed; UPOS accuracy uses all reviewed words.
   - Unit tests in `tests/test_prepare_data.py` cover fully, partly, and un-reviewed windows.
5. Keep the official EWT train/dev/test splits. Test is used only in Phase 7 final evaluation.
6. Optional augmentation (train split only, ≤ 15% of windows): lowercase sentence starts, drop final punctuation, common learner typos. Evaluate the effect in Phase 7; keep only if dev F1 does not drop. Owner (2026-11-20): the first two run as an experiment in the biaffine retrain; learner typos are out of v1.
7. Save processed datasets with `datasets` to `training/data/processed/`.
8. Write `labels.json` following the schema below (schema version 1).

**`labels.json` schema (version 1)**

Single contract between training and the app. Later phases fill their fields; they do not add or rename fields.

| Field | Type | Written by (phase) | Meaning |
|-------|------|--------------------|---------|
| `schema_version` | int | `prepare_data.py` (4) | `1`. Bumped on any breaking change (rename, removal, type change). |
| `labels` | string[] | `prepare_data.py` (4) | Group A labels (`UPOS\|CHUNK`), then group B labels (`<offset>@<UPOS>\|<relation>`); array index = class id. Must equal the model's `config.json` `id2label` order. |
| `groups` | object | `prepare_data.py` (4) | Slice of `labels` and logits per group: `{"chunk": {"start": 0, "end": nA}, "dep": {"start": nA, "end": nA+nB}}`. Softmax is applied per slice. |
| `dep_encoding` | string | `prepare_data.py` (4) | Head encoding id, `rel_pos_v1` (see *Nested phrase structure*). |
| `tokenizer_input` | string | `prepare_data.py` (4) | `pre_split_words`: the runtime words are fed to the tokenizer as a pre-split list, so each word is tokenized as if preceded by a space (`I'm` → `I` `'m`). The app must do the same. |
| `upos` | string[] | `prepare_data.py` (4) | The 17 UPOS tags, fixed order (for marginalizing). |
| `chunk_tags` | string[] | `prepare_data.py` (4) | `B-`/`I-` × NP, VP, PP, ADJP, ADVP, plus `O`. |
| `label_merges` | object | `prepare_data.py` (4) | Rare combinations mapped to their replacement (`from` → `to`). Informational; the app ignores it. |
| `window.max_subword_tokens` | int | `prepare_data.py` (4) | `256`; the app uses it for runtime windows. |
| `window.max_subwords_per_word` | int | `prepare_data.py` (4) | `16`; a word keeps only its first 16 subword tokens (long URLs, symbol runs). The app must do the same. |
| `versions.base_model` | string | `prepare_data.py` (4) | Hugging Face id of the base model (tokenizer source). |
| `versions.data` | object | `prepare_data.py` (4) | UD release tag and commit; list of feedback batch ids (empty until Phase 12). |
| `versions.wink` | object | `prepare_data.py` (4) | `wink-nlp` and `wink-eng-lite-web-model` versions from `training/js/package-lock.json`. The app warns if its versions differ. |
| `calibration.temperature` | number \| null | `calibrate.py` (8) | Softmax temperature for group A. |
| `calibration.dep_temperature` | number \| null | `calibrate.py` (8) | Softmax temperature for group B. |
| `ambiguity.margin` | number \| null | `calibrate.py` (8) | Top-two probability margin for alternatives. |
| `ambiguity.attachment_margin` | number \| null | `calibrate.py` (8) | Top-two head-label margin for attachment alternatives. |
| `model_version` | string \| null | `export_onnx.py` (11) | Semantic version matching the release tag (e.g., `1.0.0`). |
| `files` | object \| null | `export_onnx.py` (11) | Shipped model files (path relative to the model folder → `{bytes, sha256}`), excluding `labels.json`. Used by the app's pre-flight integrity check (`architecture.md` → *Pre-flight checks*). |

- Fields are `null` until their phase writes them. The app throws `ParserLoadError` if a field it needs is `null`.
- Adding an optional field does not change `schema_version`; anything else does.
- `src/modules/parser/types.ts` → `LabelConfig` mirrors this table (Phase 4 exit gate).

**`labels.json` schema (version 2, biaffine head; T33, 2026-11-20).** Written by `prepare_data.py --encoding arc` to `data/processed/dataset_arc/<model>/` (the v1 datasets stay for the Phase 7 base and extended runs). The app understands only v2 (`LABEL_SCHEMA_VERSION = 2`; `LabelConfig` mirrors it). Fields as in v1, except:

| Field | Type | Written by (phase) | Meaning |
|-------|------|--------------------|---------|
| `groups` | object | `prepare_data.py` (4) | `chunk` (group A, `UPOS\|CHUNK`) and `rel` (group B, relation) slices of `logits`. |
| `labels` (group B part) | string[] | `prepare_data.py` (4) | UD relations: base relation, or one of `relation_subtypes`; includes `root`. 45 relations from EWT train (≥ 5 words). |
| `dep_encoding` | string | `prepare_data.py` (4) | `biaffine_v1`: heads come from `arc_scores`, decoded with MST (`treeDecoder.ts`). |
| `arc` | object | `prepare_data.py` (4) | `{output: "arc_scores", root_position: 0, scope: "sentence"}`: second ONNX output `[batch, T, T]`; token 0 (first special token) is the root; heads are read only within the word's sentence. |
| `relation_subtypes` | string[] | `prepare_data.py` (4) | The ten kept subtypes (`configs/data.yaml` → `labels.relation_subtypes`; T03). |
| `tokenizer_word_encoding` | `"plain"` \| `"space"` \| null | Phase 9/11 | Per-model word encoding for Transformers.js (was a planned optional v1 field). |
| `window.long_sentence_overlap` | int | `prepare_data.py` (4) | `32`; context tokens repeated when one sentence is longer than a window (runtime must match). |
| `calibration` | object | `calibrate.py` (8) | `temperature` (group A), `rel_temperature`, `arc_temperature` (replaces `dep_temperature`). |
| `ambiguity.attachment_margin` | number \| null | `calibrate.py` (8) | Top-two head-probability margin for PP-attachment alternatives. |
| `nested.bracket_threshold` | number \| null | `calibrate.py` (8) | Span-confidence threshold for gating (`treeDecoder.ts` → `spanConfidence`, `phraseLabeler.ts` → `gateLabeled`). |
| `nested.role_threshold` | number \| null | `calibrate.py` (8) | Role-confidence threshold (relation × head probability of the role's head word; `phraseLabeler.ts` role gate; T59, added 2026-11-21). |

- Dataset columns (v2): `labels_chunk`, `labels_rel` (group-local ids), `labels_head` (token position of the head's first subword; `0` = root; `-100` = ignored), `token_sent` (sentence index at first subwords, `-1` elsewhere), plus the v1 word-level fields. Check (2026-11-20): all 253,269 train/dev/test words map to their gold head token and relation for every model; 3 train words have a relation seen < 5 times and no kept base (`-100`).
- `validate_labels_json` dispatches on `schema_version` (1 or 2); `tests/test_biaffine.py` covers v2. The pre-flight ↔ parser schema-version parity test is written with the pre-flight module (T36); its header names `SUPPORTED_SCHEMA_VERSION = 2`.

**Deliverables:** processed datasets, `labels.json` (schema v1, Phase 4 fields filled), dataset statistics report.
**Exit criterion:** dataset loads; label and window statistics reviewed; `labels.json` validates against schema v1, and `LabelConfig` matches it.

**Outcome (2026-11-18): exit criterion met.**

- `scripts/prepare_data.py` (~15 s for all four candidates) writes `data/processed/dataset/<model>/`: a `DatasetDict` (`train`, `dev`, `test`) plus that model's `labels.json`. Windows depend on the tokenizer, so there is one dataset per candidate (Phase 6 compares them). Columns: `input_ids`, `attention_mask`, `labels_chunk` and `labels_dep` (group-local class ids, `-100` = ignored), `token_word`, and word-level gold fields (`words`, `word_sent`, `word_index`, `word_context`, `word_reviewed`, `gold_upos`, `gold_chunk`, `gold_head`, `gold_deprel`) for evaluation.
- Labels (train, reviewed words): group A 78 of 94 labels kept (99.985% of words); group B 632 of 1,202 kept (99.50%). 772 words (0.38%) keep their head with a changed relation; **242 words (0.119%) cannot be encoded** (target < 0.5%) and get `-100` in group B. 710 classes in total. Details: `reports/dataset.md`.
- Windows: about 10 train sentences per window (mean 190 tokens, max 256 for every model); no sentence needed splitting.
- Checks: head encoding round-trips on all 203,271 train words; for every labeled word, group A matches gold except the 41 merged rare labels, and group B decodes to the gold head; `labels.json` validates for all four models; a TypeScript check confirms `LabelConfig` matches the generated files (keys both ways, types).
- Tests: 25 new pytest tests (`tests/test_prepare_data.py`); 73 in total.
- Dev details (no owner decision needed):
  - Rare group A labels map to the most frequent kept label with the same chunk tag.
  - Rare group B labels keep their head (relation changes) or are ignored.
  - A word keeps at most 16 subword tokens; the cap is in `labels.json` and the app must apply it.
  - Augmentation (`lowercase_sentence_start`, `drop_final_punct`) is implemented but disabled; Phase 7 decides. `learner_typos` needs a typo list (TODO).

### Phase 5 — Baseline evaluation

Sets the bar the model must beat.

**Tasks**
1. `evaluate_baselines.mjs`: run wink-nlp (POS tags) and compromise (POS tags and chunks) on the EWT dev and test splits using the Phase 3 word segmentation. There is no rule-based chunker for wink-nlp (no fallback mode; owner decision 2026-11-18).
2. Map each baseline's tags to UPOS (both) and chunk tags (compromise); report UPOS accuracy for both and chunk F1 (overall and per type) for compromise.
3. No baseline exists for the structure output (wink-nlp and compromise have no dependency parser); record it as not applicable.

**Deliverables:** `reports/baselines.md`.
**Exit criterion:** baseline numbers recorded.

**Outcome (2026-11-18): exit criterion met.**

| Split | wink-nlp UPOS | compromise UPOS | compromise chunk F1 (P / R) |
|-------|---------------|-----------------|-----------------------------|
| dev | 88.93% | 83.07% | 69.48% (71.84% / 67.28%) |
| test | **88.76%** | 82.36% | **69.65%** (72.38% / 67.11%) |

- **Bar for Phase 7 (test):** UPOS > 88.76% (wink-nlp); chunk F1 > 69.65% (compromise). The acceptance thresholds (97% / 94%, confirmed by owner) are far above both.
- Method: `js/evaluate_baselines.mjs` (`npm run baselines`, ~2 s). Each library gets the runtime words joined by single spaces (same view as the model); tokens map back to words by offset, the last alphanumeric token deciding (`js/lib/baselines.mjs`). Feeding wink-nlp the original text instead gives the same score (88.88% vs 88.93% on dev).
- compromise mapping: punctuation by form; `Conjunction` → CCONJ / SCONJ by a closed coordinator list, `to` → PART; chunk boundaries from compromise's own chunks, prepositions as single-word PP. Its tag set lacks some UD distinctions (possessive pronouns, auxiliary `be`/`have`/`do`), and it has no ADVP chunk (ADVP F1 0%). No word-specific rules were added.
- wink-nlp's weakest tags on EWT web text: ADJ (70%), SCONJ (60%), INTJ (63%), NOUN/VERB (~84%); common errors NOUN/ADJ → PROPN (capitalized words).
- Structure output: no baseline (neither library parses dependencies).
- Tests: 10 new `node:test` tests (`js/tests/baselines.test.mjs`; 26 Node tests in total).

### Phase 6 — Base model selection (removed)

Removed by owner decision (2026-11-18). No single base model is chosen: every candidate is trained (Phase 7) and every one that meets the acceptance thresholds is offered in the app's model library, where the user chooses (`architecture.md` → *Model library*). The export and Transformers.js compatibility check that Phase 6 would have given early is now the Phase 7 smoke test. Phase numbers are kept so references stay valid.

### Phase 7 — Full training and tuning

Runs for every candidate (`configs/train_<model>.yaml`), unattended: `sh scripts/run_phase7_overnight.sh` starts `scripts/run_phase7.py` detached under `caffeinate` (resumable; progress in `data/logs/phase7_status.json`; report in `reports/training.md`). Per model: learning-rate sweep → λ sweep at the best rate → 3 seeds at both → dev and test evaluation of each seed (raw metrics, repaired-tree UAS/LAS, nested-phrase F1 via `treeDecoder.ts`). Compute estimate at batch 8 (DistilBERT ~27 s per epoch, others scaled by Phase 0 throughput): ≤ 8 runs × 15 epochs per model, ~7 h worst case for all four.

**Batch-size probe (2026-11-18, DistilBERT, dev, before the overnight run):** the first full run (batch 32, lr 2e-5) reached only UPOS 94.1 / chunk F1 88.7 / LAS 63.0 after 10 epochs. After 4 epochs: batch 16 (lr 5e-5) 94.9 / 91.3 / 69.3; batch 8 (5e-5) 95.7 / 93.3 / 74.9; batch 4 (5e-5) 96.2 / 94.1 / 77.7; batch 8 (1e-4) 96.5 / 94.4 / 79.1. Settings changed to batch 8, a higher learning-rate sweep, and up to 15 epochs (table above).

**Starting hyperparameters**

| Setting | Value |
|---------|-------|
| Learning rate | Sweep 3e-5, 5e-5, 1e-4, 2e-4 (was 2e-5 – 1e-4; shifted up after the batch-size probe) |
| Schedule | Linear decay, 10% warmup |
| Batch size | 8 windows (~80 sentences per update; was 32 windows ≈ 320 sentences, which gave only ~40 updates per epoch) |
| Epochs | Up to 15, early stopping on the dev selection score (patience 3) |
| Selection score | Mean of dev chunk F1 and LAS: early stopping, best checkpoint, learning rate, λ, and offered seed (confirmed by owner 2026-11-20; LAS improves more slowly than chunk F1, so stopping on chunk F1 alone under-trains the nested view) |
| Weight decay | 0.01 |
| Max sequence length | 256 subword tokens |
| Precision | fp32 on MPS (switch to bf16 only if stable and faster) |
| Seeds | 3 seeds for the final configuration; report mean and spread |
| Loss | Group A loss + λ × group B loss; λ swept (0.5, 1.0, 2.0) in the base run, then fixed per model (DeBERTa 2, others 1; confirmed by owner 2026-11-20) |

**Tasks**
0. **Smoke test** (before any full run; ~30 min for all four): for each candidate, `train.py --smoke` trains 1 epoch on a small train subset, exports fp32 / int8 / fp16 ONNX (`export_onnx.py`), loads the int8 export with Transformers.js in Node (`benchmark.mjs`, `tokenizer_input` and the per-word subword cap applied), and parses a fixed sentence: logits have the `labels.json` group sizes, labels decode, and the result matches PyTorch on that sentence. A candidate that fails is fixed or dropped before full training. Results in `reports/smoke_test.md`.
   - Run: `sh scripts/run_smoke.sh` (all four; or name models). Steps per model: `train.py --model <m> --smoke` → `export_onnx.py --model <m> --run smoke` → `js/benchmark.mjs --model <m> --run smoke --mode smoke`; then `scripts/smoke_report.py` writes the report. Settings: `configs/eval.yaml` → `smoke`, `export`, `parity`.
   - The benchmark also finds the word-encoding strategy that reproduces Python's token ids in Transformers.js (`plain` = encode each word; `space` = encode `" " + word`, needed by byte-level BPE such as ModernBERT). Transformers.js has no pre-split input option, so the app must use this strategy per model (Phase 11 task 1).
   - **Outcome (2026-11-18): passed for all four candidates** (`reports/smoke_test.md`). Every step ran: 1-epoch training (2–5 s on the subset), export of fp32 / int8 / fp16 (all pass `onnx.checker`), and the Transformers.js check in Node. fp32 matches PyTorch exactly on every dev word (5,093–5,475 words per model); fp16 matches on all confident words. Word encoding: `plain` for all four (ModernBERT's saved tokenizer adds the prefix space itself).

     | Model | int8 / fp16 size | int8 agreement on confident words (A / B) |
     |-------|------------------|-------------------------------------------|
     | distilbert_base_cased | 66 / 132 MB | 100.0% / 100.0% |
     | deberta_v3_xsmall | 88 / 143 MB | 99.7% / 99.8% |
     | bert_base_cased | 109 / 217 MB | 100.0% / 99.8% |
     | modernbert_base | 152 / 301 MB | **93.8% / 90.8%** |

     - Fixes from the first run: int8 now uses per-channel scales (about 3× lower error at the same size); exports are topologically re-sorted, counting values read inside `If` subgraphs (quantization left DeBERTa's graph unsorted, failing `onnx.checker`).
     - Smoke criterion changed: raw int8/fp16 agreement on a model trained for 2 steps measures near-ties, not the export (first run: int8 61–77%, even fp16 missed single words). int8/fp16 are now judged on words where PyTorch's top-two logit gap > 0.1 (≥ 90%; `configs/eval.yaml` → `parity`); fp32 must still match (≥ 99.9%).
     - **Risk for Phase 9:** ModernBERT loses the most under int8 even with per-channel scales (relative logit error ~0.09 vs ~0.05 for the others). If it fails parity after training, try excluding sensitive nodes (task 4), or offer it with fp16 (WebGPU) only.
     - Disk after the smoke test: ~1.2 GB checkpoints, ~3.1 GB exports.
1. `train.py` with configs from `configs/train_<model>.yaml`; log to TensorBoard. `Trainer` subclass with per-group `compute_loss`; the model class stays `AutoModelForTokenClassification`.
2. Per candidate: learning-rate sweep; λ sweep; then the final run with 3 seeds; keep the best checkpoint by dev chunk F1 (only the best checkpoint of each run is kept on disk).
3. Optional experiments, kept only if they improve dev F1 or LAS: augmentation (Phase 4, task 6); the biaffine head for group B is no longer optional: it is planned after the extended stage (*Nested phrase structure* → *Planned change*).
4. Final evaluation on the test split, run once per candidate: UPOS accuracy, chunk F1 overall and per type, comparison with Phase 5 baselines; UAS, LAS, UAS without punctuation, nested-phrase F1 and multi-word bracket F1 (predicted vs gold-tree brackets, both built by `src/modules/parser/treeDecoder.ts` run via `tsx`, so training and the app share one implementation; multi-word = brackets of two or more words), and the share of sentences that needed tree repair. The report marks a model's nested view *pending Phase 8* when it meets the UAS and bracket F1 targets; shown-bracket precision is measured after Phase 8 gating.
5. Error analysis per candidate: 100 test errors grouped by type (e.g., noun/verb homographs, PP chunks, coordination, PP attachment) in `reports/errors.md`. Done 2026-11-20: `js/error_analysis.mjs` (`npm run errors` in `training/js`; settings `configs/eval.yaml` → `error_analysis`) also counts all test errors by type, classifies missed nested-view brackets by cause, and lists attachment errors shared by all models.

**Deliverables:** best checkpoint per candidate, `reports/smoke_test.md`, `reports/training.md` (one table row per candidate), `reports/errors.md`.
**Outcome, base run (2026-11-18, 5.9 h unattended, 32 runs, 0 failures; `reports/training.md`):** test UPOS / chunk F1 / tree UAS / tree LAS / nested F1 — DistilBERT 96.67 / 95.20 / 88.15 / 86.05 / 79.26; DeBERTa-v3-xsmall 97.62 / 96.75 / 91.57 / 89.79 / 85.36; BERT 96.89 / 95.81 / 89.68 / 87.73 / 81.11; ModernBERT 97.67 / 96.94 / 91.42 / 89.68 / 83.76 (seed sd ≤ 0.2). DeBERTa and ModernBERT meet the flat thresholds; no model meets the nested ones. Every model picked the top learning rate (2e-4) and most runs peaked at the 15-epoch cap, so an extended stage runs next (`--stage extended`: learning rates 1e-4 – 3e-4, up to 30 epochs, λ fixed; `reports/training_extended.md`). Against the nested-view targets (rescored 2026-11-19): UAS without punctuation 89.02 / 92.17 / 90.60 / 92.17 (target 93) and multi-word bracket F1 73.10 / 81.18 / 75.56 / 78.84 (target 88), same model order. Flat thresholds confirmed by owner: UPOS ≥ 97, chunk F1 ≥ 94. Task 5 done 2026-11-20 (below).

**Outcome, extended stage (2026-11-19, resumed once after an interruption, 0 failures; `reports/training_extended.md`):** test UPOS / chunk F1 / UAS excl. punct / multi-word bracket F1 at the dev-selected seed — DistilBERT 96.73 / 95.34 / 89.08 / 72.24; DeBERTa-v3-xsmall 97.52 / 96.68 / 92.72 / 82.59; BERT 96.98 / 96.09 / 91.13 / 77.12; ModernBERT 97.70 / 96.68 / 92.06 / 79.44. Gains are small (DeBERTa and BERT +0.5 UAS, +1.5 bracket F1); most runs stopped early before epoch 30. DeBERTa and ModernBERT again picked the top learning rate (3e-4). Same flat-threshold result as the base run; no model meets the nested-view targets.

**Checkpoints carried forward (owner, 2026-11-20; `configs/eval.yaml` → `phase7_checkpoints`):** extended stage for DeBERTa-v3-xsmall, BERT, and ModernBERT; base stage for DistilBERT (its extended dev selection score was lower, 89.34 vs 89.72). Each uses its stage's dev-selected seed run. Test was reported for both stages; it was not used for any choice.

**Outcome, error analysis (2026-11-20; `reports/errors.md`, carried-forward checkpoints, test):**
- Attachment errors are 56–60% of all error units (1,931–2,957 per model). By type: clause attachment 22–26%, modifier attachment ~21%, punctuation 17–20% (excluded from the UAS target), coordination 11–12%, PP attachment ~10%.
- 87–90% of missed multi-word brackets come from attachment errors: 62–67% have a wrong head inside the span, 23–26% grow because an outside word attaches into them. Label-only misses are 1–2%; the rest (9–12%) come from punctuation or UPOS differences. Each attachment error costs ~1.8 multi-word brackets, so the bracket-F1 gap is a UAS gap.
- 17–19% of attachment errors are on words whose head came from tree repair (not the top candidate), which MST decoding replaces. 982 attachment errors are shared by all four models (51% of DeBERTa's), mostly clause and modifier attachment.
- UPOS: PROPN vs NOUN is the largest group (31–37% of UPOS errors), then adjective vs noun/verb (15–18%); noun/verb homographs are only 3–5%.
- Chunks: NP boundaries are 42–48% of chunk errors (split and joined about equally); PP chunk errors are rare.

**Exit criterion:** every candidate passed the smoke test or was dropped with a reason; every remaining candidate is trained and evaluated once on test; at least one candidate meets the acceptance thresholds and beats the baselines (UPOS: wink-nlp and compromise; chunk F1: compromise). Candidates that meet the thresholds go on to Phases 8–11 and are offered in the app; the others are recorded and not shipped. Per model, the nested-view targets (*Nested phrase structure* → *Nested-view acceptance*) decide whether its nested view is enabled; shown-bracket precision is measured after Phase 8 confidence gating. Test scores are not used to rank models; the app shows each model's metrics and the user chooses.

**Biaffine head, T05 spike (2026-11-20; `reports/smoke_test_biaffine.md`):** `scripts/biaffine.py` adds the arc scorer to each candidate's `*ForTokenClassification` class (Optimum's ONNX config of the base architecture plus the output `arc_scores` `[batch, T, T]`). Transformers.js 4.3.2 returns both outputs from `model.forward()` (`model()` drops `arc_scores`), so no raw `onnxruntime-web` session is needed. All four 1-epoch smoke models export fp32 / int8 / fp16, pass `onnx.checker`, and match PyTorch exactly in fp32 (labels, relations, heads). Fixes: the arc head bias is a multiply-and-sum (a 1-D MatMul made int8 models that onnxruntime could not load); the arc scorer's nodes stay fp32 in int8 (`export.int8_keep_arc_fp32`, ~3 MB). DistilBERT, DeBERTa-v3-xsmall, and BERT pass int8 and fp16 on confident words (arc ≥ 0.977); **ModernBERT passes fp16 but not int8** (confident agreement A 0.875 / relation 0.849 / arc 0.775), the Phase 9 risk noted in the smoke test; Phase 9 judges trained models.

**Biaffine stage (T51; started 2026-11-19 23:14 UTC):** `python scripts/run_phase7.py --stage biaffine` (`configs/eval.yaml` → `phase7_stages.biaffine`; report `reports/training_biaffine.md`; record `phase7_biaffine.json`). Data `dataset_arc` (schema v2); learning rates 1e-4, 2e-4, 3e-4 (+ 4e-4, 5e-4 for DeBERTa and ModernBERT), up to 30 epochs, patience 3, λ fixed from the base run; at the best rate, the first seed is also trained on `dataset_arc_aug` (augmentation, T06) and the seeds use it if its dev selection score is not lower. Dev UAS/LAS during training use argmax heads; test trees use MST (`treeDecoder.ts`). Probe before the run (DistilBERT, 2 epochs, lr 2e-4): dev UAS 90.1 / LAS 86.5 (rel_pos best after 15 epochs: 86.0 / 84.2).

**Biaffine stage outcome (finished 2026-11-20; paused once for power and resumed):** test, dev-selected seed:

| Model | UPOS | Chunk F1 | UAS excl. punct | Multi-word bracket F1 | Offered | Nested view |
|---|---|---|---|---|---|---|
| DistilBERT | 96.82 | 95.59 | 92.22 | 84.13 | no (UPOS) | no |
| DeBERTa-v3-xsmall | 97.65 | 97.01 | 94.54 | 89.04 | yes | met (Phase 8) |
| BERT | 96.995 | 96.13 | 93.80 | 86.89 | no (UPOS; strict ≥ 97) | no |
| ModernBERT | 97.40 | 96.47 | 94.38 | 89.14 | yes | met (Phase 8) |

Bracket F1 is measured on the phrase-per-head brackets since 2026-11-23 (T75, T77; re-scored from the stored predictions, no retraining). Under the earlier head-outward brackets it was 84.97 / 89.75 / 87.82 / 89.71; with phrase-per-head brackets before the main-clause and coordination rules (T82) it was 85.52 / 89.85 / 87.91 / 89.98.

**Projective decoding (measured in T82; turned on for both models by the owner on 2026-11-23, T83; the UAS and bracket F1 of the two offered models in the table above are with it):** the best tree without crossing arcs (Eisner; `treeDecoder.ts` → `projectiveTree`, `js/projective_eval.mjs`) against the spanning tree, same arc scores. UAS all words, dev / test: DeBERTa-v3-xsmall 94.25 → 94.21 / 94.35 → 94.38; ModernBERT 94.10 → 94.16 / 94.21 → 94.29. Trees differ in about 3% of sentences. The first rule was to adopt it only if accuracy does not drop (it drops by 0.04 on dev for DeBERTa-v3-xsmall); the owner then turned it on for both models "for now" (T83), because it keeps attachments consistent with each other. `decodeArcTree` falls back to the spanning tree only when no projective tree is possible.

Best rates: DeBERTa 3e-4 (4e-4 and 5e-4 lower), ModernBERT 2e-4, DistilBERT and BERT 1e-4 (lowest tried). Augmentation used for BERT and ModernBERT only. Words whose MST head differs from the argmax head: 2.6–4.5% (rel_pos tree repair: ~34%).

**Exit status (2026-11-20): met.** All four passed the smoke test and were trained and evaluated on test; DeBERTa-v3-xsmall and ModernBERT meet the flat thresholds and beat the baselines; no model meets the nested-view targets with the current head. Deliverables done (`reports/training.md`, `reports/training_extended.md`, `reports/errors.md`). Next: the biaffine retrain (*Planned change*), then Phase 8 on the retrained models (`todo.md`).

### Phase 8 — Calibration and ambiguity threshold

Alternatives and the nested view's confidence gating are built from model probabilities, so the probabilities must be reliable. Runs for every offered biaffine model (flat thresholds met after the retrain), with its own temperatures, margins, and threshold in its `labels.json` (schema v2). Script: `scripts/calibrate.py` (all offered models: `python scripts/calibrate.py`; one run: `--model m --run r`), which calls `js/gating_eval.mjs` for the bracket threshold. Settings: `configs/eval.yaml` → `calibration`, `ambiguity` (rewritten 2026-11-20 for the biaffine head; the earlier tasks assumed head-position labels).

**Tasks**
1. Collect, on dev and test, each word's group A logits (`UPOS|CHUNK`), relation logits, and arc scores over its sentence plus root (first subwords), at the carried-forward checkpoint (dev-selected seed of the biaffine stage).
2. Fit one temperature per output on dev by minimizing NLL (golden-section search in [`t_min`, `t_max`] = [0.25, 20]; widened from 4 on 2026-11-21 because the raw arc scores are strongly overconfident: dev optimum 5.6 for DeBERTa, 9.4 for ModernBERT): `calibration.temperature` (group A), `rel_temperature`, `arc_temperature`. Report top-1 expected calibration error (ECE) before and after, dev and test. (MST trees do not change with the arc temperature: each word keeps exactly one head, so only head probabilities change.)
3. Ambiguity margins on dev, with calibrated probabilities. A word is ambiguous if its top-two group A probabilities differ by less than `ambiguity.margin`; a PP-attachment word (gold `obl`/`nmod` with a `case` dependent) gets an attachment alternative if its top-two head probabilities differ by less than `ambiguity.attachment_margin`. Alternatives per sentence = min(5, 2^k − 1) for k ambiguous words, plus attachment alternatives, capped at `MAX_ALTERNATIVES` = 5 (T09). For each margin pair: share of errors recovered (the gold label or head is offered as an alternative) and mean alternatives per sentence.
4. Choose the margin pair: most errors recovered with mean alternatives per sentence ≤ `ambiguity.max_mean_alternatives` = 0.3 (owner, 2026-11-21: with the proposed 1.0 the cap never bound, because more alternatives always recover more errors, so the largest margins in the sweep won; DistilBERT dry run at 0.3: ~12% of errors recovered, 0.27 alternatives per sentence, ~18% of sentences flagged).
5. Bracket gating (`treeDecoder.ts` → `spanConfidence`; `phraseLabeler.ts` → `gateLabeled`; redefined by the owner 2026-11-23, T73/T78): decode MST trees with calibrated head probabilities, build and label nested phrases, and for thresholds 0 – 0.99 measure the precision of the shown multi-word brackets (labeled), their coverage, and recall on dev and test. **Span confidence** estimates "this set of words is one phrase" from each word's full head distribution: for a word inside the bracket whose chosen head is inside, the probability that its head is inside; for a word inside whose chosen head is outside (the phrase's head word), the probability that its head is outside; for a word outside whose chosen head is outside, the probability that its head is outside; words outside that attach into the bracket (a subject next to its predicate) and punctuation do not count. The product over the sentence's words is the bracket's confidence, so an unsure attachment lowers only the brackets whose boundary it could move, not every bracket around it (the previous whole-bracket product showed 49% / 54% of brackets). Choose the lowest threshold with dev precision ≥ 95%. Brackets below it collapse: their children show directly in the parent, and the bracket's role and attachment move to its head word as a badge. The main clause's subject and predicate brackets never collapse (T82): below the threshold they are drawn dashed, and they are counted separately from the brackets shown as certain.
5b. Role gating (T59, owner 2026-11-21): at the chosen bracket threshold, label the phrases with `phraseLabeler.ts` and gate them (roles of collapsed brackets become badges on their head words) and choose the lowest role threshold (relation probability × head probability of the role's head word, calibrated; relation probabilities renormalized over the stored top-5 candidates) whose dev role precision is ≥ the same 95%. A role is correct if the gold tree's labeled phrases give the same role to the same span (badge: to the same head word). Stored as `nested.role_threshold`.
6. Nested-view decision per model (test): UAS without punctuation ≥ 93, multi-word bracket F1 ≥ 88 (Phase 7 biaffine stage), and shown-bracket precision ≥ 95% at the chosen threshold, with coverage reported.
7. Write temperatures, margins, and the threshold into the checkpoint's `labels.json` (export copies it) and `reports/calibration.md`; record the margins per model in `architecture.md`.

**Deliverables:** `reports/calibration.md`; calibrated `labels.json` per offered model.
**Exit criterion:** calibration error reduced for every offered model (group A, relation, arc); margins and bracket threshold chosen and recorded in `architecture.md` (per model); nested-view decision recorded per model.

**Outcome (2026-11-21; gating refitted 2026-11-23 for the phrase-per-head brackets and span confidence, T78; `reports/calibration.md`):** exit criterion met.

| Model | T (A / rel / arc) | Test ECE A / rel / arc, before → after (%) | Margin / attachment | Bracket threshold | Test shown precision | Test coverage | Role threshold | Test role precision | Roles shown | Nested view |
|---|---|---|---|---|---|---|---|---|---|---|
| DeBERTa-v3-xsmall | 1.78 / 1.99 / 5.57 | 2.69 → 0.61 / 4.15 → 0.73 / 5.19 → 0.41 | 0.4 / 0.3 | 0.85 | 95.78 | 66.7% | 0.3 | 95.73 | 98.3% | met |
| ModernBERT | 2.05 / 2.28 / 9.39 | 2.95 → 0.64 / 4.06 → 0.70 / 5.33 → 1.67 | 0.3 / 0.3 | 0.80 | 95.65 | 68.1% | 0.4 | 95.87 | 95.7% | met |

Refitted again on 2026-11-23 for the main-clause and coordination brackets (T82; before it: thresholds 0.80 / 0.75, coverage 76.1% / 75.6%, role thresholds 0.2 / 0.3). About two thirds of the predicted multi-word brackets are shown as certain, and a further 4% (403 / 418 on test) are main-clause subject or predicate brackets drawn dashed, of which 86% / 85% are correct (the rest collapse; 48.6% / 53.7% under the earlier whole-bracket product, thresholds 0.85 / 0.80, role thresholds 0.4); at the chosen margins ~19% of dev sentences get alternatives, recovering 15% (DeBERTa) and 13% (ModernBERT) of label errors and ~20% of PP-attachment errors.

### Phase 9 — ONNX export and quantization

Runs for every offered candidate.

**Tasks**
1. `export_onnx.py`: export with Optimum (`token-classification` task) in the folder layout Transformers.js expects (`config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model.onnx`).
2. Produce variants: int8 dynamic quantization (`onnx/model_quantized.onnx`, for WASM) and fp16 (`onnx/model_fp16.onnx`, for WebGPU).
3. Parity check (`benchmark.mjs` + `evaluate.py`):
   - fp32 ONNX vs PyTorch: ≥ 99.9% label agreement on dev.
   - int8 and fp16: chunk F1 and LAS drop ≤ 0.3 points each vs fp32.
4. If int8 fails parity, try excluding sensitive layers (e.g., embeddings, classifier) from quantization (`configs/eval.yaml` → `export.int8_exclude_nodes`). ModernBERT is the most likely case (Phase 7 smoke test; the biaffine smoke test failed int8 even with the arc scorer kept fp32); if it still fails, offer it with fp16 (WebGPU) only. Biaffine exports also compare `arc_scores` (argmax head per word; `js/benchmark.mjs` group "arc").

**Deliverables:** ONNX files; parity report.
**Exit criterion:** both variants pass parity for every offered model (a model whose variant fails is not offered with that variant).

**Outcome (2026-11-21; `reports/parity.md`):** exit criterion met. Commands (from `training/`): `python scripts/export_onnx.py --model <m> --run <run> --parity-windows all`; `npm run benchmark -- --model <m> --run <run> --mode parity` (in `js/`); `python scripts/evaluate.py --parity`. Dev windows come from `dataset_arc` for biaffine models (fixed 2026-11-21; the export had used the v1 dataset). Transformers.js (Node, CPU) on all dev windows:

| Model | Variant | Size | Agreement with PyTorch (A / rel / head) | Δ chunk F1 | Δ LAS | Shipped |
|---|---|---|---|---|---|---|
| DeBERTa-v3-xsmall | fp32 | 287 MB | 100 / 100 / 100% | — | — | parity only |
| | int8 | 90 MB | 99.81 / 99.78 / 99.78% | −0.04 | −0.05 | yes |
| | fp16 | 144 MB | 99.99 / 99.99 / 100% | −0.01 | −0.01 | yes |
| ModernBERT | fp32 | 604 MB | 100 / 100 / 100% | — | — | parity only |
| | int8 | 156 MB | 99.69 / 99.62 / 99.41% | +0.13 | +0.02 | yes |
| | fp16 | 302 MB | 99.99 / 100 / 99.98% | 0.00 | 0.00 | yes |

Δ = fp32 − variant in points (negative: the variant scored slightly higher). ModernBERT int8 passes on the trained model (the smoke-test failure came from a barely trained model's near-ties); no `int8_exclude_nodes` needed. Word encoding: `plain` for both (both strategies reproduce Python's token ids on the 3 reference sentences and every dev window; the check now covers dev windows), written to the export's `labels.json` → `tokenizer_word_encoding`. Gating thresholds were fitted on PyTorch outputs; with ≥ 99.4% head agreement they carry over (not re-measured per variant).

### Phase 10 — Browser benchmarking

**Tasks**
1. Build the minimal Vite test page in `training/js/bench-page/` that loads each offered model (model switcher, run in sequence) with Transformers.js in a Web Worker and parses a fixed 5,000-character sample.
2. For every offered model, measure in Chrome, Safari, and Firefox, with WebGPU (where available) and WASM:
   - First load time (download + initialization), cached load time.
   - Parse time for 5,000 characters, including tree decoding (median of 10 runs).
   - Peak memory (and memory after loading) per backend.
3. Test on at least one lower-end device (e.g., older laptop or recent phone) to set minimum device requirements (memory, WebGPU/WASM support); the app has no fallback, so devices below them cannot parse.

4. Set the pre-flight thresholds in `src/modules/preflight/requirements.ts` from these measurements (memory hint, storage margin, WebGPU buffer size); check single-threaded WASM against the 5 s budget.

5. Record per model, for the catalog: first-load time, parse time per backend and WASM speed tier (many threads, two cores, one thread; owner, T65), and peak memory per backend. No per-model minimum memory (owner, T65).

**Deliverables:** `reports/benchmark.md` (one section per model); per-model performance and requirements for `catalog.json`; pre-flight threshold values.
**Exit criterion:** at least one offered model parses 5,000 characters in ≤ 5 s on a typical laptop with WASM; per-model requirements recorded; minimum device requirements defined and set in `requirements.ts`. Slower models stay available with their measured speed shown.

**Outcome so far (2026-11-21; `reports/benchmark.md`):** measured on the development machine (Apple M5 Pro, 48 GB) in Chrome 158 and Safari 27 (owner: those two only for now), with the app's own parser worker (`js/bench_browsers.mjs`, `bench-page/`; `npm run bench`, `npm run bench-report`). Median parse of the 4,945-character sample, warm (ms):

| Model | Chrome int8 (WASM) | Chrome fp16 (WebGPU) | Safari int8 (WASM) | Safari fp16 (WebGPU) | int8, one WASM thread (Chrome / Safari) |
|---|---|---|---|---|---|
| DeBERTa-v3-xsmall | 423 | 233 | 400 | 515 | 1,223 / 1,182 |
| ModernBERT | 1,483 | 148 | 1,455 | 275 | 4,913 / 4,854 |

Cold load (download from a local server + init + self-test) 1.2–1.8 s; warm load from Cache Storage 0.8–1.3 s. Warm peak memory (browser-process RSS growth): DeBERTa 1.2–1.8 GB int8, 1.9–2.8 GB fp16; ModernBERT 1.3–2.2 GB int8, 2.4–2.9 GB fp16. Thresholds set by the owner on 2026-11-23 (T65): no per-model memory requirement (the proposed `min_device_memory_gb` of 4 / 8 was dropped: both models ran in the 4 GB VM), catalog parse times per WASM speed tier (`js/bench_report.mjs` → `data/bench/catalog_performance.json`: DeBERTa 0.423 / 1.342 / 1.223 s, ModernBERT 1.483 / 5.166 / 4.913 s for many threads / two cores / one thread; fp16 WebGPU 0.515 / 0.275 s), single-threaded WASM warns only, storage margin 256 MiB, WebGPU storage-binding limit 128 MiB. Every combination is within 5 s here; ModernBERT int8 on one WASM thread is at the budget edge (4.9 s) on this fast machine. Safari throttles unfocused pages (ModernBERT int8 1.4 s → 4–6 s), so runs record focus. Lower-end device (T67, 2026-11-21): Windows 11 ARM VM (UTM on the development machine), 4 GB RAM, 2 vCPUs, Chrome 158: DeBERTa int8 1.34 s median parse, ModernBERT int8 5.17 s (over the 5 s budget); both ran in 4 GB without a crash (Chrome's working set grew ≤ 0.9 GB); fp16 failed to load because the VM's WebGPU adapter lacks `shader-f16`. The VM's cores are M5 Pro cores, so real low-end laptops will be slower. **Exit criterion:** an offered model (DeBERTa-v3-xsmall) parses 5,000 characters well within 5 s on WASM with 2 cores and 4 GB, and per-model measurements are recorded; the minimum device requirements in `requirements.ts` remain (T65).

### Phase 11 — Packaging and release

**Tasks**
1. `scripts/package_models.py`: for every offered model, copy the exported files to `public/models/<model-id>/` (ONNX files tracked with Git LFS) with `labels.json`. Every schema field (Phase 4) is filled; `model_version` and `files` (sizes and SHA-256 of the shipped files) are set here.
   - Add `tokenizer_word_encoding` (`plain` or `space`, from the model's Phase 9 benchmark) to its `labels.json`; `transformerBackend.ts` encodes words with it. (Optional schema v1 field; `LabelConfig` and `validate_labels_json` gain it in the same change.)
   - Write `public/models/catalog.json` (schema v1; `architecture.md` → *Model library*): display name and description from `configs/catalog.yaml`, sizes, test metrics, `nested_view`, Phase 10 performance and requirements. `transformerBackend.ts` feeds words as `tokenizer_input` says and applies `window.max_subwords_per_word`; the Phase 9 parity check covers this.
2. Write `MODEL_CARD.md`: one section per offered model (base model and license, metrics, known weaknesses) plus the shared data, licenses, attribution text, and intended use.
3. Tag the release (e.g., `model-v1.0.0`); record config, seed, data version, and checksums for reproducibility.
4. Integration test in the app, per offered model: the model library downloads and verifies it, `transformerBackend.ts` loads it and matches Phase 9 outputs on 20 fixed sentences; switching models unloads the previous one. The test also checks that `ParseResult` carries `model_version` from `labels.json` and wink character offsets for every word, and that every sentence has a valid tree and nested phrases. The pre-flight checks pass on the shipped files (including `files-integrity`).

**Deliverables:** shipped model files per offered model, `catalog.json`, model card, release tag.
**Exit criterion:** app integration test passes for every offered model.

**Outcome (2026-11-23, T66): exit criterion met.** Release model-v1.0.0: Large (`modernbert_base`, run `lr0.0002_w1_s42_bfaug`) and Compact (`deberta_v3_xsmall`, `lr0.0003_w2_s42_bf`) packaged to `public/models/` by `scripts/package_models.py`; DistilBERT and BERT not offered (UPOS below 97.00). Release record with checksums: `reports/release.md`; model card complete. Integration tests: `src/modules/parser/packagedModels.test.ts` (Node: files match the catalog and `labels.json`; Phase 9 int8 outputs reproduced exactly on 20 test sentences; `ParseResult` with `model_version`, wink offsets, valid trees) and `e2e/release.spec.ts` (production build behind the Pages Functions: download, verify, load, parse, switch) pass for both models. Upload to R2 and deployment: `PUBLISHING.md`. The git tag is created by the owner when the release is committed.

### Phase 12 — Maintenance (ongoing)

- Optional: collect misparsed sentences reported in the app (opt-in, stored locally until exported by the user) as a regression set and extra training data. Requires a new app feature; not yet planned. Already prepared for: feedback records can store words with wink offsets and the model version from `ParseResult`, and unreviewed words are handled as partial labels (Phase 4).
- Retrain when: a new UD release fixes relevant annotations, the regression set grows past ~200 sentences, or a better base model fits the budget.
- Every retrain repeats Phases 7–11 for the retrained models and must not regress on the test split or the regression set. A new or dropped model only changes `catalog.json` and the model folders.

---

## Changelog

### 2026-11-17T02:03:03Z — Claude Opus 5.5, Created training plan

- Added: Document Maintaining Guide (same as `plan.md` and `architecture.md`).
- Added: Overview, key design decisions, and open questions.
- Added: Prerequisites (hardware, system software, Python and Node libraries, data, base model candidates).
- Added: `training/` directory layout.
- Added: Phases 0–12 with tasks, deliverables, and exit criteria.

### 2026-11-17T02:57:39Z — Claude Opus 5.5, Scaffolded training/ directory

- Added: `training/` scaffold matching the layout; every file has a header (description, phase, tasks, dependencies). No code yet.
- Added (proposed): `configs/eval.yaml` (post-training thresholds out of scripts), `scripts/check_env.py` (Phase 0 check), `tests/conftest.py`.
- Added: `training/README.md`, `training/.gitignore`, `reports/README.md`, `MODEL_CARD.md` skeleton; one `train_<model>.yaml` per candidate.
- Modified: *Training directory layout* lists the new files.

### 2026-11-17T03:31:22Z — Claude Opus 5.5, Unified window size; added dependencies

- Modified: Phase 4 states that training and runtime windows are both 256 subword tokens.
- Added: `pyyaml` and `ruff` to Python libraries; `tsx` and `js-yaml` to Node libraries (`tsx` runs TypeScript files in Node).

### 2026-11-17T04:00:45Z — Claude Opus 5.5, Pre-flight check (Phase pre-0)

- Added: *Phase pre-0 — Pre-flight check* with machine check results, tasks (git-lfs, Python 3.12, tool config, Unsloth support check), and gates for later phases.
- Added: open question on the Phase 10 browser benchmark page location.
- Modified: Phase 0 — tool installation moved to Phase pre-0; task 2 now also pins `training/js`; task 5 now includes `bert-base-cased` (exit criterion covers every candidate).
- Modified: git-lfs purpose and Phase 11 task 1 note that shipped ONNX files are tracked with Git LFS.
- Modified: `pyyaml`, `ruff`, `js-yaml` approved by owner; proposed marks removed.

### 2026-11-17T04:21:52Z — Claude Opus 5.5, Pre-0 progress; bench page and tool config

- Added: `training/pyproject.toml` (ruff and pytest settings, owner-approved), `training/.python-version` (3.12), `training/js/bench-page/` (`index.html`, `bench.worker.mjs` headers) to layout.
- Modified: Phase pre-0 machine check — Python 3.12 (3.12.15) ready; git-lfs 3.8.1 installed, repo hooks pending; tasks 2–3 done.
- Modified: Phase 10 task 1 uses `training/js/bench-page/` (owner decision).
- Removed: open question and gate row for the bench page location (decided); hosting-limit check from the Phase 6 gate (deferred by owner).

### 2026-11-17T22:00:00Z — Hankyung Lee, Pre-0 progress; marked all tasks as done

- Modified: Phase pre-0 tasks are now all marked done.

### 2026-11-17T22:14:22Z — Claude Opus 5.5, Phase 0 complete

- Added: Phase 0 *Outcome*: Trainer is used for all four candidates, each passes a dummy MPS run; Unsloth result; notes for later phases.
- Added: `sentencepiece`, `protobuf`, `optimum-onnx` to Python libraries.
- Modified: Overview training framework is now Hugging Face `Trainer`; pre-0 git-lfs row set to Ready; Phase 3 gate now says the root `package.json` mirrors the `training/js` versions.
- Removed: `unsloth` from Python libraries.

### 2026-11-17T22:20:06Z — Claude Opus 5.5, Heading hierarchy

- Added: H1 document title "Enparse Parser Training Plan".
- Modified: *Document Maintaining Guide* is now an H2 section (*Rules*, *Format template* are H3); changelog entries are H3 under *Changelog*, and the format template matches.

### 2026-11-17T22:43:29Z — Claude Opus 5.5, Partial labels, labels.json schema, traceable ParseResult

- Added: key design decisions for partial labels and traceable outputs.
- Added: Phase 4 task 4 (partial labels with a per-word `reviewed` flag) and task 8 with the `labels.json` schema v1 table; exit criterion requires the schema and a matching `LabelConfig`.
- Added: Phase 4 exit gate (`LabelConfig` matches schema v1); Phase 11 gate includes `ParseResult` model version and wink offsets.
- Modified: Phase 3 task 4 keeps wink character offsets per word; Phase 8 task 4 and Phase 11 task 1 refer to schema fields; Phase 11 integration test checks `ParseResult` traceability; Phase 12 notes what is already prepared for feedback data.
- Modified: Phase 4 tasks renumbered (old 4–6 are now 5–7).

### 2026-11-17T23:16:13Z — Claude Opus 5.5, Phase 1 data acquisition and license summary

- Added: Phase 1 *Outcome*: UD EWT r2.19 pinned (commit, checksums), corpus size, proposed license position, proposed GUM exclusion.
- Modified: *Open questions* (training data license, extra data) and *Data* table (GUM license) reflect Phase 1 findings.

### 2026-11-17T23:17:31Z — Claude Opus 5.5, Phase 1 complete

- Modified: Phase 1 *Outcome* — owner accepted the license position and GUM exclusion; exit criterion met.
- Modified: *Gates for later phases* → Phase 1 exit row marked done.
- Removed: *Open questions* → training data license (decided).

### 2026-11-17T23:31:07Z — Claude Opus 5.5, Phase 2 chunk derivation

- Added: Phase 2 *Rule details* (proposed) — refinements found in the dev review; Phase 2 *Outcome*.
- Added: `derive_chunks.py`, `tests/test_derive_chunks.py`, `tests/conftest.py` fixtures, `reports/chunks.md`, `reports/chunk_review.md`; `configs/data.yaml` → `paths.chunked`, `chunks`.

### 2026-11-17T23:33:33Z — Claude Opus 5.5, Phase 2 complete

- Modified: Phase 2 *Rule details* and agent-run review accepted by owner; proposed mark removed; *Outcome* marks the exit criterion met.

### 2026-11-18T04:09:21Z — Claude Opus 5.5, Nested phrase structure output

- Added: *Nested phrase structure* (proposed) — group B structure output (relative-POS head encoding), `treeDecoder` decoding, bracketing convention, fallback behavior, expected accuracy.
- Modified: Overview goal; *Key design decisions* — combined label head replaced by two label groups packed in one classifier (Transformers.js keeps only `logits`, checked in 4.3.2); no rule-based nesting.
- Modified: Phase 2 note (heads kept); Phase 3 task 5 and exit criterion (head remapping, valid trees); Phase 4 group B labels and schema v1 fields `groups`, `dep_encoding`, `calibration.dep_temperature`, `ambiguity.attachment_margin`; Phases 5–11 metrics, loss, calibration, parity, and tests for the structure output.
- Removed: two-head model as an optional Phase 7 experiment (replaced by packed groups; biaffine head is the fallback). Phase 7 optional experiments no longer list GUM (excluded in Phase 1).
- Added: open questions on nested view thresholds and nesting convention.
- Added: *Gates for later phases* — Phase 7 gate for `treeDecoder.ts`; Phase 7 exit gate includes nested view thresholds.

### 2026-11-18T05:05:27Z — Claude Opus 5.5, Phase 3 pre-flight; extra data dropped

- Added: Phase 3 *Pre-flight check*: environment, raw wink/UD agreement (dev 98.10%, train 98.61%), sentence-split mismatch, blocked gates (`winkBackend.ts`, root `package.json`, `textInput.ts`), mismatch types.
- Modified: *Open questions* → *Extra data*: no extra treebanks for now (owner decision).

### 2026-11-18T05:30:29Z — Claude Opus 5.5, Phase 3 decisions and pre-flight 2; nested view confirmed

- Added: Phase 3 *Decisions* (owner): one implementation via `tsx`, contractions always split, hyphenated words one word, merged-word labels, dropped sentences, sentence boundaries, agreement metric. Tasks 1–3 updated.
- Added: Phase 3 *Pre-flight check 2* (app code in place; agreement 97.95% train / 98.97% excluding hyphen-rule words; open items for URLs and symbol runs).
- Modified: *Nested phrase structure* confirmed by owner (proposed marks removed); thresholds UAS ≥ 97%, LAS ≥ 94%; app ships without the nested view if missed. Phase 7 exit criterion updated accordingly.
- Modified: gates — Phase 3 and Phase 10 marked done; Phase 7 exit row records nested thresholds.
- Removed: open questions on nested view thresholds and nesting convention (decided).

### 2026-11-18T05:38:31Z — Claude Opus 5.5, Phase 3 pre-flight complete

- Added: Phase 3 *Decisions* rows for URLs/e-mail addresses and symbol runs; agreement metric defined (literal by-design exclusions, every split ≥ 99.5%) (owner).
- Modified: *Pre-flight check 2* — final results (dev 99.59%, train 99.77%, test 99.61%; target met); mismatch table; known weakness (glued sentence-final periods); Phase 3 can start. Exit criterion updated.
- Modified: Phase 0 note — unshipped weak-copyleft dependencies accepted by owner.

### 2026-11-18T06:27:44Z — Claude Opus 5.5, Phase 3 complete

- Added: Phase 3 *Outcome* (agreement 99.76% / 99.56% / 99.56%; all trees valid; output format); *Decisions* dev details for the main piece of a split and chunk prefixes.
- Added: `js/lib/` (CoNLL-U reader, alignment logic), `js/tests/` (node:test), `js/package.json` scripts to the directory layout; `configs/data.yaml` → `paths.aligned`, `alignment`.

### 2026-11-18T06:38:56Z — Claude Opus 5.5, Phase 4 complete

- Added: Phase 4 *Outcome* (datasets per candidate, label and window statistics, checks, dev details).
- Added: `labels.json` schema v1 fields `tokenizer_input` and `window.max_subwords_per_word` (optional additions written in Phase 4; schema version unchanged).
- Modified: Phase 4 exit gate marked done; Phase 11 task 1 notes the tokenizer contract.

### 2026-11-18T06:56:29Z — Claude Opus 5.5, No fallback mode

- Removed: `chunkPatterns.ts` from baselines, layout, libraries, and the Phase 5 gate; nested-view fallback note (owner decision: no rule-based fallback).
- Modified: Phase 5 baselines are wink-nlp POS (UPOS only) and compromise (UPOS and chunks); Phase 7 exit criterion names them. Phase 10 sets minimum device requirements instead of fallback rules.

### 2026-11-18T07:06:28Z — Claude Opus 5.5, Pre-flight integration

- Added: `labels.json` schema v1 field `files` (written by `export_onnx.py`, Phase 11; `null` until then; optional addition, schema version unchanged). `prepare_data.py` writes `null` and validates it.
- Modified: Phase 10 measures memory per backend and sets the pre-flight thresholds; Phase 11 writes `files` and checks pre-flight on the shipped files; gate for pre-flight policies before Phase 10 exit.

### 2026-11-18T07:14:39Z — Claude Opus 5.5, Phase 5 complete

- Added: Phase 5 *Outcome*: wink-nlp UPOS 88.76%, compromise UPOS 82.36% and chunk F1 69.65% (test); method and mapping; bar for Phase 7.

### 2026-11-18T07:49:54Z — Claude Opus 5.5, Model library: every candidate trained and offered

- Removed: Phase 6 (base model selection) and its size-cap gate (owner decision): no single base model is chosen; candidates that meet the acceptance thresholds are offered in the app's model library and the user chooses.
- Added: Phase 7 task 0 smoke test (1-epoch train, export, Node Transformers.js load and parse per candidate; `reports/smoke_test.md`); compute estimate.
- Modified: Overview output, key design decisions, open questions (hosting limits instead of a size cap), candidate table, disk estimate (~40 GB); Phases 7–11 run per candidate; Phase 7 exit (at least one model meets the thresholds; test scores not used to rank); Phase 10 records per-model performance and requirements; Phase 11 writes `public/models/<model-id>/` and `catalog.json` (`scripts/package_models.py`, `configs/catalog.yaml`); Phase 12 per model.
- Added: gate for hosting and storage limits before Phase 11.

### 2026-11-18T08:11:49Z — Claude Opus 5.5, Phase 7 tooling implemented (not run)

- Added: `scripts/train.py` (two-group loss, word-level dev metrics, early stopping, sweeps, `--smoke`), `scripts/metrics.py`, `scripts/export_onnx.py` (fp32 / int8 / fp16, `labels.json` `files`, reference and parity files), `js/benchmark.mjs` (smoke, parity, speed) with `js/lib/inference.mjs`, `scripts/run_smoke.sh`, `scripts/smoke_report.py`; `src/modules/parser/treeDecoder.ts` (Phase 7 gate). Tested on a tiny random model only; the smoke test has not been run.
- Added: Phase 7 task 0 run instructions and word-encoding strategy; Phase 11 task 1 writes `tokenizer_word_encoding` into each model's `labels.json`.
- Modified: `configs/eval.yaml` (`smoke`, `export` with opset 18, `parity`, `acceptance`), `configs/train_*.yaml` (Phase 7 hyperparameters), `configs/data.yaml` (`paths.checkpoints`, `paths.onnx`); directory layout.
- Modified: *Gates for later phases* — Phase 7 gate (`treeDecoder.ts`) is met.

### 2026-11-18T08:36:15Z — Claude Opus 5.5, Phase 7 smoke test passed

- Added: Phase 7 task 0 *Outcome*: all four candidates pass (training, export, Transformers.js check); sizes; int8 agreement; word encoding `plain` for all.
- Modified: `export_onnx.py` uses per-channel int8 and topologically re-sorts graphs (DeBERTa fix); the smoke criterion judges int8/fp16 on confident words only (`configs/eval.yaml` → `parity.smoke_margin`, `smoke_min_confident_agreement`).
- Added: Phase 9 risk and fallback for ModernBERT int8.

### 2026-11-18T13:17:06Z — Claude Opus 5.5, Phase 7 overnight run set up

- Added: `scripts/run_phase7.py` (sweeps → seeds → evaluation per model; resumable; reuses runs only with matching settings; status file; report), `scripts/run_phase7_overnight.sh` (pre-flight checks, detached under `caffeinate`), `scripts/evaluate.py` test mode, `js/nested_eval.mjs` + `js/lib/nested.mjs` (nested-phrase F1 and repaired-tree scores with `treeDecoder.ts`).
- Modified: Phase 7 hyperparameters after a batch-size probe (batch 8, learning-rate sweep 3e-5 – 2e-4, up to 15 epochs, patience 3); early stopping and all choices use the mean of dev chunk F1 and LAS (proposed).
- Fixed: `treeDecoder.ts` cycle repair could fail to converge on noisy predictions; repairs now never create a new cycle (fuzz test with 3,000 random sentences).

### 2026-11-18T22:18:20Z — Claude Opus 5.5, Phase 7 base results; extended stage

- Added: Phase 7 base-run *Outcome* (per-model test metrics; flat thresholds met by DeBERTa-v3-xsmall and ModernBERT; nested thresholds by none); flat thresholds 97 / 94 confirmed by owner.
- Added: `run_phase7.py --stage` (tagged runs, own record and report, fixed λ, stage-scoped pruning) and `configs/eval.yaml` → `phase7_stages.extended`; extended run started 2026-11-18 22:16 UTC.

### 2026-11-18T22:20:52Z — Claude Opus 5.5, Nested-view targets and biaffine head decided

- Modified: *Nested phrase structure* — nested-view acceptance is UAS without punctuation ≥ 93, labeled multi-word bracket F1 ≥ 88, and ≥ 95% precision of shown brackets after confidence gating (owner); low-confidence brackets collapse.
- Added: planned biaffine parser head after the extended stage (owner), with the measurements that motivate it.

### 2026-11-19T04:47:11Z — Antigravity, Documented parser/phraseLabeler.ts and training caveats

- Modified: *Key design decisions* → *No rule-based nesting* and *Nested phrase structure* to include `parser/phraseLabeler.ts` (deterministic role, clause/predicate, and head-of-parent labeling over `treeDecoder.ts` output) and its training-side caveats (UAS/LAS accuracy ceiling, stripped UD subtypes vs. upcoming biaffine relation classifier, discontinuous predicates, and confidence-gating interaction).

### 2026-11-19T05:09:52Z — Claude Opus 5.5, Stale thresholds, proposed marks, todo.md

- Modified: *Key design decisions*, Phase 5 bar, Phase 7 exit criterion, and the pre-0 gate table use the current thresholds (flat: owner-confirmed 97% / 94%; nested view: UAS without punctuation ≥ 93, bracket F1 ≥ 88, shown-bracket precision ≥ 95) instead of the superseded UAS ≥ 97 / LAS ≥ 94.
- Modified: Phase 7 task 3 — the biaffine head is planned, not an optional experiment.
- Modified: `parser/phraseLabeler.ts` passages marked **(proposed)** (added 2026-11-19 by Antigravity; not yet confirmed by the owner).
- Modified: pointers to `plan.md` → *Undecided* now point to `todo.md`.
- Removed: *Open questions* contents (moved to `todo.md`; acceptance thresholds item dropped as decided).

### 2026-11-19T05:31:24Z — Claude Opus 5.5, Nested-view target metrics in Phase 7 evaluation

- Modified: Phase 7 task 4 adds UAS without punctuation and multi-word bracket F1 (the measurable nested-view targets); the report judges the nested view by `acceptance.nested_view` and marks models meeting both *pending Phase 8*.
- Modified: Phase 7 base outcome adds the rescored target metrics (no model meets them yet).

### 2026-11-19T06:59:42Z — Claude Opus 5.5, Relation subtype allowlist decided

- Modified: *Nested phrase structure* → *Head encoding*, *Planned change*, and the `phraseLabeler.ts` caveat: the biaffine relation classifier keeps ten subtypes (`nsubj:pass`, `aux:pass`, `obl:agent`, `acl:relcl`, `nmod:poss`, `compound:prt`, `obl:unmarked`, `det:predet`, `advcl:relcl`, `cc:preconj`); `nmod:unmarked`, `nmod:desc`, `nsubj:outer`, `csubj:outer`, `csubj:pass` fold into their base relation (owner decision). Current (`rel_pos_v1`) models are unchanged.

### 2026-11-19T22:39:04Z — Claude Opus 5.5, Phase 7 closed; biaffine design decided

- Added: Phase 7 extended-stage outcome, carried-forward checkpoints (owner: extended for DeBERTa, BERT, ModernBERT; base for DistilBERT), error-analysis outcome, and exit status (met).
- Added: *Nested phrase structure* → *Biaffine design* (owner decisions T04, T06, T07, T08): per-sentence arc scope, subword-level `[T, T]` arc scores, runtime windows packed like training, stray `I-X` → `B-X` repair, augmentation experiment, learning rates 4e-4 / 5e-4 for DeBERTa and ModernBERT.
- Modified: Phase 4 task 6 (augmentation decision), Phase 7 hyperparameters (selection score and λ confirmed), Phase 7 task 5 (done), *Key design decisions* → *Multi-sentence context* (no runtime overlap).

### 2026-11-20T22:07:16Z — Claude Opus 5.5, Biaffine stage and Phase 8 done

- Added: Phase 7 biaffine-stage outcome (DeBERTa-v3-xsmall and ModernBERT offered; BERT and DistilBERT not).
- Added: Phase 8 outcome (temperatures, ECE, margins, bracket thresholds, nested view met for both offered models).
- Modified: Phase 8 tasks 2, 4, 5: temperature range [0.25, 20], mean-alternatives cap 0.3 (owner), bracket confidence with the head's outer dependents.

### 2026-11-20T22:29:17Z — Claude Opus 5.5, Role gating (T59)

- Added: Phase 4 schema v2 → `nested.role_threshold`; Phase 8 task 5b (role gate fitted on dev, ≥ 95% role precision; badges for collapsed brackets).
- Modified: Phase 8 outcome table: role threshold 0.4 for both offered models (test role precision 96.06% / 95.99%).

### 2026-11-20T22:42:10Z — Claude Opus 5.5, Phase 9 done

- Added: Phase 9 outcome (both offered models ship int8 and fp16; parity table; word encoding `plain`).
- Modified: `export_onnx.py` uses `dataset_arc` dev windows for biaffine models and stores window words; `benchmark.mjs` checks the word encoding on every dev window; `evaluate.py --parity` implemented (`reports/parity.md`).

### 2026-11-21T04:07:12Z — Claude Opus 5.5, Phase 10 measured (Chrome, Safari)

- Added: Phase 10 outcome so far: parse, load, and memory per model, browser, and variant; single-threaded WASM check; proposed `min_device_memory_gb`; lower-end device and thresholds still open (T67, T65).

### 2026-11-21T04:30:46Z — Claude Opus 5.5, Phase 10 lower-end run (T67)

- Added: Phase 10 outcome → 4 GB / 2-vCPU Windows VM results (DeBERTa int8 1.34 s, ModernBERT int8 5.17 s, fp16 unavailable without `shader-f16`); exit criterion met except the `requirements.ts` thresholds (T65).

### 2026-11-21T05:19:02Z — Claude Opus 5.5, Dictionary pipeline location (T42)

- Added: *Training directory layout* → `dictionary/` and the dictionary pipeline note (owner, T42; build T70).
- Modified: layout → `js/bench_browsers.mjs`, `bench_report.mjs`, and the current `bench-page/` files (Phase 10).

### 2026-11-21T05:44:11Z — Claude Opus 5.5, Known-word list build (T41)

- Added: layout → `configs/dictionary.yaml` (pinned NGSL 1.2, CC BY-SA 4.0) and `js/build_known_words.mjs` (generates the app's subword known-word list).

### 2026-11-22T23:55:00Z — Claude Fable 5.2, Nested view: phrase-per-head brackets (T73, T74)

- Modified: *Key design decisions* → *No rule-based nesting* (quantifier exception); *Nested phrase structure* → views example, *Decoding* steps 3–5 (one bracket per phrase, clause / predicate / complement brackets, punctuation), *Role and head labeling*.
- Added: *Quantity expressions* (closed list, owner-confirmed incl. *some of*, *amount of*) and *Attachments*.
- Modified: Phase 8 task 5 (span confidence replaces the whole-bracket product; gating after labeling); results are refitted in T78.

### 2026-11-23T00:40:00Z — Claude Fable 5.2, Phase-per-head brackets measured and gating refitted (T75–T78)

- Modified: biaffine stage outcome → multi-word bracket F1 on the new brackets (DeBERTa 89.85, ModernBERT 89.98; `reports/training_biaffine.md` re-rendered).
- Modified: Phase 8 outcome → bracket thresholds 0.80 / 0.75, test shown precision 95.61 / 95.66, coverage 76.1% / 75.6%; role thresholds 0.2 / 0.3, test role precision 95.51 / 95.71. Temperatures and margins unchanged. Both models keep the nested view.

### 2026-11-23T01:30:00Z — Claude Fable 5.2, Attachment spans (T81)

- Added: *Nested phrase structure* → *Attachments* → span targets for modifiers before their head (owner); no correction rule for adjective-on-adjective errors.

### 2026-11-23T02:30:00Z — Claude Fable 5.2, Main-clause and coordination brackets; projective decoding measured (T82)

- Added: *Decoding* step 3 → main clause without a clause bracket (subject and predicate always shown, dashed when unsure) and side-by-side coordination; level `conjunct`.
- Modified: biaffine stage outcome → bracket F1 on the new brackets (DeBERTa 89.13, ModernBERT 89.03); projective decoding measured and not adopted.
- Modified: Phase 8 task 5 and outcome → bracket thresholds 0.85 / 0.80, test shown precision 95.83 / 95.64, coverage 66.7% / 68.2% plus 4% dashed; role thresholds 0.3 / 0.3, role precision 95.80 / 95.62.

### 2026-11-23T03:30:00Z — Claude Fable 5.2, Projective decoding on; near-tie display (T83)

- Modified: projective decoding turned on for both models (owner); biaffine outcome (UAS excl. punct 94.54 / 94.38, bracket F1 89.16 / 89.19) and Phase 8 outcome (test shown precision 95.78 / 95.65, coverage 66.7% / 68.1%; role thresholds 0.3 / 0.4, role precision 95.73 / 95.87) re-measured with it.
- Added: *Decoding* → near-ties (top reading below 60%).

### 2026-11-23T06:30:00Z — Claude Opus 5.5, Dictionary pipeline built (T70)

- Added: *Dictionary build* paragraph (commands, pinned Wiktionary subset, headword and entry rules, shards, license, v1 results).
- Modified: layout → `dictionary/` files and `configs/dictionary.yaml` sources.

### 2026-11-23T07:00:00Z — Claude Opus 5.5, Pre-flight thresholds (T65)

- Modified: Phase 10 task 5 and outcome → owner thresholds (T65): no per-model memory requirement; parse times per WASM speed tier for `catalog.json`; single-threaded WASM warns; storage margin 256 MiB; WebGPU storage-binding limit 128 MiB.

### 2026-11-23T13:00:00Z — Claude Opus 5.5, Every conjunct bracketed (T92)

- Modified: *Decoding* step 3 → *Coordination*: one-word conjuncts are brackets too (owner); multi-word bracket F1 unchanged (DeBERTa 89.16, ModernBERT 89.19; one-word brackets are not scored or gated).

### 2026-11-23T13:30:00Z — Claude Opus 5.5, Shared preposition before a coordination (T93)

- Added: *Decoding* step 3 → shared preposition (owner).
- Modified: biaffine outcome → multi-word bracket F1 on the new brackets: DeBERTa 89.04, ModernBERT 89.14 (still ≥ 88); Phase 8 thresholds refitted and unchanged (0.85 / 0.80; roles 0.3 / 0.4).

### 2026-11-23T14:30:00Z — Claude Opus 5.5, Phase 11 outcome

- Added: Phase 11 outcome (release model-v1.0.0, integration tests, release record).
