# Chunk review log (Phase 2)

Manual review of derived chunks on a seeded dev sample, per `plan-training.md` → Phase 2 task 3.

- **Sample:** 200 dev sentences, seed 13 (`configs/data.yaml` → `chunks.review`). Generated with `python scripts/derive_chunks.py --review` into `data/processed/review/chunk_review_sample.md` (git-ignored, because it contains corpus text). This log lists sentence numbers and short descriptions only.
- **Reviewer:** Claude Opus 5.5 (agent), 2026-11-18. Accepted by the owner without a separate spot-check.
- **Standard:** CoNLL-2000-style base chunks under the rules and conventions in `plan-training.md` → Phase 2 (*Rules*, *Rule details*). Errors caused by wrong UD annotation or typos in the source text are not counted.
- **Error unit:** one chunk with the wrong span or type (a wrong split counts once).

## Result

| Round | Rules | Chunks in sample | Errors | Error rate |
|-------|-------|------------------|--------|------------|
| 1 | Initial plan rules | 1,397 | ~35 | ~2.5% |
| 2 (final) | Initial rules + *Rule details* refinements | 1,375 | 5 | **0.36%** |

Target: < 2% of chunks. **Met.**

## Round 1 — errors and fixes

Round 1 was reviewed while fixing rules, so its count is approximate.

| Error pattern | Example (sample #) | Fix (rule detail) |
|---------------|--------------------|-------------------|
| Dates and times split (`October` / `4th`, `05:09` / `PM`) | 18, 37, 52, 62, 93, 96 | `nmod:unmarked` next to its head joins the NP |
| Title split from name | 7 | `nmod:desc` right before its head joins the NP |
| Bare number quantifier outside NP (`more than` / `200`) | 4 | Left `advmod` of a NUM head joins the NP |
| Nominal adjectives as ADJP (`the same`, `Most of`, `has more`, `on average`, `there own`, `the first`) | 5, 83, 97, 100, 105, 113 | ADJ with `det`/`nmod:poss`/`case` dependent or argument relation → NP |
| Preposition before gerund tagged O (`of building`, `by giving`, `with men dressing`) | 63, 85, 88, 94 | `mark` with a preposition lemma on a VERB → PP |
| Stacked prepositions split (`out` / `of`) | 108 | Adjacent `case` words of one head form one PP |
| `else` split from pronoun | 54, 153 | Right-adjacent `else` joins the NP |
| `any and all` split | 141 | DET allowed as coordinated pre-modifier |
| `as well as` tagged ADVP | 185 | `cc` (with its `fixed` parts) is always O |
| Sentence punctuation and brackets absorbed into NP | 160, 175 | Only `-`, `–`, `/`, `,`, `+`, quotes can be chunk-internal |
| Non-adjacent left `advmod` joined an ADJP and was cut off (`however … together`, `Now … able`) | 167, 181 | Left `advmod`/`amod` joins ADJP/ADVP only if the gap is filled by its own subtree or the chunk |
| Coordinated modifier with own adverb split NP (`Friendly Efficient and overall great place`) | 190 | Left dependents of absorbed conjunct modifiers join |
| `S. 10th & Federal Sts.` split in three | 174 | `cc` joins only when its conjunct is in the same NP |

## Round 2 — remaining errors

| # | Error | Cause |
|---|-------|-------|
| 1 | `[NP Columbia] [NP Court]` should be one NP | `District` (compound of `Court`) carries post-modifier `of Columbia`; gap split leaves `Columbia` and `Court` apart |
| 15 | `on how agreeable` — `on` is O, should be PP | `mark` on an ADJ predicate (rule covers VERB heads only) |
| 79 | `the Chillicothe , OH area` split in three | Place name with comma inside a compound |
| 100 | `3 TO 4 DAYS` split in four | Number range with `to` as `case` |
| 160 | `4783` / `Bay Rd` split | Street address structure |

## Corpus-wide checks (train, final rules)

Run after round 2, without full review:

- BIO validity: every sentence passes `validate_bio` (enforced by `derive_chunks.py`).
- Chunked files equal the raw files once `Chunk=` is removed from MISC.
- Lone-determiner NPs (a `det` cut off from its head): 35 of 56,748 NPs (mostly brackets or interjections inside the NP).
- Chunks starting or ending with a conjunction: 7.
