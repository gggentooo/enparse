"""
training/tests/test_prepare_data.py — unit tests for dataset building

Description:
    Checks label construction, windowing, and subword alignment in
    scripts/prepare_data.py on small synthetic inputs.

Phase: 4 — Dataset building.

Tasks:
    1. Combined labels: UPOS and chunk join to `UPOS|CHUNK`; rare combos
       (< min_label_count) map to the nearest valid label.
    2. Windows: sentences packed only within one document; boundaries kept;
       no window exceeds max_subword_tokens; long sentences split with the
       configured overlap.
    3. Subword alignment: only the first subword of each word is labeled;
       others are -100; special tokens are -100.
    4. Splits: test sentences never appear in train/dev windows.
    5. Augmentation: applied to train only, within max_fraction.

Dependencies:
    Python: pytest, transformers (small cased tokenizer, cached locally).
    Tests:  scripts/prepare_data.py.
    Data:   inline fixtures only; no files from data/.

Status: header only; not implemented.
"""
