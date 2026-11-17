"""
training/tests/test_derive_chunks.py — unit tests for UD-to-chunk derivation

Description:
    Hand-written UD sentences with expected BIO chunk tags, checking each
    rule in scripts/derive_chunks.py and its edge cases.

Phase: 2 — Chunk derivation from UD trees (exit criterion: tests pass).

Tasks:
    1. ~30 cases in inline CoNLL-U, at least one per rule:
       NP (det/amod/nummod/compound/nmod:poss/flat/fixed; post-modifiers
       excluded), VP (aux, aux:pass, cop, "not", phrasal-verb particle),
       PP (case, multiword "because of"), ADJP ("very happy"), ADVP, O.
    2. Edge cases: coordination, possessives, phrasal verbs, passives,
       questions, non-contiguous spans split at the gap.
    3. Assert output is valid BIO (no I- without matching B-).

Dependencies:
    Python: pytest, conllu.
    Tests:  scripts/derive_chunks.py (pure sentence -> BIO function).
    Data:   inline fixtures only; no files from data/.

Status: header only; not implemented.
"""
