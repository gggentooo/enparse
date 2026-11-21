/**
 * src/modules/parser/bio.ts — BIO chunk tags: repair and grouping
 *
 * Description:
 *   BIO repair (owner, 2026-11-20; architecture.md → BIO repair) and chunk
 *   grouping, shared by parser.ts (primary parse) and ambiguity.ts (label
 *   alternatives). Separate file so the two do not import each other.
 *
 * Layer: modules/ (parser)
 * Dependencies: ./types.ts. Used by: ./parser.ts (re-exported), ./ambiguity.ts.
 *
 * Status: implemented (T35; moved out of parser.ts with T60). Tests: parser.test.ts.
 */

import type { Chunk, ChunkType } from "./types";

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
