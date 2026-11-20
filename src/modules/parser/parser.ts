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
 *   1. interface ParserBackend (in ./types.ts): name, load(model, onProgress),
 *      unload(), isReady(), info(), tag(sentences). (done)
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
 *   6. Unit tests in parser.test.ts with mocked backends. (done)
 *
 * Dependencies:
 *   Internal: ./types.ts, ./ambiguity.ts, ./treeDecoder.ts, ./phraseLabeler.ts,
 *             ./winkBackend.ts (sentence split, words, lemmas).
 *   External: none directly.
 *   Used by: ./parser.worker.ts.
 *
 * Notes:
 *   - The ParserBackend interface and result types live in ./types.ts (shared
 *     with the worker protocol).
 *   - Nested view (ModelRef.nestedView): MST tree → buildPhrases → gatePhrases
 *     (labels.json → nested.bracket_threshold) → labelPhrases with the role
 *     gate (nested.role_threshold; confidence = relation × head probability).
 *     The tree (heads, relations) is decoded for every model, so tokens always
 *     carry head and relation.
 *   - Alternatives come from ambiguity.ts (T60); until then the list is empty.
 *
 * Open items (todo.md): alternatives (T60).
 *
 * Status: implemented (T35) except alternatives (T60). Tests: parser.test.ts.
 */

import { labelPhrases } from "./phraseLabeler";
import { buildPhrases, decodeArcTree, gatePhrases } from "./treeDecoder";
import {
  type Chunk,
  type ChunkType,
  type LabelConfig,
  type ModelRef,
  type ParseResult,
  type ParserBackend,
  ParserNotReadyError,
  ParserRuntimeError,
  type SentenceParse,
  type SentenceSpan,
  type TaggedSentence,
  TokenizerError,
} from "./types";
import { tokenize as winkTokenize } from "./winkBackend";

const CHUNK_TYPES: ReadonlySet<string> = new Set<ChunkType>(["NP", "VP", "PP", "ADJP", "ADVP"]);

/**
 * BIO repair (owner, 2026-11-20): a stray I-X (at the start, after O, or after another type)
 * becomes B-X, as seqeval's default mode reads it for the reported chunk F1.
 */
export function repairBio(tags: readonly string[]): string[] {
  let prevType: string | null = null;
  return tags.map((tag) => {
    const [prefix, type] = tag.includes("-") ? [tag.slice(0, 1), tag.slice(2)] : ["O", null];
    if (prefix === "O" || type === null) {
      prevType = null;
      return "O";
    }
    const fixed = prefix === "I" && prevType !== type ? `B-${type}` : tag;
    prevType = type;
    return fixed;
  });
}

/** Group repaired BIO tags into chunks (token ranges, inclusive). Unknown chunk types are skipped. */
export function groupChunks(tags: readonly string[]): Chunk[] {
  const chunks: Chunk[] = [];
  repairBio(tags).forEach((tag, i) => {
    if (tag === "O") return;
    const type = tag.slice(2);
    if (!CHUNK_TYPES.has(type)) return;
    const last = chunks[chunks.length - 1];
    if (tag.startsWith("I-") && last && last.type === type && last.end === i - 1) last.end = i;
    else chunks.push({ type: type as ChunkType, start: i, end: i });
  });
  return chunks;
}

const base = (relation: string): string => relation.split(":")[0] ?? relation;

function requireSet<T>(value: T | null, name: string): T {
  if (value === null) throw new ParserRuntimeError(`labels.json ${name} is not set`);
  return value;
}

/** Build one sentence's parse from the backend output (see the header). */
export function buildSentenceParse(
  span: SentenceSpan,
  tagged: TaggedSentence,
  labels: LabelConfig,
  nestedView: boolean,
): SentenceParse {
  const n = span.words.length;
  if (tagged.words.length !== n) {
    throw new ParserRuntimeError(`backend returned ${tagged.words.length} words for a sentence of ${n}`);
  }
  if (n === 0) return { start: span.start, end: span.end, tokens: [], chunks: [], phrases: null, treeRepaired: false, alternatives: [] };
  const tree = decodeArcTree(
    tagged.arc,
    tagged.words.map((w) => w.relations),
  );
  const upos = tagged.words.map((w) => w.upos);
  const chunkTags = repairBio(tagged.words.map((w) => w.chunkTag));
  const tokens = span.words.map((w, i) => {
    const t = tagged.words[i] as TaggedSentence["words"][number];
    return {
      index: i,
      text: w.text,
      start: w.start,
      end: w.end,
      lemma: null, // TODO(lemma): winkBackend lemmas
      upos: t.upos,
      uposProb: t.uposProb,
      chunkTag: chunkTags[i] as string,
      chunkProb: t.chunkProb,
      head: (tree.heads[i] as number) - 1,
      relation: tree.relations[i] as string,
      headProb: tree.headProbs[i] as number,
      relationProb: tree.relationProbs[i] as number,
    };
  });
  let phrases: SentenceParse["phrases"] = null;
  if (nestedView) {
    const bracket = requireSet(labels.nested.bracket_threshold, "nested.bracket_threshold");
    const role = requireSet(labels.nested.role_threshold, "nested.role_threshold");
    const items = gatePhrases(buildPhrases(tree.heads, upos, tree.relations.map(base)), tree, bracket);
    const confidence = tree.relationProbs.map((p, i) => p * (tree.headProbs[i] ?? 0));
    phrases = labelPhrases(items, tree.heads, tree.relations, upos, { confidence, threshold: role });
  }
  return {
    start: span.start,
    end: span.end,
    tokens,
    chunks: groupChunks(chunkTags),
    phrases,
    treeRepaired: tree.repaired,
    alternatives: [], // TODO(T60): ambiguity.ts alternatives
  };
}

/** Parses preprocessed text with a loaded backend (one instance per loaded model). */
export class Parser {
  constructor(
    private readonly backend: ParserBackend,
    private readonly model: ModelRef,
    private readonly tokenize: (text: string) => SentenceSpan[] = winkTokenize,
  ) {}

  /** Parse clean text; rejects with ParserNotReadyError unless the backend is ready. */
  async parse(text: string): Promise<ParseResult> {
    if (!this.backend.isReady()) throw new ParserNotReadyError();
    const { labels, backend } = this.backend.info();
    const spans = this.tokenize(text);
    let tagged: TaggedSentence[];
    try {
      tagged = spans.length ? await this.backend.tag(spans) : [];
    } catch (err) {
      if (err instanceof ParserNotReadyError || err instanceof TokenizerError) throw err;
      throw new ParserRuntimeError(`tagging failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (tagged.length !== spans.length) {
      throw new ParserRuntimeError(`backend returned ${tagged.length} sentences for ${spans.length}`);
    }
    return {
      sentences: spans.map((s, i) => buildSentenceParse(s, tagged[i] as TaggedSentence, labels, this.model.nestedView)),
      modelId: this.model.id,
      modelVersion: requireSet(labels.model_version, "model_version"),
      backend,
    };
  }
}
