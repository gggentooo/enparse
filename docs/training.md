# Enparse Model Training: Technical Guide

> **Current Status (as of 2026-11-21):** Phases pre-0 through 9 are complete. Phase 7 finished with a **biaffine dependency parser head** retrained on all four models: `deberta_v3_xsmall` and `modernbert_base` meet every acceptance threshold and are offered; `bert_base_cased` (test UPOS 96.995%) and `distilbert_base_cased` miss the 97% UPOS bar. Phase 8 calibrated both offered models (temperatures, ambiguity margins, bracket-confidence thresholds with ≥ 95% shown-bracket precision; `training/reports/calibration.md`). Phase 9 exported both offered models; int8 and fp16 pass parity for both (`training/reports/parity.md`). Next: Phase 10 (browser benchmarking). Sections below that describe the extended stage as running are historical.

---

## Table of Contents

1. [Overview and Project Goals](#1-overview-and-project-goals)
2. [What the Models Do: Token Classification and Two Syntactic Views](#2-what-the-models-do-token-classification-and-two-syntactic-views)
3. [The Four Candidate Base Models](#3-the-four-candidate-base-models)
4. [Benchmarks, Metrics, Baselines, and Acceptance Thresholds](#4-benchmarks-metrics-baselines-and-acceptance-thresholds)
5. [Dataset and End-to-End Data Processing Pipeline (Phases 1–4)](#5-dataset-and-end-to-end-data-processing-pipeline-phases-14)
6. [Training Mechanics and Optimization (Phase 7)](#6-training-mechanics-and-optimization-phase-7)
7. [How Many Training Passes Were Run? Complete Schedule Breakdown](#7-how-many-training-passes-were-run-complete-schedule-breakdown)
8. [How Model Performance Changed Over Epochs and Across Runs](#8-how-model-performance-changed-over-epochs-and-across-runs)
9. [What Comes Next: Remaining Phase 7 Work and Phases 8–12](#9-what-comes-next-remaining-phase-7-work-and-phases-812)

---

## 1. Overview and Project Goals

**Enparse** is a fully client-side browser application designed to help Korean speakers study English grammar and vocabulary. Because it runs strictly in the user's browser with no backend server, the parsing models must be compact enough to download once, cache locally, and parse up to 5,000 characters of English text within roughly **5 seconds** on a typical laptop (using WebGPU when available, or WebAssembly/CPU otherwise), while prioritizing **accuracy over speed**.

Rather than shipping a single parser, Enparse adopts a **multi-model library** design: four pretrained Transformer encoder models of different sizes and architectures are fine-tuned on the exact same dataset and evaluation harness. Every model that meets the acceptance thresholds is offered in the app so the user can choose their preferred trade-off between download size, speed, and accuracy.

### Training Environment and Tooling (Phases pre-0 and 0)

All training runs locally without cloud GPUs:

- **Hardware:** Apple MacBook Pro with M5 Pro chip and 48 GB unified memory, using PyTorch's **MPS (Metal Performance Shaders)** GPU backend (`torch 2.15.0`).
- **Training framework:** **Hugging Face `Trainer`** (`transformers 4.57.6`) on Python 3.12 (managed with `uv`).
  - *Why not Unsloth?* Unsloth was evaluated in Phase 0 as a potential accelerator, but on macOS its `FastModel.from_pretrained` routed to Apple's MLX backend rather than PyTorch MPS and failed on all four encoder models. Additionally, its transitive dependency `unsloth-zoo` is licensed under LGPL-3.0-or-later, which conflicts with Enparse's permissive-license policy. Plain Hugging Face `Trainer` passed a 50-step dummy MPS run on all four models (7.2 s to 21.2 s) and was selected for all training.
- **Runtime / JavaScript bridge:** Node.js 26+ with `wink-nlp` 2.4.0, `@huggingface/transformers` (Transformers.js) 4.3.2, and `tsx`. Crucially, scripts in `training/js/` import and execute the app's actual TypeScript modules (`src/modules/input/textInput.ts`, `src/modules/parser/winkBackend.ts`, and `src/modules/parser/treeDecoder.ts`) directly, ensuring zero discrepancy between offline training/evaluation and browser execution.

### Pipeline Roadmap and Live Status

| Phase | Purpose | Status (2026-11-21) |
|---|---|---|
| **Pre-0 & 0** | Machine check, Python/Node pins, MPS verification, Unsloth check | Complete |
| **1** | Acquire UD English EWT dataset, pin hashes, resolve licensing | Complete |
| **2** | Derive flat phrase chunks (BIO tags) from UD dependency trees | Complete |
| **3** | Align training words with the runtime `wink-nlp` tokenizer | Complete |
| **4** | Build label maps, multi-sentence windows, and `labels.json` (v1; v2 for the biaffine head) | Complete |
| **5** | Measure classical JS baselines (`wink-nlp`, `compromise`) | Complete |
| **6** | ~~Single base-model selection~~ | Removed (all qualifying models ship) |
| **7** | Smoke test, hyperparameter sweeps, 3-seed training, test evaluation | Complete (base, extended, and biaffine stages; DeBERTa-v3-xsmall and ModernBERT offered) |
| **8** | Probability calibration (temperature scaling) and ambiguity margins | Complete (2026-11-21) |
| **9** | Final ONNX export (`fp32`, `int8`, `fp16`) and parity verification | Complete (2026-11-21) |
| **10** | Browser benchmarking (Chrome, Safari, Firefox; WebGPU & WASM) | **Next** |
| **11** | Packaging into `public/models/` (Git LFS), `catalog.json`, integration tests | Planned |
| **12** | Ongoing maintenance and optional user-feedback retraining | Planned |

---

## 2. What the Models Do: Token Classification and Two Syntactic Views

### Why Fine-Tune Small Encoder Transformers Instead of Using a Generative LLM?

When beginners hear "language model," they usually think of **decoder-only generative LLMs** (such as GPT, Claude, or Llama) that predict the next token from left to right. Enparse instead uses **encoder-only Transformer models** (BERT-family architectures) trained via **supervised fine-tuning for token classification**. There are four technical reasons for this choice:

1. **Bidirectional context:** An encoder's self-attention allows every token to attend simultaneously to tokens both to its left *and* to its right. Determining whether *"flies"* in *"Time flies like an arrow"* is a verb or a noun requires looking at the entire sentence at once.
2. **Single-pass structured prediction:** Instead of generating text token-by-token (slow, non-deterministic, prone to formatting errors), a token classifier runs one forward pass and directly outputs a probability distribution over grammatical labels for every word simultaneously.
3. **Transfer learning efficiency:** We do **not** train from scratch. Each base model was already pretrained on billions to trillions of words of English text, so its internal weights already encode rich lexical and syntactic representations. Fine-tuning attaches a small newly initialized linear classification layer on top and gently adapts the whole network to express that linguistic knowledge using Enparse's specific label set.
4. **Browser feasibility:** Encoder models with 65M–150M parameters compress to **66–152 MB** at 8-bit integer precision (`int8`), small enough to download and run entirely client-side inside a browser Web Worker.

### Two Outputs Predicted Together in One Pass

Enparse displays two complementary syntactic views of every sentence. Consider the example sentence:

> *The red dog rarely barks loudly .*

| View | Rendered Output | Source Prediction |
|---|---|---|
| **Flat phrases** | `[NP The red dog] [ADVP rarely] [VP barks] [ADVP loudly] .` | **Group A** (`UPOS\|CHUNK`) |
| **Nested phrases** | `[[The [red [dog]]] [rarely [[barks] loudly]]] .` | **Group B** (dependency tree decoded by `treeDecoder.ts`) |

#### Group A: Joint Part-of-Speech and Flat Chunk Labels (`UPOS|CHUNK`)

Each word receives a single combined label joining two linguistic annotations:

1. **UPOS (Universal Part of Speech):** One of the 17 standard Universal Dependencies tags (`ADJ`, `ADP`, `ADV`, `AUX`, `CCONJ`, `DET`, `INTJ`, `NOUN`, `NUM`, `PART`, `PRON`, `PROPN`, `PUNCT`, `SCONJ`, `SYM`, `VERB`, `X`).
2. **BIO Chunk Tag:** Non-recursive, flat phrases in the CoNLL-2000 style across five phrase types — Noun Phrase (`NP`), Verb Phrase (`VP`), Prepositional Phrase (`PP`), Adjective Phrase (`ADJP`), and Adverb Phrase (`ADVP`) — encoded with the **BIO scheme**:
   - `B-<TYPE>`: this word **B**egins a new phrase of `<TYPE>`.
   - `I-<TYPE>`: this word continues (**I**nside) the current phrase of `<TYPE>`.
   - `O`: this word is **O**utside any phrase (e.g., punctuation, conjunctions).

For the example sentence, the Group A sequence is:

```text
Word:     The       red       dog        rarely      barks      loudly      .
Group A:  DET|B-NP  ADJ|I-NP  NOUN|I-NP  ADV|B-ADVP  VERB|B-VP  ADV|B-ADVP  PUNCT|O
```

Combining UPOS and chunk into one joint class has two advantages:
- **Built-in structural consistency:** Impossible combinations like `PUNCT|B-NP` never exist in the label vocabulary, so the model cannot predict them.
- **Exact marginalization:** After applying softmax to obtain a probability for every joint label $P(u, c)$, separate UPOS and chunk probabilities are recovered cleanly by summing (marginalizing):
  $$P(\text{UPOS} = \text{NOUN}) = \sum_{c} P(\text{NOUN},\, c), \qquad P(\text{CHUNK} = \text{B-NP}) = \sum_{u} P(u,\, \text{B-NP})$$

#### Group B: Dependency Parsing as Sequence Labeling (`rel_pos_v1`)

Flat chunks cannot express hierarchical nesting (such as which noun a prepositional phrase modifies, or how adjectives nest inside a noun phrase). To build the nested view **without** writing brittle hand-crafted grammar rules, the model also predicts each word's **dependency tree** — a directed tree where every word points to its grammatical **head** (parent word) along with a **dependency relation** (such as `det`, `amod`, `nsubj`, `advmod`, `case`, or `root`).

How can a token classifier — which only picks one fixed class ID per word — point to an arbitrary other word in a variable-length sentence? Enparse adopts **relative-POS head encoding** (Strzyż et al., 2019), named `rel_pos_v1` in the codebase. Every word's Group B label has the format:

```text
<offset>@<head UPOS>|<relation>
```

- The sentence's main predicate (the root of the tree) is always `0@ROOT|root`.
- Any other word encodes its head by **direction** (`+` to the right, `-` to the left), **how many words of the head's UPOS to count** (`k`), the **head's UPOS tag**, and the **base UD relation** (stripping subtypes like `nmod:poss` → `nmod`). After the planned biaffine retrain, the relation classifier keeps ten learner-relevant subtypes (e.g., `nsubj:pass`, `acl:relcl`, `nmod:poss`, `compound:prt`); see `dev_meta/plan-training.md` → *Head encoding*.

Walking through *The red dog rarely barks loudly .*:

| Index | Word | UPOS | Head Word | Relative-POS Group B Label | Meaning |
|---:|---|---|---|---|---|
| 1 | `The` | `DET` | `dog` (3) | `+1@NOUN\|det` | 1st `NOUN` to the right (`dog`), relation `det` |
| 2 | `red` | `ADJ` | `dog` (3) | `+1@NOUN\|amod` | 1st `NOUN` to the right (`dog`), relation `amod` |
| 3 | `dog` | `NOUN` | `barks` (5) | `+1@VERB\|nsubj` | 1st `VERB` to the right (`barks`), relation `nsubj` |
| 4 | `rarely` | `ADV` | `barks` (5) | `+1@VERB\|advmod` | 1st `VERB` to the right (`barks`), relation `advmod` |
| 5 | `barks` | `VERB` | ROOT (0) | `0@ROOT\|root` | Sentence root |
| 6 | `loudly` | `ADV` | `barks` (5) | `-1@VERB\|advmod` | 1st `VERB` to the left (`barks`), relation `advmod` |
| 7 | `.` | `PUNCT` | `barks` (5) | `-1@VERB\|punct` | 1st `VERB` to the left (`barks`), relation `punct` |

Notice how compact this representation is: instead of absolute sentence positions (which fail on long sentences), most grammatical dependencies refer to the 1st or 2nd `NOUN` or `VERB` nearby. At decoding time, `treeDecoder.ts` resolves each word's Group B label using the sentence's **predicted UPOS tags from Group A**, repairs any invalid tree conditions (multiple roots, missing root, or cycles), and then constructs nested phrases deterministically **head-outward** (attaching closest right dependents first, then closest left dependents, adding one bracket level per step; punctuation is left unbracketed at its head's level).

### The Packed Two-Group Classifier Architecture

Both label groups live inside a **single standard `AutoModelForTokenClassification` model** whose final linear layer outputs `78 + 632 = 710` logits per subword token:

```text
input_ids          [B, T]         B = batch size (8 windows), T ≤ 256 subword tokens
  │
  ▼  Token + Position Embeddings
hidden states      [B, T, H]      H = hidden size (384 for DeBERTa-v3-xsmall; 768 for others)
  │
  ▼  L Transformer Encoder Layers (self-attention + feed-forward MLP)
contextual states  [B, T, H]      L = 6 (DistilBERT), 12 (DeBERTa/BERT), or 22 (ModernBERT)
  │
  ▼  Dropout + Single Linear Layer: Linear(H → 710)
packed logits      [B, T, 710]
  │
  ├── slice [:, :,   0:78 ]  ──►  Group A logits (78 UPOS|CHUNK classes)   ──► Softmax A / Loss A
  └── slice [:, :,  78:710]  ──►  Group B logits (632 rel_pos_v1 classes)  ──► Softmax B / Loss B
```

**Why pack both heads into one linear layer instead of creating two separate output heads?**
1. **Mathematically identical:** A single linear projection $\mathbb{R}^{H} \to \mathbb{R}^{78 + 632}$ has the exact same parameters and outputs as two independent linear layers $\mathbb{R}^{H} \to \mathbb{R}^{78}$ and $\mathbb{R}^{H} \to \mathbb{R}^{632}$ placed side by side on top of the shared encoder.
2. **Ecosystem compatibility:** In `@huggingface/transformers` (Transformers.js v4.3.2), the built-in `*ForTokenClassification` runtime classes retain only the single `logits` tensor from ONNX and silently drop any additional named outputs. Packing both groups into one `logits` tensor allowed Hugging Face `Trainer`, Optimum's standard `token-classification` ONNX exporter, and Transformers.js to work out of the box with no custom runtime model class. The slice boundaries (`chunk: [0, 78)`, `dep: [78, 710)`) are recorded in `labels.json`.

*(As detailed in [Section 9](#9-what-comes-next-remaining-phase-7-work-and-phases-812), Enparse plans to upgrade Group B to a dedicated biaffine arc scorer as a second ONNX output after the extended stage, using Transformers.js's lower-level `model.forward()` API.)*

---

## 3. The Four Candidate Base Models

Enparse trains four **cased** pretrained encoder models spanning a 2.3× range in parameter count and three distinct tokenizer families. **Uncased models were excluded** because capitalization is a strong grammatical signal in English for distinguishing proper nouns (`PROPN`, e.g. *Apple*, *May*) from common nouns (`NOUN`) and for identifying sentence starts.

| Model Key | Hugging Face ID | License | Params | Layers | Hidden ($H$) | Attn Heads | Tokenizer Family (Vocab) | Smoke ONNX Size (`int8` / `fp16`) | Intended Library Role |
|---|---|---|---:|---:|---:|---:|---|---|---|
| `distilbert_base_cased` | `distilbert-base-cased` | Apache 2.0 | ~65M | 6 | 768 | 12 | WordPiece (28,996) | 66.3 / 131.6 MB | **Fast** — smallest download, fastest inference |
| `deberta_v3_xsmall` | `microsoft/deberta-v3-xsmall` | MIT | ~70M | 12 | 384 | 6 | SentencePiece (128,100) | 87.5 / 143.2 MB | **Compact** — high accuracy for its size |
| `bert_base_cased` | `bert-base-cased` | Apache 2.0 | ~110M | 12 | 768 | 12 | WordPiece (28,996) | 109.4 / 216.8 MB | **Standard** — classic balanced reference |
| `modernbert_base` | `answerdotai/ModernBERT-base` | Apache 2.0 | ~150M | 22 | 768 | 12 | Byte-level BPE (50,368) | 151.8 / 301.0 MB | **Accurate** — largest model, accuracy upper bound |

### Key Architectural Differences

- **DistilBERT (`distilbert-base-cased`):** Created via knowledge distillation from BERT-base, keeping half the transformer layers (6 instead of 12) at the same width (768). Fast and lightweight, but with less depth for modeling long-range dependency arcs.
- **DeBERTa-v3-xsmall (`microsoft/deberta-v3-xsmall`):** Uses half the hidden width of BERT (384 vs. 768) across 12 layers, so most of its ~70M parameters actually sit in its massive 128,100-token SentencePiece embedding table (which is why its `int8` ONNX file is 87.5 MB despite having a tiny transformer body). Two innovations make it unusually strong at syntactic parsing:
  1. **Disentangled relative positional attention:** Rather than simply adding a position vector to a word embedding once at the input, DeBERTa keeps content and relative position separate inside every attention layer, computing explicit content-to-position and position-to-content attention scores. Because dependency parsing depends heavily on relative distances between words, this inductive bias is directly aligned with Group B.
  2. **Replaced Token Detection (ELECTRA-style pretraining):** Every token position receives a discriminative training signal during pretraining, rather than only the 15% masked tokens used by BERT.
- **BERT-base-cased (`bert-base-cased`):** The canonical 12-layer bidirectional Transformer encoder with learned absolute positional embeddings and WordPiece tokenization. Serves as a well-understood middle ground.
- **ModernBERT-base (`answerdotai/ModernBERT-base`):** A modern (late 2024) 22-layer encoder trained on ~2 trillion tokens with **Rotary Positional Embeddings (RoPE)**, **GeGLU** feed-forward layers, alternating local/global attention, and a native 8,192-token context length (though Enparse uses 256-token windows to match runtime constraints). Because its byte-level BPE tokenizer encodes leading spaces as special characters (`Ġ`), its config sets `tokenizer_kwargs: {add_prefix_space: true}` so pre-split words are tokenized consistently.

---

## 4. Benchmarks, Metrics, Baselines, and Acceptance Thresholds

### How Model Quality Is Measured

Every model is scored across both flat and structural tasks using word-level predictions (evaluating only reviewed, non-context words):

1. **UPOS Accuracy (`upos_acc`):** Percentage of words whose predicted UPOS tag (extracted from Group A) matches the gold UD tag.
2. **Chunk Precision, Recall, and F1 (`chunk_f1`, via `seqeval`):** Evaluated strictly at the **phrase-span level**, not word-by-word. A predicted chunk counts as correct only if its phrase type (`NP`, `VP`, `PP`, `ADJP`, `ADVP`), start word, and end word **all** match the gold chunk exactly. Getting a single boundary word wrong penalizes both precision and recall for the entire span. Overall F1 and per-type F1 are tracked; sentences with any unreviewed word are excluded from chunk F1.
3. **Raw UAS & LAS (`uas`, `las`):**
   - **UAS (Unlabeled Attachment Score):** Percentage of words whose decoded dependency head (from Group B argmax + Group A predicted UPOS) matches the gold head word.
   - **LAS (Labeled Attachment Score):** Percentage of words where *both* the decoded head word **and** the base dependency relation match gold.
4. **Repaired Tree UAS & LAS (`tree_uas`, `tree_las`) and Repaired Share:** Computed by feeding each word's top-5 Group B candidates (with probabilities) and predicted UPOS into the app's actual TypeScript decoder (`src/modules/parser/treeDecoder.ts`, executed via `tsx` from `training/js/nested_eval.mjs`). Because `treeDecoder.ts` can fall back to the 2nd–5th candidate when the 1st candidate points to a nonexistent UPOS or creates a cycle, `tree_uas` and `tree_las` measure what users actually receive — and are consistently **1.4–2.2 percentage points higher** than raw argmax UAS/LAS. `repaired_share` records the percentage of sentences where at least one word had to deviate from its rank-1 prediction.
5. **Nested-Phrase F1 (`nested_f1`):** Exact bracket-span F1 (matching phrase type, start word, and end word) comparing the nested brackets produced by `treeDecoder.buildPhrases()` on the predicted tree against the brackets produced by the same function on the gold dependency tree.

### Phase 5 Baselines: The Bar to Beat

Before training any neural model, Phase 5 measured two existing JavaScript NLP libraries on the exact same Phase 3 runtime-aligned words (`training/reports/baselines.md`):

| Library | Dev UPOS | Test UPOS | Dev Chunk F1 (P / R) | Test Chunk F1 (P / R) | Dependency / Nested |
|---|---:|---:|---|---|---|
| **wink-nlp** (2.4.0) | 88.93% | **88.76%** | N/A (no chunker) | N/A | None |
| **compromise** (14.20.0) | 83.07% | 82.36% | 69.48% (71.84 / 67.28) | **69.65%** (72.38 / 67.11) | None |

Both classical libraries struggle sharply on informal web text:
- `wink-nlp` frequently mislabels capitalized common nouns and adjectives as proper nouns (`NOUN → PROPN`, `ADJ → PROPN`), scoring only ~70% on `ADJ`, ~59% on `SCONJ`, and ~83–85% on `NOUN`/`VERB`.
- `compromise` lacks several UD distinctions (tagging possessive pronouns as nouns and auxiliaries as plain verbs) and has no `ADVP` chunk category at all (0.00% ADVP F1, 28.30% ADJP F1, 63.57% VP F1, 73.52% NP F1 on test).

### Acceptance Thresholds (and How They Evolved)

A trained model is offered in Enparse's model library only if its **held-out test split** performance satisfies these gates:

- **Flat View (model offered in the library — owner-confirmed):**
  - Test **UPOS accuracy ≥ 97.00%** (must also beat `wink-nlp`'s 88.76%)
  - Test **Chunk F1 ≥ 94.00%** (must also beat `compromise`'s 69.65%)
- **Nested View (enabled per model):**
  - *Original proposal:* Tree UAS ≥ 97.00% and Tree LAS ≥ 94.00%. Base Phase 7 results (Tree UAS 88–92%, Tree LAS 86–90%) demonstrated that 97%/94% on noisy EWT web text is out of reach for a compact browser sequence-labeling model.
  - *Revised owner decision (2026-11-19):* A model enables the nested view if on test it achieves:
    1. **UAS excluding punctuation ≥ 93.00%** (punctuation is never bracketed in the UI),
    2. **Labeled multi-word bracket F1 ≥ 88.00%**, and
    3. **Precision of shown brackets ≥ 95.00%** after Phase 8 confidence gating (brackets below the confidence threshold collapse flat inside their parent phrase, trading coverage for high precision).
  - A model that passes the flat thresholds but misses the nested thresholds is still offered in the app with the flat view only.

---

## 5. Dataset and End-to-End Data Processing Pipeline (Phases 1–4)

Training a reliable parser requires much more than downloading a dataset and calling `.fit()`. Four dedicated engineering phases transform raw linguistic annotations into exact subword tensors that match what the browser will produce at runtime.

```text
UD English EWT r2.19 (.conllu, 16,622 sentences / 254,820 words)
  │
  ▼  Phase 2 — scripts/derive_chunks.py
Chunked CoNLL-U (+ Chunk=<BIO> in MISC; 0.36% reviewed error rate)
  │
  ▼  Phase 3 — js/align_tokens.mjs (runs app's textInput.ts + winkBackend.ts via tsx)
Runtime-Aligned JSONL (16,619 sentences / 253,269 runtime words; 0 invalid trees)
  │
  ▼  Phase 4 — scripts/prepare_data.py (per candidate model tokenizer)
Hugging Face DatasetDict + labels.json v1
  (256-token multi-sentence windows, 710 classes, first-subword labels, -100 masking)
```

### Phase 1 — Data Acquisition and Licensing

Enparse trains on the **Universal Dependencies English Web Treebank (UD English EWT)**, pinned to release **`r2.19`** (commit `6b021622f3ab7902730f313fa5955a8b8cdd52b8`, verified by SHA-256 checksums in `training/configs/data.yaml`).

- **Genres:** Five domains of real-world English web text — blogs, Usenet newsgroups, emails (Enron), product reviews, and Yahoo! Answers Q&A.
- **Official splits:**
  - `train`: 12,544 sentences / 204,578 words
  - `dev` (validation): 2,001 sentences / 25,148 words
  - `test` (held-out final evaluation): 2,077 sentences / 25,094 words
- **Format (CoNLL-U):** Tab-separated word lines grouped into sentences with `# newdoc id` and `# text` metadata, carrying each word's surface form (`FORM`), `UPOS`, dependency `HEAD` (1-based index, `0` = root), and `DEPREL`. Multiword tokens (like `didn't` → `did` + `n't`) appear as range lines (`4-5`) followed by their syntactic component words.
- **Licensing and Excluded Corpora:** UD EWT is licensed under **CC BY-SA 4.0**. Raw and derived datasets are git-ignored and not redistributed; trained weights are treated conservatively as CC BY-SA 4.0 derived works with full attribution (with legal review planned before commercial release). **UD English GUM** was evaluated and excluded because its UD `r2.19` release carries a non-commercial license (**CC BY-NC-SA 4.0**), which violates Enparse's licensing policy. Other candidate corpora (ESLSpok, CHILDES, Atis, Penn Treebank) were also dropped for now.

### Phase 2 — Deriving Flat Chunks from Dependency Trees (`derive_chunks.py`)

UD EWT provides UPOS tags and dependency trees, **not** flat phrase chunks (and standard chunking corpora like CoNLL-2000 lack clear commercial licensing). `training/scripts/derive_chunks.py` converts UD dependency trees into flat, non-recursive CoNLL-2000-style BIO chunks while preserving `HEAD` and `DEPREL` intact for Group B.

- **Core rules:**
  - **NP:** Nominal heads (`NOUN`, `PROPN`, `PRON`, `NUM`, plus pronominal `DET`, nominalized `ADJ` like *the same*, and currency/percentage `SYM` like `$ 5`) absorb their left modifiers (`det`, `amod`, `nummod`, `compound`, `nmod:poss` with its own modifiers and `'s`, coordinated pre-modifiers like *red and blue cars*, adjacent dates/titles like *October 4th* or *President Putin*). Post-modifiers (prepositional phrases, relative clauses) start separate chunks.
  - **VP:** Verbal/auxiliary predicates absorb contiguous auxiliaries (`aux`, `aux:pass`), copulas (`cop`), infinitive `to` (`[VP to go]`), negation (`not`), phrasal particles (`compound:prt`), and strictly interior adverbs (`has always been`). Stranded particles (`picked it [ADVP up]`) become `ADVP`.
  - **PP:** Prepositions (`ADP` with `case`, stacked prepositions like `out of`, and preposition-like `mark` before gerunds such as `[PP by] [VP giving]`), excluding the following NP.
  - **ADJP / ADVP:** Standalone adjectives/adverbs outside NPs/VPs plus their contiguous left modifiers (`very happy`, `so close together`).
  - **O:** Punctuation (except chunk-interior hyphens, slashes, commas, quotes like `a well - known author`), coordinators (`and`, `as well as`), subordinators (`because`, `that`), interjections.
  - **Contiguity:** Every chunk must be contiguous; any gap splits it into separate chunks with valid `B-`/`I-` prefixes.
- **Quality verification:** A seeded sample of 200 dev sentences (`seed 13`) underwent two rounds of manual review (`training/reports/chunk_review.md`). Round 1 revealed a ~2.5% chunk error rate (~35 of 1,397 chunks), leading to 13 rule refinements. Round 2 dropped the error rate to **0.36%** (5 of 1,375 chunks), well below the `< 2%` exit criterion, alongside 48 passing unit tests.
- **Resulting train distribution (111,872 chunks + 33,758 `O` words):** `NP` 50.7% (56,748), `VP` 24.2% (27,121), `PP` 15.3% (17,163), `ADVP` 6.5% (7,288), `ADJP` 3.2% (3,552).
- **Methodological note:** Because chunks are derived deterministically from UD trees, Enparse's chunk F1 measures accuracy against *Enparse's* chunk definition rather than CoNLL-2000 directly.

### Phase 3 — Tokenization Alignment with Runtime (`align_tokens.mjs`)

At inference time in the browser, raw user text first passes through `src/modules/input/textInput.ts` (`preprocess()`: NFKC normalization, curly quotes → ASCII, dash normalization, stripping non-Latin/emoji/control characters) and then through `src/modules/parser/winkBackend.ts` (`tokenize()`, built on `wink-nlp`).

If the models were trained on UD's word boundaries while the browser fed `wink-nlp`'s word boundaries at runtime, the models would suffer from **train/serve skew** — encountering contractions, hyphens, and URLs split differently than anything seen during training.

Phase 3 eliminates this skew by running the app's **actual** `preprocess()` and `tokenize()` functions on every EWT sentence via `tsx` and aligning UD annotations onto the resulting runtime words:

- **Unified runtime word rules** (implemented in `winkBackend.ts`):
  - **Contractions are always split** (`I'm` → `I` + `'m`, `don't` → `do` + `n't`), fixing `wink-nlp`'s native inconsistency (`it's` was split, `I'm` was not).
  - **Hyphenated words stay one word** (`well-known`, `F-16-launched`).
  - **URLs, email addresses, and repeated symbol runs** (`***`, `------`) stay one word; sentences never split inside a URL.
  - Sentences where `preprocess()` removes characters (non-Latin/emoji) are dropped (exactly 1 sentence per split).
- **Label transfer and dependency tree remapping:**
  - **Merge (multiple UD words → one runtime word, e.g., `al` + `-` + `Qaeda` → `al-Qaeda`):** The merged word inherits the UPOS, chunk type, head, and relation of the span's **internal head word** (the UD word whose dependency head lies outside the merged span). All incoming arcs to any word in the span are repointed to the merged word.
  - **Split (one UD word → multiple runtime words, e.g., `ENRON.XLS` → `ENRON` + `.` + `XLS`):** The main alphanumeric piece keeps the original labels and head; secondary pieces attach to the main piece with relation `goeswith` and UPOS `X` (or `PUNCT` if non-alphanumeric).
  - **Validation:** Every remapped sentence is verified to remain a valid single-root, cycle-free dependency tree and a valid BIO chunk sequence.
- **Outcome (`training/reports/alignment.md`):**
  - Counted word agreement (excluding intentional hyphen/single-token merges): **train 99.76%**, **dev 99.56%**, **test 99.56%** (all exceeding the ≥ 99.50% target; raw all-word agreement 98.24% / 97.75% / 97.86%).
  - **0 invalid trees** across all 16,619 aligned sentences (203,271 train / 25,038 dev / 24,960 test runtime words).
  - Remaining edge case tracked for error analysis: `wink-nlp` splits 306 train (50 dev / 55 test) UD sentences into multiple runtime sentences, causing 719 train arcs to cross runtime sentence boundaries; at runtime, `treeDecoder.ts` safely attaches cross-sentence heads to the sentence root.

### Phase 4 — Label Vocabulary, Multi-Sentence Windows, and Subword Masking (`prepare_data.py`)

This phase converts the aligned word lists into the exact integer tensors consumed by PyTorch during training. Because each base model uses a different subword tokenizer, `prepare_data.py` builds a separate Hugging Face `DatasetDict` and `labels.json` for each of the four models.

#### 1. Building the Label Space and Rare-Label Merging

Label counts are computed exclusively from **reviewed words in the train split**. Any label seen fewer than `min_label_count = 5` times is merged so the classifier does not waste capacity on singletons:

| Group | Distinct in Train | Kept (≥ 5) | Train Words on Kept Labels | Merged Rare Words | Unencodable (Masked `-100`) |
|---|---:|---:|---:|---|---|
| **Group A** (`UPOS\|CHUNK`) | 94 | **78** | 99.985% | 31 words (16 labels) → most frequent kept label with same chunk tag | 0 (0.000%) |
| **Group B** (`rel_pos_v1`) | 1,202 | **632** | 99.501% | 772 words → most frequent kept label with same `<offset>@<UPOS>` (head preserved, relation generalized) | **242 words (0.119%)** (target < 0.5%) |
| **Total** | 1,296 | **710** | — | — | — |

Notice how Group B rare-label merging preserves syntactic geometry: if `+2@NOUN|vocative` occurred only twice, it merges into `+2@NOUN|nmod` (keeping the exact head pointer) rather than discarding the head. Only when no kept label shares the `<offset>@<UPOS>` pair at all (e.g., an extremely distant offset) is the word marked `-100` in Group B. In the kept Group B inventory, head offsets span from `-16` to `+5`, heavily concentrated at `±1` (302 labels) and `±2` (145 labels).

#### 2. Document-Aware Multi-Sentence Windowing

Rather than feeding one isolated sentence at a time, `prepare_data.py` packs **consecutive sentences from the same document** (`# newdoc id`) into windows of up to **256 subword tokens** (including special tokens like `[CLS]`/`[SEP]`), matching the browser's 256-token inference window:

- **Why multi-sentence windows?** Surrounding sentences provide discourse context for pronouns, elliptical fragments, and headline capitalization, and match inference distribution.
- **Long-sentence overflow:** If a single sentence ever exceeds the token budget, `build_windows()` splits it at word boundaries with at least **32 subword tokens of repeated context** whose labels are masked to `-100` (so the model sees left context without double-counting words in loss or evaluation). In EWT, **0 sentences** needed splitting.
- **Resulting window counts per model** (differences reflect each tokenizer's vocabulary size — DeBERTa's 128k SentencePiece vocabulary breaks words into fewer subwords, packing slightly more sentences per window):

| Model | Train Windows | Mean Sents / Train Win | Mean / p95 / Max Tokens (Train) | Dev Windows | Test Windows |
|---|---:|---:|---|---:|---:|
| `distilbert_base_cased` | 1,258 | 10.0 | 192 / 255 / 256 | 362 | 363 |
| `deberta_v3_xsmall` | 1,185 | 10.6 | 190 / 255 / 256 | 354 | 358 |
| `bert_base_cased` | 1,258 | 10.0 | 192 / 255 / 256 | 362 | 363 |
| `modernbert_base` | 1,216 | 10.3 | 191 / 255 / 256 | 359 | 358 |

#### 3. Pre-Split Subword Tokenization, First-Subword Alignment, and the `-100` Mask

Transformer tokenizers split rare or morphologically complex words into multiple **subword tokens** (for example, `unbelievably` → `un`, `##bel`, `##ie`, `##va`, `##bly` in WordPiece). Enparse feeds the runtime words to the tokenizer as a pre-split list (`is_split_into_words=True`, capped at `max_subwords_per_word = 16` to prevent long URLs or symbol runs from blowing up a window) and assigns labels using the standard **first-subword alignment + `-100` ignore mask**:

```text
Runtime words:     [CLS]    The       unbelievably                             dog        [SEP]   [PAD]
Subword tokens:    [CLS]    The       un        ##bel   ##ie    ##va   ##bly   dog        [SEP]   [PAD]
token_word map:     -1       0        1          1       1       1      1       2          -1      -1
attention_mask:      1       1        1          1       1       1      1       1           1       0
labels_chunk (A):  -100     18        3         -100    -100    -100   -100    44         -100    -100
labels_dep   (B):  -100      1        5         -100    -100    -100   -100     2         -100    -100
```

PyTorch's `F.cross_entropy(..., ignore_index=-100)` skips every `-100` position cleanly — meaning **zero loss and zero gradient** are computed on:
1. Special tokens (`[CLS]`, `[SEP]`, `<s>`, `</s>`),
2. Non-first continuation subwords (`##bel`, `##ie`, ...),
3. Dynamic batch padding tokens (`[PAD]`, padded by `Collator` to the longest window in each 8-window mini-batch),
4. Repeated overlap-context words in split sentences,
5. Unencodable Group B heads (242 words in train), and
6. **Unreviewed words** (`reviewed: false`) — a partial-labeling mechanism already built and unit-tested so that future Phase 12 user-feedback corrections (where a user only corrects one word in a sentence) can be mixed straight into training without corrupting loss on unchecked words.

Note that **data augmentation** (`lowercase_sentence_start` and `drop_final_punct`, up to 15% of train windows) is already implemented in `prepare_data.py` (`configs/data.yaml → augmentation.enabled: false`), held in reserve as an optional Phase 7 experiment.

#### 4. The `labels.json` Contract (Schema v1)

Every dataset directory saves a `labels.json` file that travels with the checkpoint into the browser app, recording the exact label list, group slice bounds (`chunk: 0..78`, `dep: 78..710`), `dep_encoding: "rel_pos_v1"`, `tokenizer_input: "pre_split_words"`, window limits (`256` tokens, `16` subwords/word), base model ID, UD commit, and pinned `wink-nlp` versions. Fields populated in later phases (`calibration`, `ambiguity`, `model_version`, `files` SHA-256 hashes) stay `null` until their phase writes them.

---

## 6. Training Mechanics and Optimization (Phase 7)

### Custom Multi-Task Loss (`TwoGroupTrainer`)

Standard `AutoModelForTokenClassification` computes a single softmax over all 710 outputs, which would mistakenly force Group A and Group B labels to compete against each other in one probability distribution. Instead, `training/scripts/train.py` subclasses Hugging Face `Trainer` as `TwoGroupTrainer` and overrides `compute_loss()`:

```python
loss = cross_entropy_mean(logits[..., :78], labels_chunk) \
     + dep_loss_weight * cross_entropy_mean(logits[..., 78:], labels_dep)
```

Formally, for a batch with packed logits $Z \in \mathbb{R}^{B \times T \times 710}$, let $Z_A = Z_{:,:,0:78}$ and $Z_B = Z_{:,:,78:710}$, and let $\mathcal{M}_A$ and $\mathcal{M}_B$ be the sets of non-ignored (`!= -100`) token positions in each group:

$$\mathcal{L} = \frac{1}{\max(|\mathcal{M}_A|, 1)} \sum_{(b,t) \in \mathcal{M}_A} \text{CE}\!\left(Z_{A,b,t},\; y^{(A)}_{b,t}\right) \;+\; \lambda \cdot \frac{1}{\max(|\mathcal{M}_B|, 1)} \sum_{(b,t) \in \mathcal{M}_B} \text{CE}\!\left(Z_{B,b,t},\; y^{(B)}_{b,t}\right)$$

Why normalize each term by its own non-ignored count? Because a word can have a valid Group A label while its Group B label is `-100` (unencodable head). Summing and dividing by `count.clamp(min=1)` guarantees clean, NaN-free per-word averages for both heads. The weighting scalar **$\lambda$ (`dep_loss_weight`)** controls how strongly the gradient emphasizes the harder 632-class dependency task relative to the 78-class chunk/POS task.

### Optimizer, Schedule, Precision, and Hyperparameters

All four models are trained via **full fine-tuning** (every parameter in both the pretrained encoder and the newly initialized `Linear(H → 710)` classifier is updated):

| Hyperparameter | Base Stage Setting | Extended Stage Setting | Technical Purpose |
|---|---|---|---|
| **Optimizer** | AdamW (`weight_decay = 0.01`) | AdamW (`weight_decay = 0.01`) | Adaptive per-parameter step sizes with decoupled L2 regularization |
| **Precision** | `fp32` on MPS | `fp32` on MPS | Avoids mixed-precision underflow/instability on Apple Metal |
| **Batch size** | `8` windows (`grad_accum = 1`) | `8` windows (`grad_accum = 1`) | ~80 sentences per optimizer step → 149–158 updates per epoch |
| **Learning rate** | Swept: `3e-5, 5e-5, 1e-4, 2e-4` | Swept: `1e-4, 2e-4, 3e-4` | Controls fine-tuning step size without catastrophic forgetting |
| **LR schedule** | Linear decay, **10% warmup** | Linear decay, **10% warmup** | Ramps LR linearly from 0 → peak over first 10% of steps while AdamW moments stabilize, then decays linearly to 0 |
| **$\lambda$ (`dep_loss_weight`)** | Swept: `0.5, 1.0, 2.0` | Fixed to base-stage winner | Balances Group A vs. Group B gradient magnitudes |
| **Max epochs** | `15` | `30` | Upper bound on full passes through the training windows |
| **Early stopping** | Patience `3` on dev `select` | Patience `3` on dev `select` | Stops if dev `select` does not improve for 3 consecutive epochs; restores best checkpoint (`load_best_model_at_end=True`) |
| **Selection metric (`select`)** | `(dev chunk_f1 + dev las) / 2` | `(dev chunk_f1 + dev las) / 2` | Jointly tracks flat and structural progress |
| **Random seeds** | `[13, 42, 2026]` | `[13, 42, 2026]` | Measures variance across random classifier init and batch shuffling |

### Two Crucial Design Lessons Discovered Before and During Training

#### 1. The Batch-Size Probe (Why Batch 8 Replaced Batch 32)

The original training plan specified a batch size of 32 windows and learning rates of `2e-5` to `1e-4` over 10 epochs. Because each window already packs ~10 sentences, a batch of 32 windows contained **~320 sentences per gradient update** — yielding only **~40 optimizer steps per epoch** (400 steps total over 10 epochs) on EWT's 1,258 windows! A quick diagnostic probe on `distilbert_base_cased` (dev split) revealed how severely this under-trained the 632-class dependency head:

| Probe Configuration (DistilBERT, Dev) | Epochs | Updates / Epoch | Dev UPOS | Dev Chunk F1 | Dev Raw LAS |
|---|---:|---:|---:|---:|---:|
| Batch 32, `lr = 2e-5` (original default) | 10 | ~40 | 94.1% | 88.7% | **63.0%** |
| Batch 16, `lr = 5e-5` | 4 | ~79 | 94.9% | 91.3% | 69.3% |
| Batch 8, `lr = 5e-5` | 4 | 158 | 95.7% | 93.3% | 74.9% |
| Batch 4, `lr = 5e-5` | 4 | 315 | 96.2% | 94.1% | 77.7% |
| **Batch 8, `lr = 1e-4`** | **4** | **158** | **96.5%** | **94.4%** | **79.1%** |

In just **4 epochs**, switching to batch 8 with a higher learning rate beat the 10-epoch batch-32 run by **+16.1 LAS points**! This motivated shifting the entire Phase 7 sweep to `batch_size = 8`, raising the learning-rate sweep to `[3e-5, 5e-5, 1e-4, 2e-4]`, and increasing the epoch cap to 15 (and later 30).

#### 2. Why `select = (chunk_f1 + las) / 2` Drives Early Stopping and Model Selection

Flat chunking (78 classes, mostly local cues) converges rapidly in the first 6–8 epochs and fluctuates within ±0.2 points thereafter. Dependency parsing (632 classes, long-range attachments) learns much more slowly and keeps climbing well past epoch 10. Stopping early on `chunk_f1` alone would freeze the model while Group B is still dramatically improving. Averaging `chunk_f1` and `las` ensures early stopping, checkpoint saving, LR selection, $\lambda$ selection, and offered-seed selection all balance both views.

### Strict Validation Hygiene and Unattended Execution

`scripts/run_phase7.py` (launched via `scripts/run_phase7_overnight.sh` under `nohup caffeinate -i -s`) enforces strict experimental discipline:
- **Zero test-set leakage:** Learning rate, $\lambda$, early stopping, and which of the 3 seeds becomes the offered checkpoint are decided **strictly on `dev`**. The `test` split is evaluated only once per final seed run and never influences any choice.
- **Process isolation & resumability:** Every training run executes in its own Python subprocess so Apple MPS GPU memory is completely released between runs. Each finished run writes a `summary.json` (and TensorBoard event logs); if interrupted, rerunning skips completed runs whose hyperparameters match. Unselected sweep weights are pruned (`prune_unselected: true`) to keep disk usage bounded while preserving all logs and `summary.json` records.

---

## 7. How Many Training Passes Were Run? Complete Schedule Breakdown

To give an exact picture of compute and experimental passes, here is every training pass conducted across the project so far (and queued for the remainder of the current stage):

### Gradient Steps per Epoch (at `batch_size = 8`)

| Model | Train Windows | Gradient Steps / Epoch | Max Steps (15-Epoch Base) | Max Steps (30-Epoch Extended) | Approx. Time / Epoch (M5 Pro MPS) |
|---|---:|---:|---:|---:|---:|
| `distilbert_base_cased` | 1,258 | 158 | 2,370 | 4,740 | ~24 s |
| `deberta_v3_xsmall` | 1,185 | 149 | 2,235 | 4,470 | ~40 s |
| `bert_base_cased` | 1,258 | 158 | 2,370 | 4,740 | ~46 s |
| `modernbert_base` | 1,216 | 152 | 2,280 | 4,560 | ~66 s |

### Accounting of All Training Passes

1. **Phase 0 — Environment Dummy Check (Complete):**
   - 4 models × 50 synthetic steps (`batch_size = 8`, 10 dummy labels) → 4 runs, ~57 s total.
2. **Phase 7 Task 0 — End-to-End Smoke Test (Complete):**
   - 4 models × 1 epoch on 64 train windows (8 gradient steps; 1.8 s – 4.6 s each) → 4 runs.
   - Immediately followed by ONNX export (`fp32`, `int8`, `fp16`) and Transformers.js Node inference verification (`training/reports/smoke_test.md`).
   - *Key technical fixes caught during the smoke test:*
     - Enabled **per-channel `int8` quantization** (reduced quantization error ~3× at the same file size).
     - Added a **topological graph re-sorter** (handling `If` subgraphs) because `onnxruntime` quantization left DeBERTa-v3's ONNX graph out of topological order, failing `onnx.checker`.
     - Verified that Transformers.js reproduces Python's token IDs identically using the `plain` word-encoding strategy for all four models (ModernBERT's saved tokenizer inserts the prefix space automatically).
     - Identified a Phase 9 risk early: on confident words (PyTorch top-two logit gap > 0.1), `int8` agreement was **99.7%–100.0%** for DistilBERT, DeBERTa, and BERT, but only **93.8% (Group A) / 90.8% (Group B)** for ModernBERT.
3. **Batch-Size Diagnostic Probe (Complete):**
   - 5 exploratory runs on `distilbert_base_cased` (one 10-epoch run + four 4-epoch runs) that led to switching from batch 32 to batch 8.
4. **Phase 7 — Base Stage (Complete — 5.9 hours unattended, 32 runs, 0 failures):**
   - For each of the 4 models, `run_phase7.py` executed a sequential 3-step search, automatically **reusing** overlapping configurations so nothing was trained twice:
     - **Step 1 (LR sweep):** 4 runs (`lr ∈ {3e-5, 5e-5, 1e-4, 2e-4}`, $\lambda = 1.0$, `seed = 13`).
     - **Step 2 ($\lambda$ sweep):** 2 *new* runs ($\lambda \in \{0.5, 2.0\}$ at best LR, `seed = 13`; $\lambda = 1.0$ reused from Step 1).
     - **Step 3 (Multi-seed confirmation):** 2 *new* runs (`seed ∈ {42, 2026}` at best LR & best $\lambda$; `seed = 13` reused from Step 1 or 2).
   - **Total:** **8 unique runs per model × 4 models = 32 runs**.
   - **Epochs actually run:** 29 of the 32 runs trained for the full **15 epochs**; 3 ModernBERT runs triggered early stopping at **epoch 14** (after peaking at epoch 11). In total, the base stage ran **477 epochs** (~73,400 gradient updates) across all four models.
5. **Phase 7 — Extended Stage (In Progress — up to 20 runs total):**
   - *Why an extended stage?* In the base stage, **all four models** selected the highest tested learning rate (`2e-4`) and **nearly every run peaked right at epoch 15**, strongly suggesting the models had not finished converging.
   - *Design:* Up to **30 epochs** (patience 3), LR sweep shifted upward to `{1e-4, 2e-4, 3e-4}`, and $\lambda$ fixed to each model's base-stage winner (`1.0` for DistilBERT/BERT/ModernBERT; `2.0` for DeBERTa) because $\lambda$ had changed dev scores by ≤ 0.4 points.
   - **Per model:** 3 LR-sweep runs (`seed = 13`) + 2 additional seeds (`42, 2026`) = **5 unique runs per model** (20 total when complete).
   - **Live progress (from `training/data/logs/phase7_status.json`, updated 2026-11-19 01:01 UTC):**

| Model | Extended Stage Status | Completed Runs (Epochs Run / Best Epoch) | Remaining |
|---|---|---|---|
| `distilbert_base_cased` | **Done (5/5)** | `lr=1e-4 s13` (16/13), `lr=2e-4 s13` (19/16), `lr=3e-4 s13` (13/10), `lr=1e-4 s42` (30/29), `lr=1e-4 s2026` (16/13) | None |
| `deberta_v3_xsmall` | **Done (5/5)** | `lr=1e-4 s13` (23/20), `lr=2e-4 s13` (27/24), `lr=3e-4 s13` (30/29), `lr=3e-4 s42` (18/15), `lr=3e-4 s2026` (21/18) | None |
| `bert_base_cased` | **Running (2/5 done, 3rd active)** | `lr=1e-4 s13` (30/29), `lr=2e-4 s13` (30/30); **`lr=3e-4 s13` currently running (20+ epochs logged)** | Finish `lr=3e-4 s13` + 2 final seeds (`42`, `2026`) + eval |
| `modernbert_base` | **Queued (0/5)** | None yet | 3 LR sweep runs + 2 final seeds + eval |

---

## 8. How Model Performance Changed Over Epochs and Across Runs

### Epoch-by-Epoch Learning Trajectories (Base Stage — 15 Epochs)

The tables below show the actual per-epoch dev metrics and end-of-epoch training loss extracted from `training/data/logs/phase7/` for the **selected (offered) seed run** of each model in the 15-epoch base stage.

#### `distilbert_base_cased` — `lr0.0002_w1_s2026` (15 epochs, 359.2 s)

| Epoch | Train Loss | Dev UPOS | Dev Chunk F1 | Dev Raw UAS | Dev Raw LAS | Dev `select` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2.1763 | 94.14 | 90.10 | 70.78 | 67.73 | 78.91 |
| 2 | 1.2339 | 95.91 | 93.24 | 79.28 | 77.07 | 85.16 |
| 3 | 0.7768 | 96.25 | 94.08 | 82.34 | 80.27 | 87.17 |
| 5 | 0.4749 | 96.35 | 94.44 | 84.24 | 82.24 | 88.34 |
| 8 | 0.2070 | 96.47 | 94.60 | 85.23 | 83.39 | 88.99 |
| 10 | 0.1337 | 96.54 | 94.71 | 85.53 | 83.68 | 89.20 |
| 12 | 0.0684 | 96.64 | 94.98 | 85.98 | 84.15 | 89.56 |
| **15 (best)** | **0.0419** | **96.63** | **95.11** | **86.21** | **84.40** | **89.76** |

#### `deberta_v3_xsmall` — `lr0.0002_w2_s13` ($\lambda = 2$, 15 epochs, 599.2 s)

| Epoch | Train Loss | Dev UPOS | Dev Chunk F1 | Dev Raw UAS | Dev Raw LAS | Dev `select` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5.9777 | 91.36 | 84.15 | 64.94 | 61.88 | 73.02 |
| 2 | 2.3371 | 95.74 | 92.58 | 80.18 | 78.33 | 85.46 |
| 3 | 1.6889 | 96.73 | 94.79 | 84.60 | 82.86 | 88.82 |
| 5 | 0.9579 | 97.22 | 95.70 | 87.65 | 85.94 | 90.82 |
| 8 | 0.5118 | 97.38 | 96.45 | 89.47 | 87.85 | 92.15 |
| 10 | 0.4363 | 97.47 | 96.55 | 89.79 | 88.22 | 92.38 |
| 12 | 0.3078 | 97.54 | 96.69 | 90.13 | 88.49 | 92.59 |
| **15 (best)** | **0.2244** | **97.57** | **96.62** | **90.35** | **88.71** | **92.67** |

#### `bert_base_cased` — `lr0.0002_w1_s42` (15 epochs, 690.2 s)

| Epoch | Train Loss | Dev UPOS | Dev Chunk F1 | Dev Raw UAS | Dev Raw LAS | Dev `select` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2.0112 | 94.91 | 91.96 | 72.64 | 70.10 | 81.03 |
| 2 | 1.1809 | 96.01 | 94.41 | 80.60 | 78.51 | 86.46 |
| 3 | 0.7891 | 96.47 | 94.59 | 83.82 | 81.78 | 88.19 |
| 5 | 0.4227 | 96.71 | 95.43 | 85.52 | 83.79 | 89.61 |
| 8 | 0.2016 | 96.84 | 95.60 | 86.85 | 85.14 | 90.37 |
| 10 | 0.1213 | 97.01 | 95.83 | 87.66 | 86.00 | 90.91 |
| 12 | 0.0608 | 96.98 | 95.73 | 87.77 | 86.13 | 90.93 |
| **15 (best)** | **0.0292** | **96.97** | **95.93** | **88.02** | **86.39** | **91.16** |

#### `modernbert_base` — `lr0.0002_w1_s42` (15 epochs, 988.9 s; peaked at epoch 12)

| Epoch | Train Loss | Dev UPOS | Dev Chunk F1 | Dev Raw UAS | Dev Raw LAS | Dev `select` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1.5211 | 94.72 | 92.95 | 73.78 | 71.39 | 82.17 |
| 2 | 0.8578 | 96.80 | 95.35 | 83.51 | 81.54 | 88.45 |
| 3 | 0.4737 | 97.33 | 95.95 | 86.43 | 84.66 | 90.31 |
| 5 | 0.1438 | 97.61 | 96.62 | 88.35 | 86.73 | 91.68 |
| 8 | 0.0104 | 97.69 | 96.85 | 89.40 | 87.91 | 92.38 |
| 10 | 0.0034 | 97.72 | 96.89 | 89.60 | 88.13 | 92.51 |
| **12 (best)** | **0.0014** | **97.69** | **96.92** | **89.68** | **88.21** | **92.56** |
| 15 | 0.0010 | 97.69 | 96.90 | 89.65 | 88.20 | 92.55 |

### Extended Stage Trajectories (30 Epochs — Completed Runs So Far)

Extending the schedule to 30 epochs revealed distinct convergence behaviors across architectures:

| Epoch | DistilBERT (`lr=1e-4, s42`) Loss / ChF1 / LAS | DeBERTa-v3-xsmall (`lr=3e-4, w2, s13`) Loss / ChF1 / LAS | BERT-base (`lr=1e-4, s13`) Loss / ChF1 / LAS |
|---:|---|---|---|
| 1 | 3.858 / 82.68 / 50.23 | 7.108 / 79.31 / 57.83 | 3.540 / 86.81 / 53.08 |
| 2 | 1.981 / 91.24 / 68.89 | 2.609 / 91.56 / 76.80 | 1.800 / 92.91 / 72.85 |
| 5 | 0.690 / 94.63 / 80.67 | 0.986 / 95.79 / 85.94 | 0.651 / 95.52 / 82.84 |
| 10 | 0.279 / 94.90 / 82.99 | 0.396 / 96.47 / 87.75 | 0.197 / 95.93 / 85.39 |
| 15 | 0.119 / 95.20 / 83.70 | 0.146 / 96.45 / 88.71 | 0.097 / 95.94 / 86.03 |
| 20 | 0.059 / 95.35 / 83.62 | 0.082 / 96.53 / 88.76 | 0.034 / 95.99 / 86.04 |
| 25 | 0.028 / 95.21 / 84.11 | 0.029 / 96.46 / 88.81 | 0.016 / 96.04 / 86.50 |
| **29 (best)** | **0.022 / 95.25 / 84.27** | **0.023 / 96.61 / 89.23** | **0.011 / 96.11 / 86.54** |
| 30 | 0.019 / 95.24 / 84.24 | 0.017 / 96.60 / 89.17 | 0.010 / 96.11 / 86.50 |

*(Note: Because the 30-epoch linear schedule stretches the 10% warmup over 3 full epochs instead of 1.5 epochs, epoch 1–2 scores start slightly lower than in the 15-epoch runs before catching up and overtaking around epochs 15–29.)*

### Four Key Patterns in the Learning Curves

1. **Two-Speed Convergence (Flat vs. Structural Tasks):**
   Across every model, UPOS and Chunk F1 shoot up in the first 3–5 epochs (reaching within ~0.5 points of their final ceiling by epoch 5–6), while dependency LAS climbs dramatically from ~62–71% at epoch 1 to ~84–89% by epochs 15–29. This directly validates using `select = (chunk_f1 + las) / 2` for early stopping: stopping when chunk F1 plateaued would have sacrificed 2–4 points of dependency LAS.
2. **Sharp Differences in Capacity and Memorization Speed:**
   - **ModernBERT-base** (22 layers, ~150M params) memorizes the training windows extraordinarily fast — training loss collapses to **0.0010** by epoch 15, and dev `select` peaks earliest (epoch 11–12 on two of three seeds, triggering early stopping at epoch 14 on `s2026`). Even after train loss hits ~0.001, dev metrics do not degrade (a classic benign-overfitting / double-descent plateau in fine-tuned transformers), though it suggests 30 epochs may offer limited extra headroom for ModernBERT.
   - **DeBERTa-v3-xsmall** starts with the highest initial loss (5.98 base / 7.11 extended, partly due to $\lambda = 2.0$ doubling the Group B loss scale) and lowest epoch-1 scores, yet it keeps learning productively all the way to epoch 29 without saturating — surpassing every other model on dependency structure (`Tree UAS 92.26%`, `Tree LAS 90.42%`, `Nested F1 86.43%` in extended) despite being half the parameter count of ModernBERT! Its disentangled relative-position attention clearly pays off on relative-POS head prediction.
   - **DistilBERT** hits its representational ceiling early: pushing the LR to `3e-4` in the extended stage hurt performance (`lr=3e-4` early-stopped at epoch 13 with dev LAS 82.26% vs. 84.22% in base), and 30 epochs at `1e-4` offered no meaningful gain over 15 epochs at `2e-4`.
   - **BERT-base-cased** benefits modestly from 30 epochs at `lr=1e-4` (dev LAS rose from `86.23%` to `86.54%`; `lr=3e-4` is currently underperforming around `84.68%` LAS at epoch 20, so `lr=1e-4` is on track to win BERT's extended sweep).
3. **High Sensitivity to Learning Rate, Low Sensitivity to $\lambda$:**
   In the base-stage sweeps (dev split), raising LR from `3e-5` to `2e-4` boosted raw LAS by **+4.5 points** on DistilBERT, **+9.4 points** on DeBERTa, **+3.0 points** on BERT, and **+5.8 points** on ModernBERT. By contrast, sweeping $\lambda \in \{0.5, 1.0, 2.0\}$ moved dev scores by at most **0.3–0.4 points** across all models (with only DeBERTa preferring $\lambda = 2.0$, gaining +0.34 LAS over $\lambda = 1.0$).
4. **Tight Multi-Seed Stability:**
   Across the three seeds (`13`, `42`, `2026`), test UPOS and Chunk F1 standard deviations are tiny (**±0.03 to ±0.14 points**), confirming that results are reproducible and not artifacts of a lucky random initialization.

### Summary of Test Results So Far (Baselines vs. Base Stage vs. Extended Stage)

All figures below are held-out **EWT test split** percentages for each model's dev-selected seed run (with 3-seed mean ± sd noted in the text below):

| System / Model | Stage & Selected Seed Run | Test UPOS | Test Chunk F1 | Raw UAS / LAS | Tree UAS / LAS | Nested F1 | Repaired Sents | Flat Gate (≥97 / ≥94) | Nested Gate (old 97/94) |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| `wink-nlp` (baseline) | Phase 5 | 88.76 | — | — | — | — | — | — | — |
| `compromise` (baseline) | Phase 5 | 82.36 | 69.65 | — | — | — | — | — | — |
| **DistilBERT** | Base (`lr2e-4_w1_s2026`, 15 ep) | 96.67 | 95.20 | 85.91 / 84.17 | 88.15 / 86.05 | 79.26 | 33.77% | No (-0.33 UPOS) | No |
| **DistilBERT** | Extended (`lr1e-4_w1_s42_e30`, 30 ep) | 96.73 | 95.34 | 85.54 / 83.89 | 87.97 / 85.92 | 78.60 | 35.65% | No (-0.27 UPOS) | No |
| **DeBERTa-v3-xsmall** | Base (`lr2e-4_w2_s13`, 15 ep) | **97.62** | **96.75** | 90.18 / 88.73 | 91.57 / 89.79 | 85.36 | 23.22% | **Yes** | No |
| **DeBERTa-v3-xsmall** | Extended (`lr3e-4_w2_s13_e30`, 30 ep) | **97.52** | **96.68** | **90.87 / 89.35** | **92.26 / 90.42** | **86.43** | **21.00%** | **Yes** | No |
| **BERT-base-cased** | Base (`lr2e-4_w1_s42`, 15 ep) | 96.89 | 95.81 | 87.53 / 85.93 | 89.68 / 87.73 | 81.11 | 30.88% | No* (-0.11 UPOS) | No |
| **BERT-base-cased** | Extended (30 ep) | *Running* | *Running* | *Running* | *Running* | *Running* | *Running* | *Pending* | *Pending* |
| **ModernBERT-base** | Base (`lr2e-4_w1_s42`, 15 ep) | **97.67** | **96.94** | 89.72 / 88.30 | 91.42 / 89.68 | 83.76 | 27.26% | **Yes** | No |
| **ModernBERT-base** | Extended (30 ep) | *Queued* | *Queued* | *Queued* | *Queued* | *Queued* | *Queued* | *Pending* | *Pending* |

*\*Note on BERT-base-cased: two of BERT's three base-stage seeds (`s13`: 97.01%, `s2026`: 97.05%) did exceed 97.00% test UPOS (3-seed mean 96.98 ± 0.09%), while the dev-selected seed (`s42`) landed at 96.89%.*

#### Per-Phrase-Type Chunk F1 Breakdown (Test, Best Completed Run per Model)

| Model (Run) | NP F1 | VP F1 | PP F1 | ADVP F1 | ADJP F1 | Overall Chunk F1 |
|---|---:|---:|---:|---:|---:|---:|
| `compromise` (baseline) | 73.52 | 63.57 | 88.25 | 0.00 | 28.30 | 69.65 |
| `distilbert_base_cased` (`e30`) | 94.76 | 97.25 | 97.97 | 91.16 | 88.49 | 95.34 |
| `bert_base_cased` (base) | 95.50 | 97.46 | 98.23 | 91.35 | 87.85 | 95.81 |
| `deberta_v3_xsmall` (`e30`) | 96.19 | 98.12 | 98.67 | 93.31 | 92.44 | 96.68 |
| `modernbert_base` (base) | **96.58** | **98.26** | **98.77** | **93.36** | **92.64** | **96.94** |

Every neural candidate beats the classical baselines by **+8 to +9 points on UPOS** and **+25 to +27 points on Chunk F1**, with the largest improvements on the hardest minority phrases (`ADJP` jumping from 28% to ~92.6%, and `ADVP` from 0% to ~93.4%).

---

## 9. What Comes Next: Remaining Phase 7 Work and Phases 8–12

### 1. Finishing the Extended Stage and Error Analysis (Phase 7)

Once `bert_base_cased` finishes `lr=3e-4` and its remaining two seeds, `modernbert_base` will run its 5 extended-stage runs (expected ~1.5–2 hours on MPS). Afterward, Phase 7 Task 5 will sample and categorize 100 test errors per model (`reports/errors.md`, focusing on noun/verb homographs, PP chunks, coordination, and PP attachment).

### 2. Planned Architectural Upgrade: Biaffine Parser Head + MST Decoding

Even at 30 epochs, `rel_pos_v1` sequence labeling hits a clear structural ceiling: on `deberta_v3_xsmall`, **21%–23% of test sentences still require ad-hoc tree repair** (fixing cycles, multiple roots, or unresolvable UPOS offsets). Yet diagnostic analysis on DeBERTa's test predictions uncovered a striking fact: **the true head is already inside the top-5 predicted head labels for 96.7% of words**, and running a spanning-tree algorithm over relative-POS labels did not improve accuracy because relative-POS labels are inherently indirect (an error in a word's UPOS shifts the offset count for every dependent pointing past it).

To break through this ceiling and reach the revised nested-view targets (UAS excl. punct ≥ 93%, multi-word bracket F1 ≥ 88%, shown-bracket precision ≥ 95%), the project owner approved upgrading Group B to a **Biaffine Dependency Parser Head** (Dozat & Manning, 2017) after the extended stage:

- **How a biaffine arc scorer works:**
  Instead of classifying each word into 632 fixed offset strings, each word's contextual hidden vector $h_i \in \mathbb{R}^{H}$ is passed through two small MLP projections to create a "dependent" vector $d_i$ and a "head" vector $p_i$ (with the sentence's `[CLS]` special token representing `ROOT`). A learned bilinear matrix $W$ + linear bias $b$ then scores **every possible directed edge** from candidate head $j$ to dependent $i$ in the sentence:
  $$s(j \to i) = d_i^\top W p_j + b^\top d_i$$
  For an $n$-word sentence, this directly produces an $(n+1) \times (n+1)$ matrix of pairwise arc scores — no UPOS counting, no unresolvable offsets, and no rare-label loss for long-distance attachments. Dependency relation labels remain a compact per-word classification (~37 base UD relations instead of 632 offset-relation pairs) inside the packed logits.
- **Chu-Liu-Edmonds Maximum Spanning Tree (MST) decoding:**
  At inference time, `treeDecoder.ts` will run the **Chu-Liu-Edmonds algorithm** over the pairwise arc score matrix. Unlike greedy per-word argmax + heuristic cycle repair, Chu-Liu-Edmonds is guaranteed to find the **globally highest-scoring valid directed spanning tree** rooted at `[CLS]` in polynomial time — guaranteeing exactly one root, zero cycles, and zero unresolvable heads.
- **ONNX & Transformers.js integration:**
  Arc scores will be exported as a **second ONNX output** alongside `logits`, read via Transformers.js's `model.forward()` (which preserves all named ONNX outputs). All four candidate models will be retrained with the biaffine head (expected **+1–2 UAS points**) before proceeding to Phase 8.

### 3. Phase 8 — Probability Calibration and Confidence Gating

Fine-tuned neural networks are notoriously **overconfident**: a model that assigns 0.99 probability to a tag may actually be right only 92% of the time. Because Enparse uses probabilities both to flag **ambiguous alternative parses** and to **confidence-gate nested brackets**, Phase 8 (`scripts/calibrate.py`) will calibrate every qualifying model on the `dev` split:

- **Temperature scaling:** Fits one scalar temperature $T > 0$ per group ($T_A$ for Group A, $T_B$ for Group B) by minimizing negative log-likelihood on dev logits:
  $$p = \text{softmax}\!\left(\frac{z}{T}\right)$$
  When $T > 1$, the distribution softens without changing the rank order of classes — meaning accuracy and F1 are completely untouched while **Expected Calibration Error (ECE)** drops sharply.
- **Ambiguity margins & confidence gating:** Tunes `ambiguity.margin` (proposed ~0.2, capped at 5 valid BIO alternatives per sentence) and `ambiguity.attachment_margin` (for PP-attachment alternatives), plus the nested-bracket confidence threshold required to reach **≥ 95% precision on shown brackets** (collapsing uncertain brackets flat inside their parent phrase). All fitted values are stored in each model's `labels.json`.

### 4. Phase 9 — ONNX Export, Quantization, and Parity Checks

Using `scripts/export_onnx.py` (`optimum-onnx`, ONNX opset 18), each offered model's best PyTorch checkpoint will be converted into browser-ready ONNX files:
- **`onnx/model.onnx` (`fp32`):** Full 32-bit precision used solely as a verification reference (not shipped). Must match PyTorch on **≥ 99.9%** of dev words.
- **`onnx/model_quantized.onnx` (`int8` dynamic, per-channel):** Compresses weights to 8-bit integers (~¼ the size of `fp32`) for **WebAssembly (CPU)** execution.
- **`onnx/model_fp16.onnx` (`fp16` weights, `fp32` I/O):** Half-precision weights (~½ size) optimized for **WebGPU** execution.
- **Parity gate:** Neither `int8` nor `fp16` may drop more than **0.3 points** in Chunk F1 or LAS relative to `fp32` on the full dev split. If ModernBERT's `int8` quantization exceeds that drop (as flagged in the smoke test), sensitive layers (such as embeddings or classifier projections) will be excluded via `int8_exclude_nodes`, or ModernBERT will be offered as `fp16` (WebGPU) only.

### 5. Phases 10–12 — Browser Benchmarking, Packaging, and Maintenance

- **Phase 10 (Browser Benchmarking):** A minimal Vite harness (`training/js/bench-page/`) will run each offered model inside a Web Worker across Chrome, Safari, and Firefox (both WebGPU and WASM) on a fixed 5,000-character English passage (median of 10 runs), verifying the **≤ 5 s** parse budget and measuring peak memory and load times (including on lower-end hardware) to populate `src/modules/preflight/requirements.ts`.
- **Phase 11 (Packaging and Release):** `scripts/package_models.py` will copy each offered model's tokenizer, config, ONNX variants, and finalized `labels.json` (with `model_version`, `tokenizer_word_encoding`, and SHA-256 checksums for every file) into `public/models/<model-id>/` (tracked with Git LFS), generate `public/models/catalog.json`, complete `training/MODEL_CARD.md`, and run end-to-end app integration tests.
- **Phase 12 (Ongoing Maintenance):** Future releases can ingest opt-in user-corrected sentences exported locally from the browser, leveraging the partial-label (`-100`) pipeline already built in Phase 4, and repeat Phases 7–11 whenever a new UD release, better base encoder, or ~200+ regression sentences warrant retraining.
