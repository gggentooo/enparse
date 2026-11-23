/**
 * src/modules/parser/ambiguity.ts — alternative parse builder
 *
 * Description:
 *   Builds ranked alternative parses per sentence from low-margin label
 *   probabilities and PP-attachment alternatives from head probabilities
 *   (biaffine models: the top-two calibrated arc probabilities of a word).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Mark words whose top-two label margin < margin from labels.json
 *      (proposed 0.2) as ambiguous.
 *   2. Enumerate alternative label sequences over ambiguous words; keep only
 *      valid BIO sequences; rank by joint probability.
 *   3. Attachment alternatives: for obl/nmod words with a case dependent
 *      (PP attachment), the top-two heads within ambiguity.attachment_margin
 *      (labels.json) give alternative trees via ./treeDecoder.ts (MST with
 *      the word's head fixed), labeled with grammatical roles and head markers via
 *      ./phraseLabeler.ts.
 *   4. Cap at MAX_ALTERNATIVES = 5 per sentence (exported constant; owner,
 *      2026-11-20, T09); bound enumeration cost.
 *   5. Unit tests in ambiguity.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./treeDecoder.ts (alternative trees),
 *             ./phraseLabeler.ts (labeledView on alternative trees), ./bio.ts.
 *   External: none.
 *   Data: margins from the loaded model's labels.json (passed in).
 *   Used by: ./parser.ts.
 *
 * Margins: labels.json → ambiguity (Phase 8, per model; calibrate.py). Labels
 *   and attachment alternatives share the cap.
 *
 * Open items (todo.md): how alternatives are displayed (T11).
 *
 * Rules (match Phase 8's margin counting in training/scripts/calibrate.py):
 *   - Label ambiguity: a word whose top-two group A probabilities (calibrated)
 *     differ by less than ambiguity.margin; its alternative label is the
 *     second-best. Label alternatives are the non-empty subsets of the
 *     ambiguous words switched to their second label (2^k − 1), keeping only
 *     sequences whose BIO tags need no repair. At most MAX_AMBIGUOUS_WORDS
 *     (the smallest margins) are combined, so enumeration stays ≤ 1023.
 *   - Attachment ambiguity: a word with relation obl or nmod (incl. subtypes)
 *     and a `case` dependent (a PP) whose top-two head probabilities differ
 *     by less than ambiguity.attachment_margin; the alternative tree is the
 *     MST with that word's head fixed to the other of the two heads.
 *   - Ranking: each reading's probability relative to the primary parse
 *     (label: Π p(second)/p(first) over switched words; attachment: Π of
 *     head-probability ratios over all words of the alternative tree). The top
 *     MAX_ALTERNATIVES are kept; `probability` is each reading's share among
 *     the primary parse and the kept alternatives.
 *   - Gating of an attachment alternative's nested view: the switched word's
 *     head counts as certain (it is the reading shown); other words keep
 *     their calibrated head probabilities.
 *   - Display (owner, 2026-11-21; T11): one "Other readings (n)" switch per
 *     sentence; `changes` lists the words to mark.
 *
 * Status: implemented (T60). Tests: ambiguity.test.ts.
 */

import { labeledView } from "./phraseLabeler";
import { groupChunks, repairBio } from "./bio";
import { decodeArcTree, headLogProbs } from "./treeDecoder";
import type { Alternative, DecodedTree, LabeledSentencePhrases, TaggedSentence, TokenChange } from "./types";

/** Most alternatives shown per sentence, label and attachment together (owner, 2026-11-20; T09). */
export const MAX_ALTERNATIVES = 5;

/** Most ambiguous words combined into label alternatives (2^10 − 1 = 1023 candidates). */
export const MAX_AMBIGUOUS_WORDS = 10;

const PP_RELATIONS = new Set(["obl", "nmod"]);
const base = (r: string): string => r.split(":")[0] ?? r;

/** Inputs of one sentence (primary parse already decoded). */
export type AlternativesInput = {
  tagged: TaggedSentence;
  tree: DecodedTree;
  upos: readonly string[];
  /** Word texts (quantifier display rule of the nested view). */
  words: readonly string[];
  /** Primary chunk tags after BIO repair. */
  chunkTags: readonly string[];
  margins: { label: number; attachment: number };
  /** Nested view thresholds, or null when the model has no nested view. */
  thresholds: { bracket: number; role: number } | null;
};

type Candidate = { ratio: number; build: () => Omit<Alternative, "rank" | "probability"> };

/** Ranked alternatives of one sentence (see the header). */
export function buildAlternatives(input: AlternativesInput): Alternative[] {
  const candidates = [...labelCandidates(input), ...attachmentCandidates(input)]
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, MAX_ALTERNATIVES);
  const total = 1 + candidates.reduce((sum, c) => sum + c.ratio, 0);
  return candidates.map((c, i) => ({ rank: i + 1, probability: c.ratio / total, ...c.build() }));
}

function view(input: AlternativesInput, tree: DecodedTree, upos: readonly string[]): LabeledSentencePhrases | null {
  return input.thresholds ? labeledView(tree, upos, input.words, input.thresholds) : null;
}

