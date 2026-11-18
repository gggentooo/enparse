"""
training/tests/conftest.py — shared pytest fixtures for training tests

Description:
    Common fixtures used by test_derive_chunks.py and test_prepare_data.py.

Phases: 2, 4.

Fixtures:
    rows_to_conllu  — build CoNLL-U text from compact "form UPOS head deprel [lemma]"
                      rows (no files from data/).
    parse_conllu    — parse CoNLL-U text into `conllu` sentences.

Dependencies:
    Python: pytest, conllu. Config: training/pyproject.toml (pythonpath = scripts).
    Used by: tests/test_derive_chunks.py (Phase 2), tests/test_prepare_data.py (Phase 4).

Status: implemented (Phase 2). Phase 4 tests build their fixtures inline (test_prepare_data.py).
"""

from __future__ import annotations

from collections.abc import Callable

import conllu
import pytest


def _rows_to_conllu(rows: list[str], sent_id: str = "test-1") -> str:
    lines = [f"# sent_id = {sent_id}"]
    forms: list[str] = []
    for i, row in enumerate(rows, 1):
        parts = row.split()
        form, upos, head, deprel = parts[:4]
        lemma = parts[4] if len(parts) > 4 else form.lower()
        forms.append(form)
        lines.append("\t".join([str(i), form, lemma, upos, "_", "_", head, deprel, "_", "_"]))
    lines.insert(1, f"# text = {' '.join(forms)}")
    return "\n".join(lines) + "\n\n"


@pytest.fixture
def rows_to_conllu() -> Callable[..., str]:
    """Return a builder: compact rows -> one CoNLL-U sentence block."""
    return _rows_to_conllu


@pytest.fixture
def parse_conllu() -> Callable[[str], list[conllu.TokenList]]:
    """Return a parser: CoNLL-U text -> list of sentences."""
    return conllu.parse
