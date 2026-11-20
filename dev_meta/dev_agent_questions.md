# Enparse Developer–Agent Q&A

Questions from the project owner and agent answers, kept for reference. Entries are added only when the owner asks for them to be recorded. Answers reflect the plan at the time they were written; the source-of-truth documents (`plan.md`, `architecture.md`, `plan-training.md`, `agents.md`) win if they disagree.

---

## 2026-11-18 — How does parser training work overall?

**Question (Hankyung Lee):**

> Before continuing with phase 1, I would like a detailed overview from you explaining how the training overall works. What dataset are we using, and how exactly would the resulting model work? I do have prior experience working with training models from scratch using pytorch, but am not extremely confident with my knowledge, so you may go into technical details if necessary.

**Answer (Claude Opus 5.5):**

### 1. What we're building

The model is a **token classifier**. It reads a passage of English and gives **one label to each word**. The label combines two pieces of information:

- the word's **part of speech** (UPOS, e.g. `NOUN`, `VERB`, `ADP`)
- its **chunk tag** (BIO-encoded `NP`, `VP`, `PP`, `ADJP`, `ADVP`, or `O` for outside any chunk)

```
The      old      man      did     n't     see      the      boat     on      the      river    .
DET|B-NP ADJ|I-NP NOUN|I-NP AUX|B-VP PART|I-VP VERB|I-VP DET|B-NP NOUN|I-NP ADP|B-PP DET|B-NP NOUN|I-NP PUNCT|O
→ [NP The old man] [VP did n't see] [NP the boat] [PP on] [NP the river] .
```

`B-` means "this word begins a chunk", `I-` means "this word continues the current chunk", and `O` means "not in any chunk". The app's sentence-structure view is built from these labels.

We are **not training from scratch**. We take an encoder that is already pretrained on large amounts of English (DistilBERT, DeBERTa-v3, etc.) and **fine-tune** it: we add a small classification layer and train the whole network briefly on labelled data. Most of the language knowledge is already in the pretrained weights. Fine-tuning teaches the network to express that knowledge as our labels.

### 2. The dataset: UD English EWT

**Universal Dependencies (UD)** is a multilingual project with consistent grammatical annotation. **English Web Treebank (EWT)** is its largest English corpus:

| | |
|---|---|
| Size | ~254k words, ~16.6k sentences |
| Genres | Blogs, newsgroups, emails, product reviews, Q&A (Yahoo Answers) |
| Splits (official) | train ≈ 12.5k sentences / dev ≈ 2k / test ≈ 2k |
| License | CC BY-SA 4.0 (attribution + share-alike → the Phase 1 licensing question) |
| Format | CoNLL-U (one word per line, tab-separated columns) |

A CoNLL-U fragment looks like this (simplified):

```
# newdoc id = weblog-...
# text = The old man didn't see the boat.
1    The     the    DET    ...  3  det
2    old     old    ADJ    ...  3  amod
3    man     man    NOUN   ...  6  nsubj
4-5  didn't  _      _      ...  _  _        ← multiword token (surface form)
4    did     do     AUX    ...  6  aux
5    n't     not    PART   ...  6  advmod
6    see     see    VERB   ...  0  root
7    the     the    DET    ...  8  det
8    boat    boat   NOUN   ...  6  obj
9    .       .      PUNCT  ...  6  punct
```

The columns we care about:

- **FORM**: the word as written.
- **UPOS**: the universal part-of-speech tag. There are 17 of them, and this column gives the POS half of our label directly.
- **HEAD and DEPREL**: a **dependency tree**. Each word points to its head word, and the arrow carries a relation name (`det`, `nsubj`, `obj`, and so on).
- **The `# text =` line**: the original raw sentence. Phase 3 uses it.
- **The `# newdoc id` line**: marks where each document starts. Phase 4 uses it.

### 3. Turning trees into chunks (Phase 2)

UD has **no chunk annotations**, only dependency trees. Off-the-shelf chunk datasets such as CoNLL-2000 have unclear licenses, so we derive chunks ourselves with `derive_chunks.py`, using the rules in the plan. For example:

- An **NP** is a nominal head (`NOUN`, `PROPN`, `PRON`, `NUM`) plus its left dependents with relations like `det`, `amod` or `compound`.
- A **VP** is a verb or predicate `AUX`, plus its auxiliaries and a contiguous *not*.
- A **PP** is just the preposition. The NP after it is a separate chunk, as in the CoNLL-2000 convention.

For the sentence above: *man* is a `NOUN` with left dependents *The* (`det`) and *old* (`amod`), so [The old man] is an NP. *see* is the `VERB` with *did* (`aux`) and *n't* (`advmod`, negation) next to it, so [did n't see] is a VP.

This is the main **methodological risk** in the project. The model can only be as good as these derived labels, which is why Phase 2 includes a manual review loop (error rate < 2%). Note too that our chunk F1 numbers measure agreement with *our own* chunk definition, not with a published standard.

### 4. Matching runtime words (Phase 3)

At runtime, **wink-nlp** splits the user's text into words *before* the model sees it. If training used UD's word boundaries and runtime used wink's, the model would meet word boundaries it never saw in training (**train/serve skew**).

So `align_tokens.mjs` re-tokenizes each sentence's `# text` with wink and aligns the result to UD's words. In Phase 0 we saw wink split *don't* into `do` + `n't`, which matches UD's multiword-token convention. Some cases won't match (hyphens, URLs, emoticons, odd punctuation). Mapping rules handle those and define how labels transfer. The target is ≥ 99.5% agreement.

### 5. Building training examples (Phase 4)

#### Labels

There are 17 UPOS tags and 11 chunk tags (B/I × 5 chunk types + O), so 187 combinations are possible. Most never occur (`PUNCT|B-NP`, say). In practice we expect roughly 60–90 real combinations. Combinations seen fewer than 5 times are merged into the nearest valid label. The final list is saved as the label map in `labels.json`.

**Why one combined label rather than two heads?**

- A combined-label model is a standard `AutoModelForTokenClassification`. Hugging Face `Trainer`, the Optimum ONNX exporter and Transformers.js all support it with no custom code.
- We can still get separate POS and chunk probabilities afterwards (§8).
- It also forces consistency: the model can't predict `VERB` together with `B-NP` unless that pair exists in the label set.

#### Subword tokenization and the `-100` trick

Transformers don't read words. They read **subword tokens** from a fixed vocabulary (WordPiece for BERT and DistilBERT, SentencePiece for DeBERTa). A rare word gets split into pieces, for example `unbelievably` → `un`, `##bel`, `##ie`, `##va`, `##bly`, and special tokens are added at the start and end (`[CLS]` … `[SEP]`).

Labels exist per *word*, so we put each word's label on its **first subword** only. Every other position gets `-100`, which PyTorch's cross-entropy skips by default (`ignore_index=-100`):

```
tokens:  [CLS]  The   old   man   un     ##bel  ##ie  ...  [SEP]
labels:  -100   3     12    7     5      -100   -100  ...  -100
```

#### Windows

Instead of one sentence per example, we pack **consecutive sentences from the same document** into windows of up to 256 subword tokens. That gives the model cross-sentence context (useful for pronouns, ellipsis and headline-style fragments). It also matches how the app runs at inference time.

### 6. The model and the training loop (Phases 6–7)

#### Architecture

Here are the tensor shapes for DistilBERT:

```
input_ids        [B, T]           B = batch (32 windows), T ≤ 256
  → embeddings   [B, T, 768]      token + position embeddings
  → 6 transformer layers (self-attention + MLP), each [B, T, 768] → [B, T, 768]
  → dropout + Linear(768 → L)     L = number of combined labels (~60–90)
  → logits       [B, T, L]
```

