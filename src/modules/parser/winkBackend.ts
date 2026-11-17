/**
 * src/modules/parser/winkBackend.ts — wink-nlp support and fallback ParserBackend
 *
 * Description:
 *   Always used for sentence splitting, word tokenization, and lemmas.
 *   Also the fallback ParserBackend: wink POS tags + chunkPatterns.ts chunks,
 *   used while the model loads, if it fails, or on low-memory devices.
 *
 * Layer: modules/ (parser). Runs only inside parser.worker.ts.
 *
 * Tasks:
 *   1. Load wink-nlp with wink-eng-lite-web-model once.
 *   2. splitSentences(text) and tokenize → words with character offsets and lemmas.
 *      Tokenization settings must match training/js/align_tokens.mjs.
 *   3. Map wink POS tags to UPOS.
 *   4. tag(): fallback tagging with probability 1.0 per label (no
 *      probability-based alternatives in basic mode).
 *   5. Unit tests in winkBackend.test.ts.
 *
 * Dependencies:
 *   External: wink-nlp, wink-eng-lite-web-model.
 *   Internal: ./parser.ts (ParserBackend), ./chunkPatterns.ts, ./types.ts.
 *   Used by: ./parser.worker.ts, ./parser.ts.
 *   Mirrored by: training/js/align_tokens.mjs, training/js/evaluate_baselines.mjs.
 *
 * Status: header only; not implemented.
 */
