# Smoke test (Phase 7 task 0)

Per candidate: 1-epoch training on a small train subset (`train.py --smoke`), ONNX export (`export_onnx.py`), and a Transformers.js load-and-parse check in Node (`js/benchmark.mjs --mode smoke`). Scores after 1 epoch on a subset are not meaningful; the test checks that every step works. *Confident words*: PyTorch's top-two logit gap > `parity.smoke_margin`; int8/fp16 are judged there (near-ties flip under any rounding).

| Model | Train (s) | int8 / fp16 MB | onnx.checker | Tokenizer strategy | JS vs PyTorch agreement A / B, all words (fp32, int8, fp16) | … on confident words | Result |
|---|---|---|---|---|---|---|---|
| bert_base_cased | 3.3 | 109.4 / 216.8 | ok | plain | 1.000 / 1.000, 0.919 / 0.888, 0.998 / 0.997 | 1.000 / 1.000, 1.000 / 0.998, 1.000 / 1.000 | Pass |
| deberta_v3_xsmall | 2.7 | 87.5 / 143.2 | ok | plain | 1.000 / 1.000, 0.919 / 0.904, 0.997 / 0.996 | 1.000 / 1.000, 0.997 / 0.998, 1.000 / 1.000 | Pass |
| distilbert_base_cased | 1.8 | 66.3 / 131.6 | ok | plain | 1.000 / 1.000, 0.925 / 0.868, 0.998 / 0.998 | 1.000 / 1.000, 1.000 / 1.000, 1.000 / 1.000 | Pass |
| modernbert_base | 4.6 | 151.8 / 301.0 | ok | plain | 1.000 / 1.000, 0.848 / 0.770, 0.995 / 0.992 | 1.000 / 1.000, 0.938 / 0.908, 1.000 / 1.000 | Pass |

## Problems

None.
