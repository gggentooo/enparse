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
 *   2. Attach nested phrase categories/roles, head-word flags (isHead),
 *      non-contiguous span flags, and each node's attachment (attachTo: the
 *      token it modifies or complements; uncertain) for the arrows (T79).
 *   3. Readings per sentence: the primary parse (rank 0, share 1 − Σ
 *      alternatives) and each alternative with rank, share, reason, and the
 *      words it changes. Words changed by any alternative are `ambiguous`.
 *   4. Carry the model id, model version, and backend for display.
 *   4b. Near-ties (owner, 2026-11-23; T83): a sentence whose top reading has
 *      a share below NEAR_TIE_SHARE is `nearTie`. Every reading gets plain
 *      `notes` of what it says where the readings differ (which word a
 *      phrase goes with; which part of speech a word is), and, in a
 *      near-tie, `forks`: the disputed phrase's head token with both
 *      candidate targets and their shares.
 *   5. Token lookup data (surface form + lemma; the phrasal verb a word
 *      belongs to, from compound:prt in the primary parse) for dictionary and subword
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
 * Status: implemented (T57; attachments T79; near-tie notes and forks T83). Tests: annotator.test.ts.
 */

import type {
  AnnotatedNode,
  AnnotatedSentence,
  AnnotatedToken,
  Annotation,
  AnnotatorInput,
  FlatSegment,
  Fork,
  HeadKind,
  InputChunk,
  InputPhrase,
  InputWord,
  Reading,
  ReadingNote,
} from "./types";
import { NEAR_TIE_SHARE } from "./types";

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

/** Nested nodes with ids (stable per reading: the node's path in the tree). */
export function annotateNodes(nodes: readonly InputNode[], prefix: string): AnnotatedNode[] {
  return nodes.map((n, i): AnnotatedNode => {
    const id = `${prefix}-${i}`;
    const labels = {
      role: n.role,
      isHead: n.isHead,
      coordinated: n.coordinated,
      splitPredicate: n.splitPredicate,
      badge: n.badge,
      attachTo: n.attachTo,
      attachFrom: n.attachFrom,
      uncertain: n.uncertain,
    };
    if (isWord(n)) return { kind: "word", id, token: n.word, ...labels };
    return {
      kind: "phrase",
      id,
      head: n.head,
      category: n.category,
      start: n.start,
      end: n.end,
      contiguous: n.contiguous,
      unsure: n.unsure,
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
  // Phrasal verbs (compound:prt): the dictionary looks them up as "verb particle" (T53).
  const phrasal = new Map<number, AnnotatedToken["phrasal"]>();
  for (const t of s.tokens) {
    const verb = s.tokens[t.head];
    if (t.relation !== "compound:prt" || !verb) continue;
    const p = {
      verb: verb.index,
      particle: t.index,
      text: `${verb.lemma ?? verb.text.toLowerCase()} ${t.text.toLowerCase()}`,
      written: `${verb.text} ${t.text}`,
    };
    phrasal.set(verb.index, p);
    phrasal.set(t.index, p);
  }
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
      phrasal: phrasal.get(t.index) ?? null,
    };
  });
  const altShare = s.alternatives.reduce((sum, a) => sum + a.probability, 0);
  const primaryShare = Math.max(0, 1 - altShare);
  const nearTie = s.alternatives.length > 0 && primaryShare < NEAR_TIE_SHARE;

  /** Words of a word's phrase (its subtree in the primary parse), as text. */
  const phraseText = (w: number): string => {
    const inside = s.tokens.map((_, i) => {
      for (let k = i, steps = 0; k >= 0 && steps <= s.tokens.length; k = s.tokens[k]?.head ?? -1, steps++) {
        if (k === w) return true;
      }
      return false;
    });
    return s.tokens
      .slice(inside.indexOf(true), inside.lastIndexOf(true) + 1)
      .map((t) => t.text)
      .join(" ");
  };
  const headKind = (upos: string | undefined): HeadKind =>
    upos === "NOUN" || upos === "PROPN" || upos === "PRON" || upos === "NUM"
      ? "noun"
      : upos === "VERB" || upos === "AUX"
        ? "verb"
        : upos === "ADJ"
          ? "adjective"
          : "other";
  /** "phrase goes with head", or nothing if the head is the root. */
  const attachNote = (word: number, head: number): ReadingNote[] => {
    const h = s.tokens[head];
    return h ? [{ kind: "attach", phrase: phraseText(word), head: h.text, headKind: headKind(h.upos) }] : [];
  };
  /** What a reading says about one alternative's differences: its own side (`own`) or the primary's. */
  const notesFor = (a: InputSentence["alternatives"][number], own: boolean): ReadingNote[] => {
    if (a.attachment) return attachNote(a.attachment.word, own ? a.attachment.to : a.attachment.from);
    return a.changes.flatMap((c): ReadingNote[] => {
      const tok = s.tokens[c.index];
      return tok && c.upos !== undefined ? [{ kind: "label", word: tok.text, upos: own ? c.upos : tok.upos }] : [];
    });
  };
  const unique = (notes: ReadingNote[]): ReadingNote[] => {
    const seen = new Set<string>();
    return notes.filter((n) => {
      const key = JSON.stringify(n);
      return seen.has(key) ? false : (seen.add(key), true);
    });
  };
  /** Fork of one attachment alternative, seen from the primary (`own` false) or from that reading. */
  const forkOf = (a: InputSentence["alternatives"][number], own: boolean): Fork[] => {
    if (!nearTie || !a.attachment || a.attachment.from < 0 || a.attachment.to < 0) return [];
    const mine = { token: a.attachment.to, share: a.probability };
    const theirs = { token: a.attachment.from, share: primaryShare };
    return [{ token: a.attachment.word, targets: own ? [mine, theirs] : [theirs, mine] }];
  };

  const primary: Reading = {
    id: `${id}-r0`,
    rank: 0,
    probability: primaryShare,
    reason: "primary",
    segments: flatSegments(s.chunks, s.tokens.length, `${id}-r0`),
    nodes: s.phrases ? annotateNodes(s.phrases, `${id}-r0-n`) : null,
    changes: {},
    notes: unique(s.alternatives.flatMap((a) => notesFor(a, false))),
    forks: s.alternatives.flatMap((a) => forkOf(a, false)),
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
      notes: unique(notesFor(a, true)),
      forks: forkOf(a, true),
    };
  });
  return {
    id,
    paragraph,
    text: text.slice(s.start, s.end),
    tokens,
    readings: [primary, ...alternatives.sort((a, b) => a.rank - b.rank)],
    nearTie,
    otherReadingsOmitted: s.otherReadings === true && s.alternatives.length === 0,
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
