"""
training/scripts/prepare_data.py — build labels, windows, and splits for training

Description:
    Turns aligned, chunk-tagged sentences into a Hugging Face `datasets`
    dataset of multi-sentence windows with combined `UPOS|CHUNK` labels on
    the first subword of each word. Also writes labels.json (label map).

Phase: 4 — Dataset building.

Tasks:
    1. Load wink-aligned words (js/align_tokens.mjs output) with UPOS and
       BIO chunk tags.
    2. Combine tags into `UPOS|CHUNK` labels; build the label map; drop
       combinations seen < min_label_count times in train and map them to
       the nearest valid label.
    3. Build windows: consecutive sentences from the same document
       (`# newdoc id`) packed up to max_subword_tokens, keeping sentence
       boundaries. Split long single sentences with the configured overlap.
    4. Tokenize with the base model's tokenizer; label the first subword of
       each word, set the rest to -100. Partial labels: words with
       reviewed=False get -100 on every subword; windows with no reviewed
       word are dropped; label counts use reviewed words only.
    5. Keep official EWT train/dev/test splits. Test is reserved for the
       Phase 7 final evaluation.
    6. Optional augmentation (train only, <= max_fraction of windows):
       lowercase sentence starts, drop final punctuation, learner typos.
    7. Save datasets to data/processed/dataset/<model>/ and labels.json
       (schema v1, Phase 4 fields; plan-training.md → Phase 4).
    8. Write dataset statistics (label counts, window lengths) to
       reports/dataset.md.

Dependencies:
    Python: datasets, transformers (tokenizer), numpy, pandas, pyyaml.
    Reads:  configs/data.yaml (paths, windows, labels, augmentation, seed);
            configs/train_<model>.yaml (model_name for the tokenizer);
            data/processed/aligned/.
    Writes: data/processed/dataset/ and data/processed/labels.json
            (git-ignored); reports/dataset.md.
    Tested by: tests/test_prepare_data.py.
    Consumed by: scripts/train.py, scripts/calibrate.py, scripts/evaluate.py.
    Network: downloads tokenizer from the Hugging Face Hub (development only).

Status: header only; not implemented.
"""
