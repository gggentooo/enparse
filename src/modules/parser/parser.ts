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
 *   2. Parse flow: sentence split + words + lemmas (winkBackend) → tagging
 *      (transformerBackend; must be ready) → BIO decoding into chunks →
 *      treeDecoder.ts nested phrases → phraseLabeler.ts (roles, clause/predicate,
 *      head-of-parent flags) → ambiguity.ts alternatives.
 *   3. BIO repair: a stray I-X (after O or another type) becomes B-X, the
 *      same reading seqeval's default mode uses for the reported chunk F1
 *      (owner, 2026-11-20; architecture.md → Parsing engine).
 *   4. Refuse to parse if the backend is not ready (ParserNotReadyError); no
 *      fallback backend (architecture.md → Model readiness).
 *   5. Typed errors: ParserLoadError, ParserNotReadyError, ParserRuntimeError.
 *   6. Unit tests in parser.test.ts with mocked backends.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./ambiguity.ts, ./treeDecoder.ts, ./phraseLabeler.ts,
 *             ./winkBackend.ts (sentence split, words, lemmas).
 *   External: none directly.
 *   Used by: ./parser.worker.ts.
 *
 * Open items (todo.md): module interfaces (parse result types);
 *   nested phrase labeling.
 *
 * Status: header only; not implemented.
 */
