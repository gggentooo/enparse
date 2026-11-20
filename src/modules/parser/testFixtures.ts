/**
 * src/modules/parser/testFixtures.ts — shared test fixtures for the parser module (test-only)
 *
 * Description:
 *   A mocked ParserBackend, a minimal labels.json, and arc scores for a given
 *   tree. Imported only by *.test.ts files (never by app code), so it is not
 *   bundled.
 *
 * Layer: modules/ (parser), tests.
 */

import {
  type ArcScores,
  type LabelConfig,
  type ModelRef,
  type ParserBackend,
  ParserNotReadyError,
  type SentenceSpan,
  type TaggedSentence,
  type TaggedWord,
} from "./types";

export const MODEL: ModelRef = { id: "test-model", folder: "test", variant: "int8", nestedView: true };

export const LABELS = {
  schema_version: 2,
  model_version: "1.0.0",
  nested: { bracket_threshold: 0.5, role_threshold: 0.4 },
} as unknown as LabelConfig;

/** Arc rows (log-probs) that make `heads` (1-based, 0 = root) the confident tree; p = probability of the chosen head. */
export function arcFor(heads: readonly number[], p = 0.98): ArcScores {
  const n = heads.length;
  return heads.map((h, i) =>
    Array.from({ length: n + 1 }, (_, j) => (j === i + 1 ? -1e9 : j === h ? Math.log(p) : Math.log((1 - p) / (n - 1)))),
  );
}

const word = (upos: string, chunkTag: string, relation: string): TaggedWord => ({
  upos,
  uposProb: 0.99,
  chunkTag,
  chunkProb: 0.98,
  candidates: [{ upos, chunkTag, prob: 0.97 }],
  relations: [{ relation, prob: 0.95 }],
});

/** "The dog barks ." tagged as a confident tree. */
export function taggedDog(): TaggedSentence {
  return {
    words: [word("DET", "B-NP", "det"), word("NOUN", "I-NP", "nsubj"), word("VERB", "B-VP", "root"), word("PUNCT", "O", "punct")],
    arc: arcFor([2, 3, 0, 3]),
  };
}

/** Backend returning taggedDog() per sentence (or `tag`); `ready` defaults to true. */
export function mockBackend(opts: { ready?: boolean; tag?: (s: readonly SentenceSpan[]) => Promise<TaggedSentence[]> } = {}): ParserBackend {
  let ready = opts.ready ?? true;
  return {
    name: "mock",
    load: async () => {
      ready = true;
    },
    unload: async () => {
      ready = false;
    },
    isReady: () => ready,
    info: () => {
      if (!ready) throw new ParserNotReadyError();
      return { labels: LABELS, backend: "wasm" };
    },
    tag: opts.tag ?? (async (spans) => spans.map(() => taggedDog())),
  };
}