/** Words with a close second group A label: (index, second label, ratio p2/p1), smallest margins first. */
function ambiguousWords(input: AlternativesInput): { index: number; upos: string; chunkTag: string; ratio: number }[] {
  const out: { index: number; upos: string; chunkTag: string; ratio: number; margin: number }[] = [];
  input.tagged.words.forEach((w, index) => {
    const [first, second] = w.candidates;
    if (!first || !second || first.prob <= 0) return;
    const margin = first.prob - second.prob;
    if (margin < input.margins.label) {
      out.push({ index, upos: second.upos, chunkTag: second.chunkTag, ratio: second.prob / first.prob, margin });
    }
  });
  return out.sort((a, b) => a.margin - b.margin).slice(0, MAX_AMBIGUOUS_WORDS);
}

function labelCandidates(input: AlternativesInput): Candidate[] {
  const amb = ambiguousWords(input);
  // Primary tags before repair, so a switched label is checked against the model's own sequence.
  const primaryTags = input.tagged.words.map((w) => w.chunkTag);
  const out: Candidate[] = [];
  for (let mask = 1; mask < 1 << amb.length; mask++) {
    const picked = amb.filter((_, k) => mask & (1 << k));
    const tags = [...primaryTags];
    const upos = [...input.upos];
    let ratio = 1;
    for (const a of picked) {
      tags[a.index] = a.chunkTag;
      upos[a.index] = a.upos;
      ratio *= a.ratio;
    }
    // Valid BIO only: no stray I-X (the sequence must be its own repair).
    if (repairBio(tags).some((t, i) => t !== tags[i])) continue;
    const changes: TokenChange[] = picked
      .map((a) => {
        const c: TokenChange = { index: a.index };
        if (a.upos !== input.upos[a.index]) c.upos = a.upos;
        if (a.chunkTag !== input.chunkTags[a.index]) c.chunkTag = a.chunkTag;
        return c;
      })
      .filter((c) => c.upos !== undefined || c.chunkTag !== undefined);
    if (changes.length === 0) continue;
    out.push({
      ratio,
      build: () => ({
        reason: "probability",
        changes,
        chunks: groupChunks(tags),
        phrases: view(input, input.tree, upos),
      }),
    });
  }
  return out;
}

function attachmentCandidates(input: AlternativesInput): Candidate[] {
  const { tree, tagged } = input;
  const n = tree.heads.length;
  const logp = headLogProbs(tagged.arc);
  const hasCase = (w: number): boolean =>
    tree.heads.some((h, d) => h === w + 1 && base(tree.relations[d] ?? "") === "case");
  const out: Candidate[] = [];
  for (let w = 0; w < n; w++) {
    if (!PP_RELATIONS.has(base(tree.relations[w] ?? "")) || !hasCase(w)) continue;
    const row = logp[w] ?? [];
    const order = row
      .map((lp, col) => ({ col, p: Math.exp(lp) }))
      .filter((x) => Number.isFinite(x.p) && x.p > 0)
      .sort((a, b) => b.p - a.p);
    const [top, second] = order;
    if (!top || !second || top.p - second.p >= input.margins.attachment) continue;
    const current = tree.heads[w] as number;
    const target = top.col === current ? second.col : top.col;
    if (target === current) continue;
    // MST with this word's head fixed: only the target column stays finite in its row.
    const arc = tagged.arc.map((r, i) => (i === w ? r.map((v, col) => (col === target ? v : -Infinity)) : r));
    const alt = decodeArcTree(
      arc,
      tagged.words.map((x) => x.relations),
    );
    if (alt.heads[w] !== target) continue;
    // Ratio of tree probabilities under the original (unconstrained) head distributions.
    let logRatio = 0;
    for (let i = 0; i < n; i++) {
      logRatio += (logp[i]?.[alt.heads[i] as number] ?? -Infinity) - (logp[i]?.[tree.heads[i] as number] ?? -Infinity);
    }
    const ratio = Math.exp(logRatio);
    if (!(ratio > 0)) continue;
    const changes: TokenChange[] = [];
    for (let i = 0; i < n; i++) {
      const c: TokenChange = { index: i };
      if (alt.heads[i] !== tree.heads[i]) c.head = (alt.heads[i] as number) - 1;
      if (alt.relations[i] !== tree.relations[i]) c.relation = alt.relations[i] as string;
      if (c.head !== undefined || c.relation !== undefined) changes.push(c);
    }
    out.push({
      ratio,
      build: () => ({
        reason: "attachment",
        changes,
        chunks: groupChunks(input.chunkTags),
        // Gating: the switched word's head is the reading being shown (probability 1; its
        // constrained row in alt.headDist); every other word keeps its calibrated probabilities.
        phrases: view(
          input,
          { ...alt, headProbs: alt.heads.map((h, i) => (i === w ? 1 : Math.exp(logp[i]?.[h] ?? -Infinity))) },
          input.upos,
        ),
      }),
    });
  }
  return out;
}
