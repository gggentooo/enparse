"""
training/tests/conftest.py — shared pytest fixtures for training tests

Description:
    Common fixtures used by test_derive_chunks.py and test_prepare_data.py.

Phases: 2, 4.

Tasks:
    1. Make training/scripts/ importable from tests.
    2. Fixture: parse an inline CoNLL-U string into `conllu` sentences.
    3. Fixture: minimal in-memory data/eval config (no real paths).

Dependencies:
    Python: pytest, conllu.
    Used by: tests/test_derive_chunks.py, tests/test_prepare_data.py.

Status: header only; not implemented.
"""
