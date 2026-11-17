"""
training/scripts/derive_chunks.py — convert UD dependency trees to flat BIO chunks

Description:
    UD has dependency trees, not chunks. This script derives flat,
    non-recursive CoNLL-2000-style chunks (NP, VP, PP, ADJP, ADVP, O) from
    each UD sentence and writes per-word BIO chunk tags alongside UPOS.

Phase: 2 — Chunk derivation from UD trees.

Rules (initial; from plan-training.md → Phase 2):
    NP   head NOUN/PROPN/PRON/NUM (nominal); includes left det, amod, nummod,
         compound, nmod:poss, flat, fixed; post-modifiers form own chunks.
    VP   head VERB/AUX (predicate); includes aux, aux:pass, cop, negation
         advmod ("not"), compound:prt if contiguous; excludes objects.
    PP   ADP with `case` relation; includes `fixed` multiword prepositions;
         the following NP is a separate chunk.
    ADJP ADJ not inside an NP; includes left advmod.
    ADVP ADV not absorbed by VP or ADJP; includes left advmod.
    O    punctuation, conjunctions, other.
    Chunks must be contiguous; non-contiguous spans are split at the gap.

Tasks:
    1. Parse .conllu files with `conllu`; skip multiword-token range lines
       and empty nodes here (multiword handling happens in Phase 3).
    2. Apply the rules above to assign chunk spans; emit BIO tags.
    3. Expose a pure function (sentence -> list of BIO tags) for tests.
    4. Write chunked output per split, keeping sent_id, newdoc id, and
       `# text =` metadata for later alignment and windowing.
    5. Write chunk-type distribution per split to reports/chunks.md.
    6. Support a review mode: sample N dev sentences (seeded) to a review
       file for the manual error-rate check (target < 2% of chunks).

Dependencies:
    Python: conllu, pyyaml, pandas (report).
    Reads:  configs/data.yaml (paths.raw, paths.chunked, seed);
            data/raw/ud_ewt/*.conllu.
    Writes: data/processed/chunked/ (git-ignored); reports/chunks.md;
            reports/chunk_review.md (review log).
    Tested by: tests/test_derive_chunks.py.
    Consumed by: js/align_tokens.mjs, scripts/prepare_data.py.

Status: header only; not implemented.
"""
