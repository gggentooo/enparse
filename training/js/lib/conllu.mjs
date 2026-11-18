/**
 * training/js/lib/conllu.mjs — minimal CoNLL-U reader for the chunked EWT files
 *
 * Description:
 *   Parses CoNLL-U text into sentences with metadata, syntactic words, and
 *   multiword-token ranges. Reads the Phase 2 chunk tag from MISC (`Chunk=`).
 *   Empty nodes (decimal ids) are skipped.
 *
 * Phase: 3 — Tokenization alignment with runtime.
 *
 * Dependencies: none. Used by: ../align_tokens.mjs, ../tests/align.test.mjs.
 *
 * Status: implemented (Phase 3).
 */

/**
 * @typedef {{ id: number, form: string, upos: string, head: number, deprel: string, chunk: string, misc: string }} UdWord
 * @typedef {{ start: number, end: number, form: string }} MwtRange
 * @typedef {{ sentId: string, docId: string, text: string, words: UdWord[], mwts: MwtRange[] }} UdSentence
 */

/** Read the `Chunk=` value from a MISC column ("O" if absent). */
export function chunkFromMisc(misc) {
  for (const part of misc.split("|")) {
    if (part.startsWith("Chunk=")) return part.slice(6);
  }
  return "O";
}

/**
 * Parse CoNLL-U text. `# newdoc id` carries over to following sentences.
 * @param {string} text
 * @returns {UdSentence[]}
 */
export function parseConllu(text) {
  const sentences = [];
  let docId = "";
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    let sentId = "";
    let sentText = "";
    const words = [];
    const mwts = [];
    for (const line of lines) {
      if (line.startsWith("#")) {
        const m = /^#\s*([^=]+?)\s*=\s?(.*)$/.exec(line);
        if (!m) continue;
        if (m[1] === "newdoc id") docId = m[2];
        else if (m[1] === "sent_id") sentId = m[2];
        else if (m[1] === "text") sentText = m[2];
        continue;
      }
      const cols = line.split("\t");
      if (cols.length !== 10) throw new Error(`bad CoNLL-U line in ${sentId}: ${line}`);
      const id = cols[0];
      if (id.includes(".")) continue;
      if (id.includes("-")) {
        const [a, b] = id.split("-").map(Number);
        mwts.push({ start: a, end: b, form: cols[1] });
        continue;
      }
      words.push({
        id: Number(id),
        form: cols[1],
        upos: cols[3],
        head: Number(cols[6]),
        deprel: cols[7],
        chunk: chunkFromMisc(cols[9]),
        misc: cols[9],
      });
    }
    sentences.push({ sentId, docId, text: sentText, words, mwts });
  }
  return sentences;
}
