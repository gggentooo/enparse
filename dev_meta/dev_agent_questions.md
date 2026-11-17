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
