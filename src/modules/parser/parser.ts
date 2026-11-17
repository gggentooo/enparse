/**
 * src/modules/parser/parser.ts — parser adapter interface
 *
 * Description:
 *   Defines the ParserBackend interface and the backend-independent parse
 *   flow: accepts clean text, returns sentences, tokens, and chunk parses
 *   (primary + alternatives). Backends are pluggable.
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. interface ParserBackend { name; load(): Promise<void>; isReady();
 *      tag(sentences): Promise<TaggedSentence[]> }.
 *   2. Shared parse flow: sentence split + lemmas (winkBackend) → tagging
 *      (active backend) → BIO decoding into chunks → ambiguity.ts alternatives.
 *   3. BIO repair: fix invalid sequences (I- without B-) consistently for all backends.
 *   4. Mark results with the backend used (model vs basic/fallback mode).
 *   5. Typed errors: ParserLoadError, ParserRuntimeError.
 *   6. Unit tests in parser.test.ts with mocked backends.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./ambiguity.ts, ./winkBackend.ts (sentence split, lemmas).
 *   External: none directly.
 *   Used by: ./parser.worker.ts.
 *
 * Open items (plan.md → Undecided): module interfaces (parse result types).
 *
 * Status: header only; not implemented.
 */