The only new parameters are in that final `Linear` layer. Everything else starts from pretrained weights. The other candidates are similar: BERT-base has 12 layers, DeBERTa-v3-xsmall is deeper but narrower and uses a different attention scheme, and ModernBERT has 22 layers.

#### Loss

Expressed in plain PyTorch, one training step is:

```python
logits = model(input_ids, attention_mask=attention_mask).logits      # [B, T, L]
loss = F.cross_entropy(logits.view(-1, L), labels.view(-1), ignore_index=-100)
loss.backward()
optimizer.step(); scheduler.step(); optimizer.zero_grad()
```

Hugging Face `Trainer` is just this loop plus the usual extras: batching, an AdamW optimizer with weight decay, a learning-rate schedule, evaluation, checkpointing, logging and early stopping. It uses MPS automatically.

**A check on the Phase 0 numbers:** the dummy runs ended with loss ≈ 2.3. That's ln(10) ≈ 2.303, exactly what you'd expect from random guessing over 10 random labels. So those runs confirmed the setup works but taught the model nothing, as intended.

#### Hyperparameters

- **Learning rate (5e-5, with 10% warmup and then linear decay).** Fine-tuning uses small learning rates because large updates would overwrite the pretrained knowledge (*catastrophic forgetting*). Warmup avoids large, unstable updates in the first steps, before AdamW's moment estimates have settled.
- **Few epochs, with early stopping on dev chunk F1.** The data is small (~200k training words), so a large model memorizes it quickly. Training stops when dev F1 hasn't improved for 2 evaluations.
- **3 seeds.** Fine-tuning results vary by a few tenths of a point between random seeds, so we report the mean and spread rather than one lucky run.

#### Model selection (Phase 6)

We train every candidate briefly on the same data and seed, then pick the one with the best dev chunk F1 that still fits the size cap and speed budget. A rough size estimate is 1 byte per parameter at int8: DistilBERT's ~66M parameters come to ~65 MB, while its fp32 checkpoint is ~260 MB.

### 7. Evaluation

