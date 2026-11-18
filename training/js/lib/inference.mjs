/**
 * training/js/lib/inference.mjs — runtime-style model inputs and word-level argmax
 *
 * Description:
 *   The JS side of the tokenizer contract (labels.json → tokenizer_input =
 *   pre_split_words, window.max_subwords_per_word): encode runtime words one
 *   by one like Python's `is_split_into_words`, add the special tokens, and
 *   read one prediction per word (first subword) from packed logits. Same
 *   logic the app's transformerBackend.ts must follow; js/benchmark.mjs checks
 *   it against Python's token ids for every exported model.
 *
 * Phase: 7 (smoke test), 9 (parity), 10 (speed).
 *
 * Word encoding strategies (Transformers.js has no pre-split input option):
 *   "plain"  encode(word) — WordPiece (BERT, DistilBERT) and SentencePiece
 *            (DeBERTa-v3) already treat each word as if preceded by a space.
 *   "space"  encode(" " + word) — byte-level BPE (ModernBERT) needs the
 *            explicit space to get the "Ġ" form.
 *   benchmark.mjs picks the strategy whose ids equal Python's (reference.json)
 *   and reports it; the app must use the reported strategy per model.
 *
 * Dependencies: none (tokenizer and logits are passed in).
 *   Used by: ../benchmark.mjs, ../tests/inference.test.mjs.
 *
 * Status: implemented (Phase 7 pre-work).
 */

export const STRATEGIES = ["plain", "space"];

/** Special-token ids placed before and after the words (from encoding an empty string). */
export function specialIds(tokenizer) {
  const ids = tokenizer.encode("", { add_special_tokens: true });
  if (ids.length === 0) return { prefix: [], suffix: [] };
  if (ids.length === 1) return { prefix: [ids[0]], suffix: [] };
  return { prefix: [ids[0]], suffix: ids.slice(1) };
}

/**
 * Token ids and token→word map for pre-split words (-1 for special tokens).
 * @param {{ encode: Function }} tokenizer Transformers.js tokenizer
 * @param {string[]} words runtime words
 * @param {number} maxPerWord labels.json → window.max_subwords_per_word
 * @param {"plain" | "space"} strategy
 */
export function encodeWords(tokenizer, words, maxPerWord, strategy = "plain") {
  const { prefix, suffix } = specialIds(tokenizer);
  const ids = [...prefix];
  const tokenWord = prefix.map(() => -1);
  words.forEach((w, i) => {
    const text = strategy === "space" ? ` ${w}` : w;
    const pieces = tokenizer.encode(text, { add_special_tokens: false }).slice(0, maxPerWord);
    for (const id of pieces) {
      ids.push(id);
      tokenWord.push(i);
    }
  });
  ids.push(...suffix);
  tokenWord.push(...suffix.map(() => -1));
  return { ids, tokenWord };
}

/**
 * Group A and group B argmax per word (group-local ids) from one window's logits.
 * @param {Float32Array | number[]} data logits, row-major [T, C]
 * @param {number} width C
 * @param {number[]} tokenWord token → word index (-1 = special)
 * @param {{ chunk: {start: number, end: number}, dep: {start: number, end: number} }} groups labels.json → groups
 */
export function argmaxWords(data, width, tokenWord, groups) {
  const first = new Map();
  tokenWord.forEach((w, t) => {
    if (w >= 0 && !first.has(w)) first.set(w, t);
  });
  const nWords = first.size === 0 ? 0 : Math.max(...first.keys()) + 1;
  const best = (t, { start, end }) => {
    let arg = 0;
    let max = -Infinity;
    for (let c = start; c < end; c++) {
      const v = data[t * width + c];
      if (v > max) {
        max = v;
        arg = c - start;
      }
    }
    return arg;
  };
  const chunk = [];
  const dep = [];
  for (let w = 0; w < nWords; w++) {
    const t = first.get(w);
    chunk.push(t === undefined ? -1 : best(t, groups.chunk));
    dep.push(t === undefined ? -1 : best(t, groups.dep));
  }
  return { chunk, dep };
}

/**
 * Share of words with equal ids, per group, over many windows. With `margin`,
 * only words whose reference top-two logit gap exceeds it count (ref.chunkMargin /
 * ref.depMargin); `words` is then the counted words per group.
 */
export function agreement(pairs, margin = null) {
  const same = { chunk: 0, dep: 0 };
  const total = { chunk: 0, dep: 0 };
  for (const { js, ref } of pairs) {
    if (js.chunk.length !== ref.chunk.length) throw new Error("word counts differ");
    for (const g of ["chunk", "dep"]) {
      const gaps = margin === null ? null : ref[`${g}Margin`];
      js[g].forEach((x, i) => {
        if (gaps !== null && !(gaps[i] > margin)) return;
        total[g]++;
        if (x === ref[g][i]) same[g]++;
      });
    }
  }
  const share = (g) => (total[g] ? same[g] / total[g] : 1);
  return margin === null
    ? { chunk: share("chunk"), dep: share("dep"), words: total.chunk }
    : { chunk: share("chunk"), dep: share("dep"), words: total.chunk, dep_words: total.dep };
}

/** Equal arrays (token ids). */
export function sameIds(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
