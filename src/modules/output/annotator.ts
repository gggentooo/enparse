/**
 * src/modules/output/annotator.ts — parse result → annotation model
 *
 * Description:
 *   Converts parse results into a render-ready annotation model (flat chunks,
 *   labeled nested phrases with grammatical roles and head markers, tokens,
 *   ambiguity marks, alternatives). Pure logic; rendering is in
 *   components/Pages/OutputPage.tsx.
 *
 * Layer: modules/ (output)
 *
 * Tasks:
 *   1. Map sentences → paragraphs/sentences/flat segments/nested nodes/tokens
 *      with stable ids for React keys and word selection.
 *   2. Attach nested phrase categories/roles, head-of-parent flags (isHead),
 *      non-contiguous span flags, and collapse `wrapper` brackets (a
 *      single-word head bracket inside a bracket with the same head) into
 *      their word.
 *   3. Readings per sentence: the primary parse (rank 0, share 1 − Σ
 *      alternatives) and each alternative with rank, share, reason, and the
 *      words it changes. Words changed by any alternative are `ambiguous`.
 *   4. Carry the model id, model version, and backend for display.
 *   5. Token lookup data (surface form + lemma) for dictionary and subword
 *      lookups; spaceAfter from the input offsets; paragraph index from blank
 *      lines in the preprocessed text.
 *   6. Unit tests in annotator.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none.
 *   Must not import modules/parser (no cross-module imports). The input
 *   shape is defined in ./types.ts and structurally matches the parser's
 *   ParseResult; parserService passes it through.
 *   Used by: services/parserService.ts (via ./index.ts).
 *
 * Status: implemented (T57). Tests: annotator.test.ts.
 */

import type {
  AnnotatedNode,
  AnnotatedSentence,
  AnnotatedToken,
  Annotation,
  AnnotatorInput,
  FlatSegment,
  InputChunk,
  InputPhrase,
  InputWord,
  Reading,
} from "./types";

type InputSentence = AnnotatorInput["sentences"][number];
type InputNode = InputPhrase | InputWord;

const isWord = (n: InputNode): n is InputWord => "word" in n;

/** Flat segments covering every word: chunks, and runs of words outside chunks (type null). */
export function flatSegments(chunks: readonly InputChunk[], tokenCount: number, prefix: string): FlatSegment[] {
  const sorted = [...chunks].sort((a, b) => a.start - b.start);
  const out: FlatSegment[] = [];
  let next = 0;
  const gap = (end: number): void => {
    if (end >= next) out.push({ id: `${prefix}-o${next}`, type: null, start: next, end });
  };
  for (const c of sorted) {
    if (c.start < next || c.end >= tokenCount) continue; // overlapping or out of range: skip
    gap(c.start - 1);
    out.push({ id: `${prefix}-c${c.start}`, type: c.type, start: c.start, end: c.end });
    next = c.end + 1;
  }
  gap(tokenCount - 1);
  return out;
}

/** Nested nodes with ids; wrapper brackets collapse into their single word. */
export function annotateNodes(nodes: readonly InputNode[], prefix: string): AnnotatedNode[] {
  return nodes.map((n, i): AnnotatedNode => {
    const id = `${prefix}-${i}`;
    const labels = {
      role: n.role,
      isHead: n.isHead,
      coordinated: n.coordinated,
      splitPredicate: n.splitPredicate,
      badge: n.badge,
    };
    if (isWord(n)) return { kind: "word", id, token: n.word, ...labels };
    const only = n.children[0];
    if (n.wrapper && n.children.length === 1 && only && isWord(only)) {
      // [dog] inside [red dog]: show the word with the bracket's labels.
      return {
        kind: "word",
        id,
        token: only.word,
        ...labels,
        role: n.role ?? only.role,
        isHead: n.isHead || only.isHead,
      };
    }
    return {
      kind: "phrase",
      id,
      category: n.category,
      start: n.start,
      end: n.end,
      contiguous: n.contiguous,
      children: annotateNodes(n.children, id),
      ...labels,
    };
  });
}

/** Paragraph index of each sentence: a blank line before it in the text starts a new paragraph. */
function paragraphIndexes(sentences: readonly InputSentence[], text: string): number[] {
  let paragraph = 0;
  return sentences.map((s, i) => {
    const prev = sentences[i - 1];
    if (prev && /\n\s*\n/.test(text.slice(prev.end, s.start))) paragraph++;
    return paragraph;
  });
}

function annotateSentence(s: InputSentence, index: number, paragraph: number, text: string): AnnotatedSentence {
  const id = `s${index}`;
  const ambiguous = new Set(s.alternatives.flatMap((a) => a.changes.map((c) => c.index)));
  const tokens: AnnotatedToken[] = s.tokens.map((t, i) => {
    const next = s.tokens[i + 1];
    return {
      id: `${id}-t${t.index}`,
      index: t.index,
      text: t.text,
      lemma: t.lemma,
      upos: t.upos,
      spaceAfter: next ? next.start > t.end : false,
      ambiguous: ambiguous.has(t.index),
    };
  });
  const altShare = s.alternatives.reduce((sum, a) => sum + a.probability, 0);
  const primary: Reading = {
    id: `${id}-r0`,
    rank: 0,
    probability: Math.max(0, 1 - altShare),
    reason: "primary",
    segments: flatSegments(s.chunks, s.tokens.length, `${id}-r0`),
    nodes: s.phrases ? annotateNodes(s.phrases, `${id}-r0-n`) : null,
    changes: {},
  };
  const alternatives = s.alternatives.map((a): Reading => {
    const rid = `${id}-r${a.rank}`;
    const changes: Record<number, { upos?: string; chunkTag?: string }> = {};
    for (const c of a.changes) {
      const entry: { upos?: string; chunkTag?: string } = {};
      if (c.upos !== undefined) entry.upos = c.upos;
      if (c.chunkTag !== undefined) entry.chunkTag = c.chunkTag;
      changes[c.index] = entry;
    }
    return {
      id: rid,
      rank: a.rank,
      probability: a.probability,
      reason: a.reason,
      segments: flatSegments(a.chunks, s.tokens.length, rid),
      nodes: a.phrases ? annotateNodes(a.phrases, `${rid}-n`) : null,
      changes,
    };
  });
  return {
    id,
    paragraph,
    text: text.slice(s.start, s.end),
    tokens,
    readings: [primary, ...alternatives.sort((a, b) => a.rank - b.rank)],
  };
}

/** Build the annotation model for a parse of `text` (the preprocessed input the offsets refer to). */
export function annotate(result: AnnotatorInput, text: string): Annotation {
  const paragraphs = paragraphIndexes(result.sentences, text);
  const sentences = result.sentences.map((s, i) => annotateSentence(s, i, paragraphs[i] ?? 0, text));
  return {
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    backend: result.backend,
    sentences,
    hasNested: sentences.some((s) => s.readings[0]?.nodes !== null),
  };
}