- **UPOS accuracy** is the share of words with the correct POS. Good English taggers score about 97–98%.
- **Chunk F1** (computed with `seqeval`) is measured on **spans**, not words. A predicted chunk counts as correct only if its type, start and end all match exactly. Precision is correct ÷ predicted chunks, recall is correct ÷ gold chunks, and F1 is their harmonic mean. One wrong boundary word costs the whole chunk.
- **Baselines (Phase 5)** set the bar to beat: wink-nlp + `chunkPatterns.ts` (the app's fallback) and compromise.
- **The test split is used exactly once (Phase 7).** If you check the test score while tuning, you start tuning to it, and it no longer tells you how the model does on new text. All tuning decisions use dev.

### 8. From logits to probabilities (Phase 8)

The app shows alternative parses, so the model's probabilities have to mean something.

**Temperature scaling.** Fine-tuned networks tend to be overconfident: a model that says "0.99" may be right much less than 99% of the time. Temperature scaling fixes this with one scalar T fitted on the dev set (by minimizing negative log-likelihood):

```
p = softmax(z / T)        T > 1 softens overconfident predictions
```

Dividing by T doesn't change which label is highest, so accuracy is unchanged. Only the confidence values change. We report **expected calibration error (ECE)** before and after.

**Splitting the combined label back apart (marginalizing).** To get POS and chunk probabilities separately, sum over the combined labels:

```
P(UPOS = NOUN) = Σ over chunk tags c of P(NOUN|c)      e.g. P(NOUN|B-NP) + P(NOUN|I-NP) + P(NOUN|O) + …
P(CHUNK = B-NP) = Σ over UPOS u of P(u|B-NP)
```

**Ambiguity margin.** If a word's top two labels are within 0.2 of each other in probability, the word counts as ambiguous. The classic example is *Time flies like an arrow*, where *flies* could be `NOUN` or `VERB`. `ambiguity.ts` builds alternative label sequences from those words, throws out invalid BIO sequences, and ranks the rest by joint probability, capped at 5 per sentence. Phase 8 tunes the margin by trading off how often the correct reading appears among the alternatives against how many alternatives users see.

### 9. Getting it into the browser (Phases 9–11)

1. **ONNX export (`optimum-onnx`).** The PyTorch graph is converted to a portable ONNX graph that the browser can run.
2. **Quantization.** Two variants are produced:
   - **int8 dynamic quantization** for WASM/CPU: weights stored as 8-bit integers, about ¼ the size of fp32.
   - **fp16** for WebGPU.
3. **Parity checks.** The ONNX output must agree with PyTorch (≥ 99.9% label agreement for fp32), and quantization may cost at most 0.3 chunk-F1 points.
4. **Shipping.** The ONNX files, the tokenizer files and `labels.json` (label map, temperature T, margin and versions) go into `public/models/enparse-tagger/`, stored with Git LFS.

At runtime, inside the Web Worker:

```
user text
 → textInput.ts: normalize, strip non-Latin, enforce 5,000 chars
 → wink-nlp: sentences + words (+ lemmas)          ← same segmentation as training (Phase 3)
 → Transformers.js tokenizer: words → subwords, packed into 256-token windows
 → ONNX model (WebGPU, else WASM) → logits [T, L]
 → take first-subword logits per word → softmax(z/T) → combined-label probs
 → marginalize → UPOS + chunk tags; group BIO into chunks
 → ambiguity.ts → alternatives → annotator → UI
```

Nothing leaves the browser. The model is downloaded once from the app's own static host and then cached.

### 10. Weak spots and gaps I see in the plan

- **The primary parse can contain invalid BIO sequences.** If each word takes its own top label independently, you can get impossible sequences like `O` then `I-NP`, or `B-NP` then `I-VP`. The plan only validates the *alternatives*. I'd suggest a constrained decode for the primary parse: Viterbi over the per-word probabilities, with a transition mask that forbids invalid moves. It's cheap and usually adds a little F1. This should be decided before Phase 7 evaluation, so the reported numbers match what the app does.
- **Domain shift.** EWT is native-speaker web text, but users will paste textbook English or their own learner English. The Phase 4 augmentation (typos, missing punctuation) partly covers this. Real learner text would make a valuable later regression set.
- **Merging overlapping windows.** Runtime windows overlap, so some words are predicted twice. The rule for combining the two predictions isn't specified yet. A common choice is to keep the prediction from whichever window has the word furthest from its edge.
- **Chunks only, no full tree.** The chunks are flat, so nested structure and attachment (does *on the river* modify *see* or *boat*?) aren't in the model. The rule-based `VP NP PP` alternatives in `ambiguity.ts` are what covers that.

**Correction (added when recorded):** the first bullet in §10 is partly wrong. `src/modules/parser/parser.ts` already plans a **BIO repair** step (task 3: "fix invalid sequences consistently for all backends"), so the primary parse is not left invalid. What is still open is *how* it is repaired. A rule-based fix (for example, turning a stray `I-X` into `B-X`) is what is planned. A constrained Viterbi decode is the alternative I recommend. Choose before Phase 7, because evaluation should use the same decoding as the app. Window merging is planned in `transformerBackend.ts` (task 3), but the merge rule is not yet specified.

---

## 2026-11-18 — Is a "harness" for the model's output already planned?

**Question (Hankyung Lee):**

> I assume the model will output in a preformatted structure. Enparse would then need to include a "harness" module that parses the model's output and converts it into a data structure that is renderable by the GUI. Is this already part of the plan?

**Answer (Claude Opus 5.5):**

**Yes.** It isn't one module, though: the work is split across several files with existing headers. One correction to the assumption: the model doesn't output anything structured. ONNX gives back a raw float tensor of shape `[subword tokens, L]` per window. All the structure comes from our code plus the label map in `labels.json`.

| Step | Where | What it does |
|---|---|---|
| Logits → per-word probabilities | `parser/transformerBackend.ts` | Takes each word's first-subword logits and merges overlapping windows. Then applies the temperature, runs softmax, and sums to get UPOS and chunk probabilities. Keeps the top-k labels for the ambiguity step. |
| Labels → sentences, tokens, chunks | `parser/parser.ts` | Groups BIO tags into chunks and repairs invalid BIO sequences for every backend. Marks the result as model or basic mode. |
| Alternatives | `parser/ambiguity.ts` | Builds alternatives from close probabilities and the PP-attachment rules, capped at 5 per sentence. |
| Parse result → renderable model | `output/annotator.ts` | Builds a render-ready structure: stable ids for React and word selection, chunk display data, alternatives with rank and reason, the mode, and lemma data for dictionary lookups. |
| Wiring | `services/parserService.ts` → `useParser` → `OutputPage` | Chains the steps above and passes the result to the page. |

`output/` isn't allowed to import `parser/`, so `annotator.ts` defines its own input type with the same shape as `ParseResult`. The service passes the result across.

What's still missing is the **contracts**:

- **The types themselves.** `ParseResult`, `Token`, `Chunk` and the annotation types are only described in file headers. They're tracked under *Undecided → Module interfaces*.
- **The `labels.json` schema** (label map, temperature, margin, versions). This is shared by both sides: `prepare_data.py` and `calibrate.py` write it, and the app reads it. It should be fixed by Phase 4, well before the app types are needed.
- **The BIO repair method** (simple rules or a constrained Viterbi decode) **and the rule for merging overlapping windows.**

**Follow-up (2026-11-18):** the `labels.json` schema (v1) is now defined in `plan-training.md` → Phase 4.

---

## 2026-11-18 — What plan changes are needed to collect user feedback as training data?

**Question (Hankyung Lee):**

> After Enparse reaches its beta status, I would like to collect users' feedback and use it as further training data for improving its performance. Describe what changes need to be made to the current plan so that it would support save/exportable extra training data. Disregard user agreement as I plan to conduct beta tests only among trusted colleagues.

**Answer (Claude Opus 5.5):**

The fully client-side design actually fits this well. Feedback stays in the browser, and colleagues **export a file** and send it to you. No network call or backend is needed. Phase 12 already mentions this idea briefly but marks it "not yet planned". These are the changes I'd make:

### a. Define what a feedback record contains

One record per corrected sentence, exported as versioned JSONL:

- **The text and wink's word split** (tokens with character offsets). Storing the exact words keeps training aligned with Phase 3 even if wink changes later.
- **The model's prediction** (labels, and ideally the top-k probabilities), plus **the corrected labels with a per-word `reviewed` flag**.
- **The feedback type**:
  - *picked alternative N*: cheap and high-value, since the user just confirms one of the alternatives we already show
  - *edited labels*
  - *confirmed correct*
  - *flagged wrong, no fix*: useful for analysis only
- **Context and versions:** a passage/document id with neighbouring sentences (training uses multi-sentence windows), the model version, `labels.json` version, wink version, app version, which backend produced the parse, the contributor's pseudonym, a timestamp and an optional note.

The key training detail is **partial labels**. Words the user didn't review get `-100`, exactly like non-first subwords, so the loss only uses labels a person actually checked. A sentence marked *confirmed* counts as fully labelled.

### b. App changes (`architecture.md`)

- **New module `modules/feedback/`:** creates, lists and deletes records. It also validates corrections: only valid BIO, and only label combinations that exist in `labels.json`. It handles export/import with a schema version and stores records in IndexedDB through `core/storage`.
- **`services/feedbackService.ts` and `hooks/useFeedback.ts`**, following the existing layer rules.
- **UI:**
  - a correction mode on `OutputPage` (change a word's POS, move chunk boundaries or change their type, "this alternative is correct", "parse is correct")
  - a `FeedbackPage` listing records with an export button, plus its route and sidebar link
- **Unchanged:** the no-network rule still holds, because export is a file download.

### c. Training changes (`plan-training.md`)

- **Annotation guidelines for colleagues.** Turn the Phase 2 chunk rules into a short guide written for people. Without it, corrections won't match the chunk definition the model is trained on, and the extra data will add noise. This matters more than any of the code.
- **New script `scripts/ingest_feedback.py`:**
  - validate files against the schema and remove duplicates across contributors
  - re-check the word split against the pinned wink version
  - collect conflicting corrections of the same text for adjudication
  - output the same processed format as Phase 4, with the `-100` mask
  - store batches in `data/feedback/` (git-ignored), with each batch's version and checksum recorded in a config file
- **Phase 4 change:** `prepare_data.py` must accept partial labels. If this is built in from the start, it costs almost nothing.
- **Splits:**
  - hold out part of the feedback (around 20–30%) as a **feedback test set**, split by passage rather than by sentence so nothing leaks between train and test
  - leave the EWT test split untouched and report both scores
  - corrections are mostly examples the model got wrong, so feedback scores will be biased low and can't be compared directly with EWT scores
- **Mixing:** the feedback set will be tiny next to EWT's ~200k words, so oversample or weight it. Keep it only if feedback scores improve and EWT dev F1 doesn't drop. This is the same keep/drop rule as augmentation in Phase 7.
- **Phase 12:** turn it into a concrete retrain loop with a trigger (it currently says ~200 sentences). Record the feedback-data version in `MODEL_CARD.md` and `labels.json`.

### d. Licensing caveat

Skipping a user agreement is your call. Copyright in the *pasted text* is a separate issue, though: textbook passages or news articles belong to their publishers, and your trained weights would ship to everyone. The ingest script could store only the corrected sentences, or the guidelines could ask colleagues to submit text they wrote or text that's openly licensed. This also adds to the Phase 1 CC BY-SA question, since the combined dataset would mix EWT with other text.

### e. What to do now, before beta

Most of this can wait until after beta. Three things are cheap now and expensive to retrofit later:

- include the model version and wink word offsets in `ParseResult`
- support partial labels in `prepare_data.py`
- fix the `labels.json` schema by Phase 4

**Follow-up (2026-11-18):** all three items in §e were added to `plan-training.md` (Phases 3, 4, 11 and 12) and `architecture.md` → *Model*. Sections a–d are not yet in the plan.

---

## 2026-11-19 — What can be implemented in parallel during Phase 7, and what conflicts might arise later?

**Question (Hankyung Lee):**

> Review the overall development plan, and list what can begin implementation in parallel while training Phase 7 continues. Ensure the candidates you choose are independent from, or adjustable based on the potential architectural changes that might occur as model training continues and finishes. Additionally, report if you find any potential conflicts that might arise during any step(s) later on in development.

**Answer (Antigravity):**

### Current Baseline

Only 10 files under `src/` have code implemented (`src/index.html`, `src/modules/input/`, and `src/modules/parser/{types,winkBackend,treeDecoder}.ts` plus their tests). The remaining **75 files in `src/` are header-only stubs**, and React, React Router, ESLint, Prettier, and React Testing Library are not yet installed in `package.json`.

Because Phase 7 still has an upcoming **biaffine dependency head + MST decoder** change (plus Phase 8 calibration, Phase 9 quantization/fp16-only fallback risk, and Phase 10 browser benchmarking), parallel work should focus on everything decoupled from model tensor formats and threshold constants.

### 1. What Can Start Immediately in Parallel

#### Tier A — Fully Independent of Model Training & Architecture (Zero Rework Risk)

1. **Frontend Tooling & App Shell** *(requires owner sign-off on React/tooling deps in `plan.md` → Tooling and `package.json`)*
   - Install `react`, `react-dom`, `react-router-dom`, `@vitejs/plugin-react`, ESLint + Prettier, and React Testing Library; wire `npm run lint` and `vite.config.ts`.
   - Build `src/css/tokens.css`, `src/css/global.css`, `src/main.tsx`, `src/routes.tsx`, `src/components/App.tsx`, `Layout/` (`Layout`, `Header`, `Sidebar`, `ContentArea`), and `Shared/` (`Button`, `Modal`, `Tooltip`, `LoadingSpinner`).
   - Add an **Attribution** view/modal (required for UD EWT CC BY-SA 4.0 and model licenses before Phase 11; currently missing from the skeleton, tracked in `plan.md` → UI/UX).
   - Build `src/components/Pages/InputPage.tsx` — its backing module `src/modules/input/textInput.ts` is already complete.

2. **Core Infrastructure (`src/core/` & `src/utils/`)**
   - `src/utils/helpers.ts` — string normalization, ISO date formatting, `debounce`/`throttle`, and unit tests.
   - `src/core/storage.ts` — async LocalStorage/IndexedDB wrapper with namespacing, schema versioning, typed errors, and configurable `STORAGE_SIZE_THRESHOLD`.
   - `src/core/environment.ts` — browser capability probes (`moduleWorkers`, `wasmSimd`, `wasmThreads`, `webgpu`, `deviceMemory`, `storage.estimate`, `cacheStorage`) and Cache Storage helpers (`listCached`, `downloadToCache`, `digestCachedFiles`, `deleteCachedFiles`). *(Make allowed asset origins configurable rather than strictly hardcoding same-origin; see Conflict #1 below.)*

3. **Vocabulary Lists (Complete Vertical Slice)**
   - `src/modules/vocab/` → `src/services/vocabService.ts` → `src/hooks/useVocab.ts` → `src/components/Pages/VocabPage.tsx`.
   - Completely independent of the parser. Only needs confirmation of open schema/export/conflict items in `plan.md` → Vocabulary lists.

4. **Subword Parsing (Complete Vertical Slice)**
   - `src/modules/subword/affixes.ts`, `subwordParser.ts` → `src/services/subwordService.ts` → `src/hooks/useSubword.ts`.
   - Consumes only `(word, lemma)` from `wink-nlp` (already pinned at `2.4.0`) and an injected `isKnownWord` predicate. Zero neural-model dependency. *(Resolve Conflict #4 first regarding where `isKnownWord` gets its word list.)*

5. **Static Dictionary & Offline Build Pipeline (Complete Vertical Slice)**
   - Decide data sources/licensing and storage format (`plan.md` → Dictionary), build the offline dictionary compiler, and implement `src/modules/dictionary/` → `src/services/dictionaryService.ts` → `src/hooks/useDictionary.ts` → `src/components/Pages/DictionaryPage.tsx`.
   - Completely independent of parser training (headword alignment only depends on already-pinned `wink-nlp` lemmas).

#### Tier B — Safe to Build Now Using Mocks / Configurable Contracts (Easily Adjustable)

6. **Pre-flight Module & Diagnostics UI**
   - `src/modules/preflight/` (`checks.ts`, `requirements.ts`, `preflight.ts`) and `src/components/Shared/DiagnosticsPanel.tsx`.
   - Pure check logic and verdicts are model-agnostic; Phase 10 only fills in numeric thresholds in `requirements.ts` (`TODO(preflight-thresholds)`). Keep `ModelManifest` version validation ready for a `labels.json` schema bump (v1 → v2).

7. **Model Library Module & `ModelsPage` (Against a Fixture `catalog.json`)**
   - `src/modules/modelLibrary/` (`catalog.ts`, `downloads.ts`, `selection.ts`) → `src/hooks/useModelLibrary.ts` → `src/components/Pages/ModelsPage.tsx`.
   - Design for upcoming changes: make `variants.int8` and `variants.fp16` individually optional (in case ModernBERT ships fp16-only), allow multi-file ONNX artifacts (`.onnx` + `.onnx_data` if split), and support the updated nested-view metrics (see Conflicts #6 and #7).

8. **Output Annotator & `OutputPage` (Against Mock `ParseResult` Fixtures)**
   - `src/modules/output/annotator.ts` and `src/components/Pages/OutputPage.tsx`.
   - Flat chunk display, nested `SentencePhrases` rendering, word selection, inline dictionary/subword lookup, and alternative switching all operate on `ParseResult` / `SentencePhrases`, not raw ONNX logits. Even when the biaffine head + MST + confidence-gated bracket collapsing lands, `treeDecoder.ts` still outputs `SentencePhrases` (collapsed brackets simply appear as `WordLeaf` items inside their parent `PhraseNode`).

9. **Parser Orchestration Shell (With a Mocked `ParserBackend`)**
   - Finalize `ParseResult` / `SentenceParse` / `Token` types in `src/modules/parser/types.ts`, implement BIO grouping & repair in `src/modules/parser/parser.ts`, build the worker message protocol & readiness guard (`ParserNotReadyError`) in `src/modules/parser/parser.worker.ts`, and wire the state machine in `src/services/parserService.ts` + `src/hooks/useParser.ts`.

#### What to Defer Until Phase 7 (Biaffine) & Phases 8–10 Finish

- **`src/modules/parser/transformerBackend.ts`** — tightly coupled to single- vs. dual-output ONNX (`logits` + `arc_scores`), Transformers.js `model.forward()` behavior, `labels.json` schema, and window merging.
- **`src/modules/parser/ambiguity.ts`** — attachment alternatives will switch from top-two `rel_pos_v1` labels to biaffine arc-score margins / alternative MSTs, and margins come from Phase 8.
- **Rewriting `src/modules/parser/treeDecoder.ts`** — wait until the biaffine head's exact output shape (word-level vs. subword-level `[T, T]` arc scores) and Phase 8 confidence-gating rule are defined.

### 2. Potential Conflicts & Risks Later in Development

#### High-Impact Conflicts

1. **Same-Origin-Only Network Rule vs. Model/Dictionary Hosting & COOP/COEP**
   - **Conflict:** `agents.md` and `src/core/environment.ts` prohibit non-same-origin requests (`fetchStaticJson` rejects other origins). Yet all four models total **~1.2 GB** (~0.4 GB int8 + ~0.8 GB fp16), exceeding GitHub's free Git LFS quota (1 GB storage / 1 GB monthly bandwidth) and typical static-host file caps (e.g., Cloudflare Pages' 25 MB per-file limit), while `plan.md` also considers hosting dictionary shards on GitHub raw or a CDN.
   - **Compounding issue:** If Phase 10 shows multi-threaded WASM (`SharedArrayBuffer`) is needed to meet the 5 s budget, the app host must send `COOP: same-origin` + `COEP: require-corp` headers — which **GitHub Pages does not support**, and which will block cross-origin model/dictionary fetches unless the asset host returns `Cross-Origin-Resource-Policy: cross-origin` (and CORS headers).
   - **Mitigation:** Decide the hosting topology before implementing `core/environment.ts` (e.g., Cloudflare Pages + Cloudflare R2 mapped to a same-origin path `/models/*`, or an explicit static-asset origin allowlist for Hugging Face Hub with CORP/CORS verification).

2. **Biaffine Head Upgrade Breaks Current ONNX, Transformers.js, Window-Merging, and `labels.json` v1 Contracts**
   - **Schema break:** `src/modules/parser/types.ts` (`LabelConfig`), `src/modules/preflight/types.ts` (`ModelManifest`), and `plan-training.md` (Phase 4) assume `labels.json` v1 (`dep_encoding: "rel_pos_v1"`, single `logits`, two temperatures). The biaffine head introduces a second ONNX output (`arc_scores`), relation-only Group B logits, arc vs. relation temperatures, and a bracket confidence threshold — requiring a coordinated `schema_version: 2` bump (and updating the `preflight` ↔ `parser` schema-version parity test together).
   - **Transformers.js / Optimum risk:** Standard `optimum-onnx --task token-classification` only exports a single `logits` tensor, and Transformers.js's `*ForTokenClassification` discards extra outputs (`plan-training.md`). Before retraining all 4 models with a biaffine head, run a 1-epoch smoke test verifying that a custom ONNX export with `logits` + `arc_scores` actually exposes both tensors via Transformers.js 4.3.2 (`model.forward()` or raw `onnxruntime-web` session) and quantizes cleanly to `int8`/`fp16`.
   - **2D pairwise window-merging problem:** Merging 1D per-token `logits` across overlapping 256-token windows is straightforward, but biaffine `arc_scores` is a **2D `[T, T]` matrix** per window. If a long sentence crosses a window boundary (or multiple wink sentences share a window — 306 EWT train UD sentences had 719 cross-wink-sentence arcs in Phase 3), training and runtime must agree on whether arc scoring is masked per sentence or per window, and how overlapping 2D scores merge.

3. **Cache Storage Desync & Browser OOM Risk Between `modelLibrary` and Transformers.js**
   - **Conflict:** `src/modules/modelLibrary/downloads.ts` plans to download and hash ONNX files directly into Transformers.js's Cache Storage (`transformers-cache`) so `transformerBackend.ts` hits the cache later.
   - **Two pitfalls:** (1) Transformers.js 4.3.2 constructs cache keys internally based on `env.localModelPath`, `base: "./"`, and the Web Worker's URL base — any URL normalization mismatch causes a silent cache miss and a duplicate 70–300 MB download (or offline failure). (2) Hashing a 300 MB `fp16` ONNX file via `crypto.subtle.digest` in `core/environment.ts` requires holding the entire uncompressed `ArrayBuffer` in JS heap (plus a copy for `Cache.put`), risking OOM on mobile or 8 GB browsers.
   - **Mitigation:** Spike a minimal Vite worker + Transformers.js cache-hit test early (can reuse Phase 7 smoke ONNX files) and check whether streaming SHA-256 or splitting `.onnx` + `.onnx_data` is needed.

4. **`subwordService` Known-Word Validation Conflicts With Strict Layer Isolation**
   - **Conflict:** `architecture.md` forbids both module→module imports (`subword/` cannot import `dictionary/`) and service→service imports (`subwordService` cannot import `dictionaryService`). Yet `plan.md` leaves open passing dictionary headwords to `subwordParser` via `subwordService`. Importing `modules/dictionary` directly from `subwordService` breaks single-owner caching of dictionary shards; not doing so leaves `subwordService` without access to dictionary headwords.
   - **Mitigation:** Bundle a tiny static known-lemma list (e.g., compressed word set / trie) directly inside `src/modules/subword/`, or explicitly wire the predicate at the hook layer.

5. **Direct Lookups on `DictionaryPage` Have No Access to `wink-nlp` Lemmas**
   - **Conflict:** `plan.md` relies on `wink-nlp` to lemmatize inflected words (*ran* → *run*) before dictionary lookup. Parsed words on `OutputPage` carry wink lemmas from `parser.worker.ts`, but a user typing *"ran"* directly into `DictionaryPage.tsx` has no wink lemma — and importing `winkBackend` on the main thread would duplicate the **1.0 MB gzipped** `wink-nlp` bundle outside the worker and violate the worker-only rule.
   - **Mitigation:** Include an inflection→headword index inside the static dictionary database itself so `dictionary/staticDb.ts` resolves inflected queries standalone.

#### Medium-Impact Spec Drifts & Edge Cases

6. **Single-Variant (`fp16`-Only) Models Break `CatalogEntry` Types**
   - `plan-training.md` flags that ModernBERT may ship as **fp16 (WebGPU) only** if int8 parity fails in Phase 9, yet `src/modules/modelLibrary/types.ts` and `architecture.md` require both `int8` and `fp16` in `variants`. Make both optional and ensure `preflight/assessModels()` marks fp16-only models as `blocked` when WebGPU is unavailable.

7. **Stale Thresholds Across `dev_meta/` and Stubs**
   - Nested-view acceptance was updated on 2026-11-19 to **UAS (excl. punct) ≥ 93%, multi-word labeled bracket F1 ≥ 88%, shown-bracket precision ≥ 95%** (`plan-training.md`, `architecture.md`), but `architecture.md` (`catalog.json` schema), `plan-training.md` (Phase 7 exit criterion), and `src/modules/modelLibrary/types.ts` still reference the old `UAS ≥ 97% / LAS ≥ 94%` rule and omit `nested_f1` / `shown_bracket_precision` from `catalog.json → metrics`. Likewise, `plan-training.md` → *Open questions* still marks the decided flat thresholds (`97% / 94%`) as proposed.

8. **Train/Eval vs. Runtime BIO Repair & Window-Merge Rule Still Undefined**
   - Neither the **BIO repair method** (simple rule vs. constrained Viterbi) nor the **overlapping window merge rule** is locked down. If `parser.ts` repairs BIO sequences differently from `training/scripts/metrics.py`, Phase 9/11 parity tests and reported chunk F1 will diverge slightly from browser output.

9. **TypeScript 7.0.2 / Vite 8.3.8 Peer-Dependency Risk When Adding React & ESLint**
   - `package.json` pins `typescript: 7.0.2`, `vite: 8.3.8`, and `vitest: 5.1.0`. Before adding ESLint/Prettier/`@vitejs/plugin-react`/RTL, verify plugin compatibility (especially `typescript-eslint` with TypeScript 7) so tooling setup does not force a version downgrade or lockfile drift from `training/js/package.json`.

10. **Open Product Decisions Blocking UI Polish**
    - `plan.md` still has undecided UX items (UI language, Korean vs. English grammar labels, mobile vs. desktop support, vocab schema/Anki export, dictionary data sources). Following `agents.md`, keep all component strings centralized in per-file `strings` constants so i18n/Korean translation can drop in cleanly later.

## 2026-11-19 — Todo.md Stage 0 [Decision] items

**Question (Hankyung Lee):**

> Review the Stage 0 [Decision] items in todo.md. For each [Decision] item, review all relevant files and structures and list all viable options. Specify for each option whether you recommend it or not, and provide reasons for why, such as long-term maintainability, cross-module effects, etc. I will review your output and choose the options I determine to be most appropriate.

**Answer (Claude Opus 5.5):**

I've reviewed the 23 open Stage 0 Decision tasks (T03 is done). For each, ✅ means I recommend it, ➖ means it's viable but not my first choice, and ❌ means I recommend against it. I haven't changed any files; once you choose, I'll record the decisions and close the tasks.

## Findings that affect several decisions

- **ESLint can't run on our TypeScript.** typescript-eslint 8.73 (the TypeScript plugin for ESLint) requires TypeScript below 6.1. Our pinned TypeScript 7.0.2 is the new native build and doesn't provide the interface typescript-eslint uses. This affects T13.
- **React and React Router have moved on.** The latest React is 19.3.1, while `architecture.md` says "React 18+". The router's main package is now `react-router` 8.5.2, which requires React ≥ 19.2.7. The `react-router-dom` package in our docs is stuck at 7.x. `@vitejs/plugin-react` 6.3 supports Vite 8.
- **The current chunk F1 already matches the simplest BIO repair.** seqeval's default mode treats a stray `I-X` as the start of a new chunk, which is exactly what a simple "turn it into `B-X`" repair does (T08).
- **Training and the planned runtime split text into windows differently.**
  - Training packs whole sentences into each window, with no overlap (~10 sentences per window). Only a sentence longer than 256 subword tokens is split, with overlap, and none needed it.
  - The `transformerBackend.ts` header plans overlapping windows at runtime.
  - This affects T04 and T08.
- **GitHub Pages can't host the models.** Its total site limit is 1 GB, and the four models total about 1.2 GB. It also can't send the COOP/COEP headers that multi-threaded WebAssembly needs. GitHub's Git LFS free quota is now 10 GiB storage and 10 GiB bandwidth per month, so LFS itself is no longer the bottleneck. The repo is on GitHub.
- **Two stale details I noticed:**
  - The `OutputPage.tsx` header still lists a "Basic-mode notice", but there is no fallback mode.
  - The catalog descriptions exist for DistilBERT and BERT, but both currently miss the UPOS ≥ 97 threshold (96.67 and 96.89), so neither would be offered as things stand.

---

## [Training]

### T04 — Biaffine arc-score scope and window merging
**a. Which words can be scored as a word's head**
- ✅ **Only words in the same sentence (UD sentence in training, wink sentence at runtime), plus a root token.** This matches the Phase 3 decision, is what the current tree decoder already does, and keeps each tree to one sentence.
- ➖ **Re-split the training trees at wink's sentence boundaries**, so training and runtime see the same sentences. It removes a mismatch for the ~4.7% of sentences wink splits, but it reverses a Phase 3 decision and changes the data. Worth doing only if Phase 7 shows that mismatch matters.
- ❌ **Any word in the window.** It can produce trees that span sentences, which the nested view can't show, and it wastes model capacity.

**b. Word-level or subword-level score matrix**
- ✅ **Subword-level `[T, T]` scores.** The training loss and the runtime read only first subwords. The exported model keeps the standard `input_ids`/`attention_mask` inputs, so Transformers.js can call it without custom inputs. The output is 256×256 floats per window (~256 KB). T05 should confirm this.
- ➖ **Word-level `[W, W]` scores**, gathered inside the model. This is the textbook design and gives a smaller matrix, but it needs an extra word-index input, which Transformers.js may not pass through, plus more custom export work.

**c. Long sentences that span two windows**
- ✅ **Runtime packs whole sentences into windows exactly like training.** Only sentences over 256 subword tokens use overlapping windows. For those, each word's head scores come from the window where that word sits farthest from the edge, and heads outside that window score −∞ (very rare).
- ➖ **Average the overlapping scores.** It's simple, but the averaged scores no longer match what calibration measured.
- ❌ **Overlapping windows for all text.** It differs from training and forces 2D merging for every sentence.

### T06 — Learner-style noise augmentation
- ✅ **Run `lowercase_sentence_start` + `drop_final_punct` as an experiment in the biaffine retrain.** Both are already implemented and disabled. Learners often paste text without capitals or final punctuation. Keep them only if dev scores don't drop, as Phase 4 says.
- ➖ **Also add `learner_typos`.** It needs a typo list with a compatible license (there's a TODO for it) and more work. Better as a v2 experiment.
- ➖ **Drop augmentation for v1.** It's the least work, but the domain-shift risk the plan identified stays open.

### T07 — Proposed Phase 7 settings
- ✅ **Confirm both: the selection score (mean of dev chunk F1 and LAS) and the λ already fixed.** λ moved dev scores by at most 0.4 points, and the extended stage already reuses the base choice. Settling the selection score now means the retrain compares like with like.
- ➖ **Score selection on the nested-view targets** (UAS without punctuation + multi-word bracket F1). This fits the goal better, but those metrics aren't computed during training (only at evaluation). It would need training-code changes before the retrain.
- ❌ **Re-sweep λ for the biaffine head.** The head changes, but λ had almost no effect before, and the sweep costs hours per model.

### T08 — BIO repair and window merge
**BIO repair**
- ✅ **Rule repair: a stray `I-X` becomes `B-X`.** It's identical to how seqeval already scores chunks, so the reported F1 equals what the browser shows, and no metric changes are needed.
- ➖ **Constrained Viterbi decoding** over the group A labels with a mask that forbids invalid sequences. It usually gains a little F1 and can also fix the UPOS tag on the same word. It must be added to `metrics.py` and the app together, and all reported numbers re-measured. Good as a later experiment.

**Window merge:** ✅ **Pack whole sentences exactly like training** (same as T04c). This also cuts runtime work. Overlapping windows with a "farthest from edge" rule are ➖: viable, but they differ from training.

---

## [Modules/parser]

### T09 — Input limit defaults
- ✅ **Keep 5,000 characters and 5 alternatives.** The speed budget is set per 5,000 characters, Phase 10 measures at that size, and 5 is already `MAX_ALTERNATIVES`.
- ➖ **A smaller limit (e.g., 2,000)** for mobile, if Phase 10 shows slow phones. It can be lowered later without code changes because it's a constant.
- ❌ **No limit.** It risks running out of memory on large pastes, and the result would be hard to read anyway.

### T10 — Approve phraseLabeler.ts and its conventions
- **Module:** ✅ approve it. Without it, the view has only bracket types (NP, VP…) and no roles. Roles are the main teaching value for learners, and the labeler is deterministic over the model's tree, so it fits the no-hand-written-grammar rule. ❌ Rejecting it would drop "Subject/Object" labels from the product.
- **Role set:**
  - ✅ A small school-grammar set: Subject, Predicate, Object, Indirect Object, Complement, Modifier (adjective/adverb-type), plus labels from the T03 subtypes (Passive subject, *by*-agent, Relative clause, Possessive, Particle).
  - ➖ A fuller, more traditional grammar set (e.g., subject and object complements separated). More teaching value, but more rules that depend on relations the model may get wrong.
- **Clause convention:** ✅ Promote subject + predicate to `S` (Clause). This matches how Korean school grammar teaches 주어 + 서술어, and it makes embedded clauses visible.
- **Single-word head wrappers** (`[dog]` inside `[red dog]`):
  - ✅ Collapse them for display. They add bracket noise with no teaching value, and the multi-word metric already ignores them.
  - ➖ Keep them, but only in an "expert" toggle.
- **Discontinuous predicates** (questions, inversion, fronted adjuncts):
  - ✅ Highlight the pieces with the same role color/label and a "split predicate" note, without inventing a contiguous bracket.
  - ❌ Force a contiguous bracket. It would show learners a wrong structure.
- **Copula** (*is*, *was*):
  - ✅ `cop` + the predicative word → `VP(Predicate)`, with the adjective or noun labeled `Complement`. This is how learners are taught it (2형식 = sentence pattern 2).
  - ➖ Mirror UD literally, with the adjective as the head. That's confusing for learners.
- **Coordination:**
  - ✅ The outer bracket of the conjoined phrases takes the shared role, and the conjuncts are marked as coordinated.
  - ❌ Labeling the second conjunct a modifier of the first (UD's literal structure) is wrong for learners.

### T11 — How alternatives are displayed
- ✅ **The primary parse is shown, with an "other readings (n)" control per sentence that switches the whole view.** Ambiguous words or phrases are marked in the primary view. This is simple, accessible, and fits per-sentence alternatives, capped at 5.
- ➖ **Show alternatives side by side.** It's easy to compare, but cluttered with 5 alternatives and on mobile.
- ➖ **Show a PP-attachment-only toggle** (e.g., "*on the river* modifies *see* / *boat*"). Very clear for the main ambiguity type, but it doesn't cover label alternatives.
- ❌ **Hide alternatives behind a settings page.** That defeats the "ambiguous sentences show multiple parses" core feature.

---

## [Project]

### T12 — Deployment target and asset hosting
- ✅ **Cloudflare Pages for the app + R2 for models and dictionary shards, served on the same origin through a Pages Function at `/models/*`.**
  - The same-origin rule in `agents.md` stays as it is.
  - `_headers` can send COOP/COEP, so multi-threaded WebAssembly is possible.
  - R2 has no egress fees and a free storage tier.
  - Pages' 25 MiB per-file limit doesn't apply to R2 objects.
  - LFS stays the source of truth for model files.
  - Cons: vendor lock-in, Function request quotas, and Range-request streaming must be verified (T31).
- ➖ **Cloudflare Pages alone, with ONNX split into ≤ 25 MiB external-data pieces.** Pure static hosting with no Function. But it needs multi-piece external-data support in ONNX Runtime and Transformers.js (unverified) and many files per model.
- ➖ **Netlify or Vercel.** Both support custom headers. Their per-file and bandwidth limits for ~1.2 GB of models need checking, and they have no equivalent of R2's free egress.
- ❌ **Host the models on Hugging Face Hub.** Transformers.js supports it natively, but:
  - it breaks the same-origin rule;
  - every user's IP goes to a third party;
  - COEP needs the hub to send CORP headers (unconfirmed) or `credentialless` mode (not in Safari).
- ❌ **GitHub Pages.** The 1 GB site limit, no custom headers, and Pages doesn't serve LFS content directly.

### T13 — Tooling and frontend dependencies
**React and router**
- ✅ React 19.3 with `react-router` 8 (`createHashRouter`). These are current and supported. Update `architecture.md` from "React 18+ / react-router-dom".
- ❌ React 18 with `react-router-dom` 7. That's already the legacy line, and we'd face a migration soon.

**Build plugin:** ✅ `@vitejs/plugin-react` 6.3, which supports Vite 8.

**Lint and format**
- ✅ **Biome** (one tool for both, MIT/Apache, no TypeScript dependency, includes a hooks-dependency rule). It works with TypeScript 7 today.
- ➖ **oxlint (+ Prettier).** Fast, MIT, with React and react-hooks rules. Type-aware rules come from a separate tool built on TypeScript 7; check how mature it is first.
- ❌ **ESLint + typescript-eslint** (the current proposal). It's blocked by TypeScript 7. It would need a second TypeScript 6.0 in a separate lint package, which means two compilers that can drift apart.

**Component tests**
- ✅ React Testing Library 16 + jsdom under Vitest. This is the existing proposal and the standard choice.
- ➖ Vitest browser mode. It runs in real browsers, but it's heavier and needs Playwright.

**End-to-end tests**
- ✅ Playwright (Apache-2.0). It's the only one that easily covers Chrome, Firefox and WebKit, which matters for WebGPU and WebAssembly.
- ➖ Cypress. Its WebKit support is weaker.

**CI**
- ✅ GitHub Actions, since the repo is already on GitHub. Check out without LFS (`lfs: false`) so CI doesn't use LFS bandwidth.
- ➖ Local checks only (pre-commit hooks). That works for a single developer, but nothing catches what's missed.

### T14 — MVP scope and milestone order
- ✅ **M1: model library + parse + flat/nested views (no alternatives) → M2: alternatives + dictionary → M3: vocab + subword.** The parser is the core value and the longest path, so it ships first. Dictionary data and licensing (T25) can settle in the meantime.
- ➖ **M1 includes the dictionary.** More useful as a learning tool from day one, but it's blocked on the data-source decision.
- ❌ **Everything at once.** It's the longest time to any usable build, with no early feedback from colleagues.

### T15 — Offline / PWA
- ✅ **No PWA for v1, but don't rule it out.** Models are already cached in Cache Storage. Only the small app shell would need a service worker, which can be added later with `vite-plugin-pwa` (MIT, supports Vite 8).
- ➖ **Full PWA in v1.** Useful for studying offline, but the service worker must not conflict with Transformers.js's cache (an added risk on top of T31), and it adds update and stale-version handling.

### T16 — Project license
- ✅ **MIT** for the app code. It matches the permissive dependency policy and makes reuse simple. Models stay CC BY-SA 4.0 and dictionary data keeps its own licenses, documented separately.
- ➖ **Apache-2.0.** Adds an explicit patent grant. A good choice if you expect outside contributors.
- ➖ **All rights reserved (proprietary).** Keeps commercial options fully open. The CC BY-SA obligations on the models and EWT-derived data still apply.
- ❌ **GPL/AGPL.** Allowed for your own code, but it limits reuse and adds nothing here.

### T17 — Analytics and privacy
- ✅ **No tracking at all** (confirm the current `agents.md` rule). It fits "fully client-side, no network calls". The beta feedback plan (T44) already works by having users export a file.
- ➖ **Local-only usage stats** shown to the user (e.g., words looked up), never sent anywhere.
- ❌ **Any remote analytics.** It breaks the network rule and adds a privacy notice.

---

## [UI]

### T18 — Interface language and grammar labels
- ✅ **Korean UI with English kept in grammar labels, e.g. "명사구 (NP)" and "주어 (Subject)".** The target users are beginner-to-intermediate Korean speakers. Keeping the English term also teaches the vocabulary used in English materials. Strings are already centralized per file.
- ➖ **Bilingual with a toggle.** Flexible, but it needs i18n infrastructure (a dependency or our own) and every string written twice.
- ❌ **English-only UI.** It's a barrier for beginners.

### T19 — Target devices, browsers, and accessibility
- ✅ **Responsive layout, but desktop/laptop is the primary target.** Phones are supported only with the smallest offered model, as pre-flight allows. Support the last two versions of Chrome, Edge, Firefox and Safari. Target WCAG 2.1 AA.
  - Why: model sizes of 66–300 MB and the 5 s budget favor laptops.
  - Mobile Safari memory limits are strict.
  - AA is the common standard, and `agents.md` already requires keyboard access.
- ➖ **Desktop only.** Simpler layout, but students often study on phones.
- ➖ **WCAG 2.2 AA.** Newer, slightly stricter; little extra cost if adopted from the start.

### T20 — Visual design
- ✅ **Flat view: color-coded chunk highlights with type labels. Nested view: nested boxes or indented brackets with role badges.** A colorblind-safe palette, with type also shown as text, not only color. Learners read this easily, it works with the keyboard, and it fits mobile.
- ➖ **A drawn dependency or constituency tree diagram.** Precise, but hard for beginners, hard on mobile, and hard to make accessible.
- ➖ **Plain bracket text.** Easy to build, poor for learners.
- Branding and palette are your call; I'd start from neutral tokens.

### T21 — Attribution display
- ✅ **An "About & licenses" page** (route + sidebar link) listing app, model, data and dictionary sources and their licenses. It also shows each model's license and source on its model card. CC BY-SA needs visible attribution, and one page scales as dictionary sources are added.
- ➖ **A footer link to a modal.** Less navigation, but a cramped place for the growing list of sources.
- ❌ **README/MODEL_CARD only.** That doesn't count as attribution shown to users of the deployed app.

---

## [Modules/modelLibrary]

### T22 — Recommendation rule and model card presentation
**Rule**
- ✅ **Confirm the proposed rule:** among models not blocked and without memory warnings, the highest chunk F1 that meets the 5 s budget, with ties going to the smaller download. It's simple and uses measured data.
- ➖ **Rank by nested-view availability first.** Better if the nested view becomes the main feature, but no model qualifies yet.
- ➖ **Always recommend the smallest model.** Safe, but it would steer users away from accuracy.

**Card presentation**
- ✅ A label first ("가장 정확함 / Most accurate", "가장 빠름 / Fastest"), with numbers (UPOS, chunk F1, size, expected speed on this device) behind a "details" toggle. Learners understand labels; numbers stay available.
- ➖ Numbers only. Transparent, but meaningless to most learners.

### T23 — catalog.json schema changes
- ✅ **Accept all three proposals:**
  1. int8 and fp16 variants each optional (ModernBERT may ship fp16 only);
  2. multi-file ONNX (`.onnx` + `.onnx_data`);
  3. the nested-view metrics added to `metrics`.
  Adding fields doesn't break schema v1 if the new fields are optional. They cover the known Phase 9 risks before `catalog.ts` is written.
- ➖ **Accept only the metrics now** and defer the variant change until Phase 9. Less work now, but it may mean a breaking change after `catalog.ts` exists.

---

## [Modules/preflight]

### T24 — Pre-flight policies
- **Scope:** ✅ Confirm all proposed checks. Each one maps to a real failure mode, and all are cheap.
- **Low memory:**
  - ✅ Warn. Memory hints exist only in Chromium, and they're rough; the real test is the load plus self-test.
  - ❌ Block. It would turn away capable Safari and Firefox users.
- **Low storage:**
  - ✅ Warn, and call `navigator.storage.persist()` after the first successful download. That protects a ~100 MB download from being evicted; Firefox asks the user.
  - ➖ Block. Safer against failed downloads, but quota estimates are unreliable.
- **Integrity failure:** ✅ Delete the bad files, re-download once, then fail with a clear reason. It recovers from interrupted downloads without retrying forever.
- **Diagnostics panel:** ✅ Reachable from a Header status badge at all times. It shows a summary by default and expands to per-check details. It's useful for supporting colleagues during the beta.

---

## [Modules/dictionary]

### T25 — Dictionary content
I can't verify these licenses from here, so confirm each before choosing. Note that CC BY-SA data would make the compiled dictionary share-alike, as you already accepted for the models.

**English definitions**
- ✅ **Open English WordNet (CC BY 4.0).** Clean structure and a permissive license. Its definitions are terse for beginners.
- ➖ **English Wiktionary via kaikki.org extracts (CC BY-SA 4.0).** Rich learner-friendly senses and examples, plus Korean translations in the same source. Share-alike, with noisy data that needs heavy cleaning.
- ❌ **GCIDE / Webster 1913.** GPL or archaic definitions.

**Korean translations**
- ✅ **Wiktionary translation sections (CC BY-SA)** as the base.
- ➖ **KRDict / 한국어기초사전 (reportedly CC BY-SA 2.0 KR).** High quality, but it's Korean→English, so it would need reverse mapping.
- ➖ **Kengdic.** The license needs checking.

**Examples**
- ✅ **Tatoeba English–Korean sentence pairs (CC BY 2.0 FR).** Bilingual examples suited to learners.
- ➖ Wiktionary examples.

**Coverage**
- ✅ **About 10–20k headwords from a learner word list such as NGSL (CC BY-SA 4.0)**, plus frequent EWT words. That covers most text beginners and intermediate learners read, at a small download.
- ➖ The full source (100k+ entries). Better coverage, but a much bigger download.

**Multiword expressions**
- ✅ **Phrasal verbs only in v1.** They come for free via the kept `compound:prt` subtype.
- ➖ Idioms too. That needs fuzzy matching.

**Sense selection**
- ✅ **Show all senses, with those matching the predicted part of speech first.** Robust to tagging errors and simple to build.
- ❌ Pick a single sense from context. That needs word-sense disambiguation, a new model.

**Lookup trigger**
- ✅ **Click or tap a word → popup with a short entry and "more" → DictionaryPage.** Works on touch and with the keyboard, which hover doesn't.
- ➖ Text selection. Natural for phrases, awkward on mobile.

---

## [Modules/subword]

### T26 — Affix data and known-word list
**Affix inventory**
- ✅ **A curated list we write ourselves (~80–120 affixes), guided by the Bauer & Nation (1993) affix levels.** The levels are published facts, not copyrighted data. It's ordered by how often learners meet each affix, and we can write Korean glosses ourselves. We own the license.
- ➖ **Wiktionary's affix categories (CC BY-SA).** Larger, but noisy and share-alike.
- ❌ **CELEX** (paid license) or other non-commercial lexicons.

**Content:** ✅ Korean gloss + 1–2 examples per affix, written by us. That's the actual learning value, and the list is small enough to write by hand.

**Known-word list**
- ✅ **A bundled list inside `subword/`** (e.g., NGSL plus lemma forms, a compressed word set). The module stays self-contained, there's no cross-module wiring, and it works before the dictionary exists.
- ➖ **Dictionary headwords combined at the hook layer.** One source of truth, but subword depends on T25 and T46 and on loading dictionary data first.
- ❌ **wink's lexicon.** It lives in the parser worker; using it on the main thread would duplicate the ~1 MB bundle or need a new worker message.

---

## [Modules/vocab]

### T27 — Vocabulary list design
**Entry schema**
- ✅ `word`, `lemma`, `upos`, `definitionEn`, `definitionKo`, `example`, `sourceSentence`, `notes`, `tags[]`, `addedAt`, `id`, `schemaVersion`. It covers the plan's fields; storing the lemma and part of speech allows dictionary re-lookup.
- ➖ A minimal schema (word, notes, date) that re-fetches definitions on display. Smaller, but it depends on the dictionary staying the same.

**Export format**
- ✅ **JSON as the canonical, versioned format (no new dependency) plus CSV export.** JSON round-trips losslessly. CSV opens in spreadsheets and imports into Anki as plain fields.
- ➖ An Anki `.apkg` package. Best for Anki users, but it needs SQLite or zip libraries (new dependencies).
- ❌ Zip as the main format. No benefit for small text data.

**CSV library:** ✅ A small hand-written CSV writer and parser to avoid `csv-*` dependencies, or ➖ approve `csv-stringify`/`csv-parse` (MIT) if robustness matters more.

**Import conflicts:** ✅ Merge by `id`; same word with a different `id` → keep both and flag it as a duplicate; ask the user only when list names collide. Nothing is lost silently.

**Storage**
- ✅ IndexedDB for lists (no size limit worth worrying about), LocalStorage only for small settings. Show a periodic "export a backup" reminder, since browser storage can be cleared.
- ➖ LocalStorage only. Simpler, but the ~5 MB limit is reachable with examples.

---

Sources (T12 hosting limits):
- [GitHub Docs — Git LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs)
- [GitHub Docs — About storage and bandwidth usage](https://docs.github.com/enterprise-cloud@latest/repositories/working-with-files/managing-large-files/about-storage-and-bandwidth-usage)
- [Cloudflare Pages — Limits](https://developers.cloudflare.com/pages/platform/limits)
- [huggingface_hub — CORS headers for model files (older issue)](https://lightrun.com/answers/huggingface-huggingface_hub-cors-headers-for-model-files)
