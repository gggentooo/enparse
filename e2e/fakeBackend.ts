/**
 * e2e/fakeBackend.ts — deterministic stand-in for the model backend in end-to-end tests (T62)
 *
 * Description:
 *   CI has no model files (no Git LFS; models are packaged in T66), so the
 *   `e2e` Vite mode (vite.e2e.ts) resolves parser.worker.ts's import of
 *   ./transformerBackend to this file (owner, 2026-11-23). It implements the
 *   same ParserBackend contract with a small word list instead of a neural
 *   network: parts of speech, BIO chunk tags, and a dependency tree (as
 *   confident arc scores), so everything after the backend — the real
 *   decoder, phrase labeler, annotator, services, and UI — runs unchanged.
 *   Never part of production builds (the alias exists only in `vite --mode e2e`).
 *
 * Tagging (enough for the test sentences, not a parser):
 *   DET / ADJ / PRON / NOUN runs form NP chunks (head = last noun or pronoun);
 *   known verbs are VERB (the first one is the root); prepositions are ADP
 *   (case of the next noun phrase); -ly words and a few adverbs are ADV;
 *   punctuation is PUNCT; other words are NOUN.
 *
 * Status: implemented (T62).
 */

import {
  type ArcScores,
  type LabelConfig,
  type ParserBackend,
  ParserNotReadyError,
  type SentenceSpan,
  type TaggedSentence,
} from "../src/modules/parser/types";

const DET = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "my",
  "his",
  "her",
  "its",
  "our",
  "their",
  "every",
]);
const ADJ = new Set(["little", "big", "red", "small", "old", "new", "young", "good", "happy", "unhappy"]);
const ADP = new Set(["in", "on", "at", "of", "to", "from", "with", "for", "by", "into", "under", "over"]);
const PRON = new Set(["i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them"]);
const VERB = new Set([
  "runs",
  "run",
  "ran",
  "barks",
  "look",
  "looks",
  "looked",
  "play",
  "plays",
  "sees",
  "saw",
  "eats",
]);
const ADV = new Set(["fast", "very", "often", "rarely", "loudly", "quickly"]);

/** labels.json values the parser reads at runtime (thresholds and margins). */
const LABELS = {
  schema_version: 2,
  model_version: "e2e-1",
  ambiguity: { margin: 0.4, attachment_margin: 0.3 },
  nested: { bracket_threshold: 0.5, role_threshold: 0.3 },
  calibration: { temperature: 1, rel_temperature: 1, arc_temperature: 1 },
} as unknown as LabelConfig;

function uposOf(word: string): string {
  const w = word.toLowerCase();
  if (/^[^\p{L}\p{N}]+$/u.test(word)) return "PUNCT";
  if (DET.has(w)) return "DET";
  if (ADJ.has(w)) return "ADJ";
  if (ADP.has(w)) return "ADP";
  if (PRON.has(w)) return "PRON";
  if (VERB.has(w)) return "VERB";
  if (ADV.has(w) || w.endsWith("ly")) return "ADV";
  return "NOUN";
}

const NP = new Set(["DET", "ADJ", "PRON", "NOUN"]);
const CHUNK: Record<string, string> = { VERB: "VP", ADP: "PP", ADV: "ADVP" };

/** One sentence: tags, chunk tags, heads (1-based, 0 = root), and relations. */
export function tagWords(words: readonly string[]): {
  upos: string[];
  chunks: string[];
  heads: number[];
  rels: string[];
} {
  const upos = words.map(uposOf);
  const chunks = upos.map((u, i) => {
    if (NP.has(u)) return NP.has(upos[i - 1] ?? "") ? "I-NP" : "B-NP";
    const c = CHUNK[u];
    return c ? `B-${c}` : "O";
  });
  const n = words.length;
  const verb = upos.indexOf("VERB");
  const root =
    verb >= 0
      ? verb
      : Math.max(
          0,
          upos.findIndex((u) => u === "NOUN" || u === "PRON"),
        );
  // Noun phrases: maximal DET/ADJ/PRON/NOUN runs, headed by their last noun or pronoun (else last word).
  const npHead = new Array<number>(n).fill(-1);
  for (let i = 0; i < n;) {
    if (!NP.has(upos[i] ?? "")) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && NP.has(upos[j + 1] ?? "")) j++;
    let head = j;
    for (let k = j; k >= i; k--) {
      if (upos[k] === "NOUN" || upos[k] === "PRON") {
        head = k;
        break;
      }
    }
    for (let k = i; k <= j; k++) npHead[k] = head;
    i = j + 1;
  }
  const heads = new Array<number>(n).fill(root + 1);
  const rels = new Array<string>(n).fill("dep");
  for (let i = 0; i < n; i++) {
    const u = upos[i] as string;
    const np = npHead[i] as number;
    if (i === root) {
      heads[i] = 0;
      rels[i] = "root";
    } else if (np >= 0 && np !== i) {
      heads[i] = np + 1;
      rels[i] = u === "DET" ? "det" : u === "ADJ" ? "amod" : "compound";
    } else if (np === i) {
      // The word before the noun phrase decides: a preposition makes it an oblique.
      const before = upos[npHead.indexOf(i) - 1];
      rels[i] = i < root ? "nsubj" : before === "ADP" ? "obl" : "obj";
    } else if (u === "ADP") {
      const next = npHead.findIndex((h, k) => k > i && h >= 0);
      heads[i] = next >= 0 ? (npHead[next] as number) + 1 : root + 1;
      rels[i] = "case";
    } else if (u === "ADV") rels[i] = "advmod";
    else if (u === "PUNCT") rels[i] = "punct";
    else if (u === "VERB") rels[i] = "xcomp";
  }
  return { upos, chunks, heads, rels };
}

/** Arc rows (log-probabilities) that make `heads` the confident tree. */
function arcScores(heads: readonly number[]): ArcScores {
  const n = heads.length;
  return heads.map((h, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      j === i + 1 ? -1e9 : j === h ? Math.log(0.98) : Math.log(0.02 / Math.max(1, n - 1)),
    ),
  );
}

function tagSentence(span: SentenceSpan): TaggedSentence {
  const { upos, chunks, heads, rels } = tagWords(span.words.map((w) => w.text));
  return {
    words: upos.map((u, i) => ({
      upos: u,
      uposProb: 0.99,
      chunkTag: chunks[i] as string,
      chunkProb: 0.99,
      candidates: [{ upos: u, chunkTag: chunks[i] as string, prob: 0.99 }],
      relations: [{ relation: rels[i] as string, prob: 0.99 }],
    })),
    arc: arcScores(heads),
  };
}

/** Same export name as ./src/modules/parser/transformerBackend.ts (the e2e alias replaces that module). */
export function createTransformerBackend(): ParserBackend {
  let ready = false;
  return {
    name: "e2e-fake",
    async load(_model, onProgress) {
      onProgress({ phase: "initialize", progress: 1 });
      ready = true;
    },
    async unload() {
      ready = false;
    },
    isReady: () => ready,
    info() {
      if (!ready) throw new ParserNotReadyError();
      return { labels: LABELS, backend: "wasm" };
    },
    async tag(sentences) {
      if (!ready) throw new ParserNotReadyError();
      return sentences.map(tagSentence);
    },
  };
}
