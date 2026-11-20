# Smoke test: biaffine head (T05)

Per candidate: 1-epoch training on a small train subset (`train.py --smoke`), ONNX export (`export_onnx.py`), and a Transformers.js load-and-parse check in Node (`js/benchmark.mjs --mode smoke`). Scores after 1 epoch on a subset are not meaningful; the test checks that every step works. *Confident words*: PyTorch's top-two logit gap > `parity.smoke_margin`; int8/fp16 are judged there (near-ties flip under any rounding).

Biaffine exports have two ONNX outputs (`logits`, `arc_scores`), read in Transformers.js with `model.forward()`. Groups: A (UPOS|CHUNK) / B (relation) / arc (argmax head per word over its sentence plus root).

| Model | Train (s) | int8 / fp16 MB | onnx.checker | Tokenizer strategy | JS vs PyTorch agreement A / B / arc, all words (fp32, int8, fp16) | … on confident words | Result |
|---|---|---|---|---|---|---|---|
| bert_base_cased | 3.6 | 113.2 / 218.0 | ok | plain | 1.000 / 1.000 / 1.000, 0.975 / 0.990 / 0.950, 0.999 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000, 1.000 / 0.999 / 0.997, 1.000 / 1.000 / 1.000 | Pass |
| deberta_v3_xsmall | 3.5 | 89.9 / 144.0 | ok | plain | 1.000 / 1.000 / 1.000, 0.912 / 0.928 / 0.932, 0.997 / 0.997 / 0.997 | 1.000 / 1.000 / 1.000, 0.999 / 0.985 / 0.977, 1.000 / 0.999 / 1.000 | Pass |
| distilbert_base_cased | 2.7 | 70.1 / 132.8 | ok | plain | 1.000 / 1.000 / 1.000, 0.967 / 0.991 / 0.941, 0.998 / 0.999 / 0.999 | 1.000 / 1.000 / 1.000, 1.000 / 1.000 / 0.994, 1.000 / 1.000 / 1.000 | Pass |
| modernbert_base | 4.8 | 155.6 / 302.2 | ok | plain | 1.000 / 1.000 / 1.000, 0.792 / 0.774 / 0.775, 0.986 / 0.984 / 0.987 | 1.000 / 1.000 / 1.000, 0.875 / 0.849 / 0.775, 0.997 / 0.997 / 0.987 | **Fail** |

## Problems

- modernbert_base: int8: group A agreement on confident words 0.8745 < 0.9
- modernbert_base: int8: group B agreement on confident words 0.8495 < 0.9
- modernbert_base: int8: group arc agreement on confident words 0.7753 < 0.9
