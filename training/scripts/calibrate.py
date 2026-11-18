"""
training/scripts/calibrate.py — temperature calibration and ambiguity margin tuning

Description:
    Makes label probabilities reliable for runtime alternatives. Fits one
    temperature on dev logits and picks the ambiguity margin that balances
    coverage of the correct label against the alternatives-per-sentence cap.

Phase: 8 — Calibration and ambiguity threshold.

Tasks:
    1. Run the best checkpoint on dev; collect first-subword logits per word.
    2. Fit a single temperature (minimize NLL); report expected calibration
       error (ECE) before and after.
    3. For each candidate margin: measure how often the correct label is in
       the alternatives and the mean number of alternatives per sentence,
       respecting max_alternatives (5).
    4. Pick the margin; write temperature and margin into labels.json.
    5. Write the calibration report to reports/calibration.md.
    6. Remind: record the chosen margin in architecture.md (exit criterion).

Dependencies:
    Python: torch, transformers, datasets, numpy, pandas, pyyaml.
    Reads:  configs/eval.yaml (calibration, ambiguity);
            configs/train_<model>.yaml (checkpoint); configs/data.yaml;
            data/processed/dataset/<model>/ (dev split and labels.json), per candidate.
    Writes: data/processed/dataset/<model>/labels.json (temperatures, margins);
            reports/calibration.md.
    Related: src/modules/parser/ambiguity.ts and transformerBackend.ts use
             the same temperature and margin at runtime.

Status: header only; not implemented.
"""
