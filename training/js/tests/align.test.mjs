/**
 * training/js/tests/align.test.mjs — unit tests for the Phase 3 alignment logic
 *
 * Runs with Node's built-in test runner (no extra dependency):
 *   npm test   (from training/js; = node --test tests/)
 *
 * Covers: CoNLL-U reading (MISC chunk, multiword tokens, newdoc carry-over),
 * locating UD words (MWT parts, non-concatenating MWTs, quote normalization),
 * exact / merge / split / complex label transfer, head remapping, chunk
 * prefixes (merges never join chunks), metric categories, tree and BIO checks.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignSentence, bioProblem, locateUdWords, treeProblem } from "../lib/align.mjs";
import { chunkFromMisc, parseConllu } from "../lib/conllu.mjs";

const identity = (s) => s;

/** Build a sentence from rows "form UPOS head deprel chunk"; ranges as {start,end,form}. */
function sentence(rows, mwts = [], text = null) {
  const words = rows.map((r, i) => {
    const [form, upos, head, deprel, chunk] = r.split(" ");
    return { id: i + 1, form, upos, head: Number(head), deprel, chunk, misc: `Chunk=${chunk}` };
  });
  const surface = text ?? words.map((w) => w.form).join(" ");
  return { sentId: "t-1", docId: "d-1", text: surface, words, mwts };
}

/** Runtime words from a list of [text, start] (sentence index 0). */
const runtime = (text, pieces) =>
  pieces.map((p) => {
    const start = text.indexOf(p[0], p[1] ?? 0);
    return { text: p[0], start, end: start + p[0].length, sent: p[2] ?? 0 };
  });

const brief = (words) => words.map((w) => `${w.form}/${w.upos}/${w.chunk}/${w.head}/${w.deprel}`);

describe("conllu", () => {
  it("reads chunk tags, multiword tokens, and carries newdoc ids", () => {
    const text = [
      "# newdoc id = doc-1",
      "# sent_id = s1",
      "# text = I don't.",
      "1\tI\tI\tPRON\t_\t_\t3\tnsubj\t_\tChunk=B-NP",
      "2-3\tdon't\t_\t_\t_\t_\t_\t_\t_\t_",
      "2\tdo\tdo\tAUX\t_\t_\t3\taux\t_\tChunk=B-VP",
      "3\tn't\tnot\tPART\t_\t_\t0\troot\t_\tSpaceAfter=No|Chunk=I-VP",
      "4\t.\t.\tPUNCT\t_\t_\t3\tpunct\t_\tChunk=O",
      "",
      "# sent_id = s2",
      "# text = Ok",
      "1\tOk\tok\tINTJ\t_\t_\t0\troot\t_\tChunk=O",
      "",
    ].join("\n");
    const [s1, s2] = parseConllu(text);
    assert.equal(s1.docId, "doc-1");
    assert.equal(s2.docId, "doc-1");
    assert.deepEqual(s1.mwts, [{ start: 2, end: 3, form: "don't" }]);
    assert.deepEqual(s1.words.map((w) => w.chunk), ["B-NP", "B-VP", "I-VP", "O"]);
    assert.equal(chunkFromMisc("_"), "O");
  });
});

describe("locateUdWords", () => {
  it("splits a multiword token into its parts when they spell the surface", () => {
    const s = sentence(["I PRON 3 nsubj B-NP", "do AUX 3 aux B-VP", "n't PART 3 advmod I-VP", "go VERB 0 root I-VP"], [
      { start: 2, end: 3, form: "don't" },
    ], "I don't go");
    assert.deepEqual(locateUdWords(s.text, s, identity), [
      { start: 0, end: 1 }, { start: 2, end: 4 }, { start: 4, end: 7 }, { start: 8, end: 10 },
    ]);
  });

  it("gives every part the whole span when parts do not spell the surface", () => {
    const s = sentence(["gim VERB 0 root B-VP", "me PRON 1 obj B-NP"], [{ start: 1, end: 2, form: "gimmy" }], "gimmy");
    assert.deepEqual(locateUdWords(s.text, s, identity), [{ start: 0, end: 5 }, { start: 0, end: 5 }]);
  });

  it("matches normalized forms", () => {
    const s = sentence(["Kerry PROPN 0 root B-NP", "’s PART 1 case I-NP"], [], "Kerry's");
    const norm = (x) => x.replace("’", "'");
    assert.deepEqual(locateUdWords("Kerry's", s, norm), [{ start: 0, end: 5 }, { start: 5, end: 7 }]);
  });

  it("throws if a word is missing", () => {
    const s = sentence(["cat NOUN 0 root B-NP"]);
    assert.throws(() => locateUdWords("dog", s, identity), /not found/);
  });
});

describe("alignSentence", () => {
  it("copies labels for exact matches", () => {
    const s = sentence(["The DET 2 det B-NP", "dog NOUN 3 nsubj I-NP", "barked VERB 0 root B-VP"]);
    const rt = runtime(s.text, [["The"], ["dog"], ["barked"]]);
    const r = alignSentence(s.words, locateUdWords(s.text, s, identity), rt);
    assert.deepEqual(brief(r.words), ["The/DET/B-NP/2/det", "dog/NOUN/I-NP/3/nsubj", "barked/VERB/B-VP/0/root"]);
    assert.deepEqual(r.udCategory, ["exact", "exact", "exact"]);
  });

  it("merges a hyphenated word: head word labels, arcs into the span remapped", () => {
    // a well - known author : UD splits "well-known"
    const text = "a well-known author";
    const s = sentence(
      ["a DET 5 det B-NP", "well ADV 4 advmod I-NP", "- PUNCT 4 punct I-NP", "known VERB 5 amod I-NP", "author NOUN 0 root I-NP"],
      [], text,
    );
    const rt = runtime(text, [["a"], ["well-known"], ["author"]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(brief(r.words), ["a/DET/B-NP/3/det", "well-known/VERB/I-NP/3/amod", "author/NOUN/I-NP/0/root"]);
    assert.deepEqual(r.udCategory, ["exact", "merge:hyphen", "merge:hyphen", "merge:hyphen", "exact"]);
    assert.equal(r.words[1].rule, "merge:hyphen");
  });

  it("merges a glued token, preferring the non-punctuation head word", () => {
    // "turn them in." — wink keeps "in." whole; UD has "in" + "."
    const text = "turn them in.";
    const s = sentence(["turn VERB 0 root B-VP", "them PRON 1 obj B-NP", "in ADP 1 compound:prt B-ADVP", ". PUNCT 1 punct O"], [], text);
    const rt = runtime(text, [["turn"], ["them"], ["in."]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(brief(r.words)[2], "in./ADP/B-ADVP/1/compound:prt");
    assert.equal(r.multiExitMerges, 1);
    assert.equal(r.udCategory[2], "merge:glued");
  });

  it("never joins two UD chunks through a merge", () => {
    // "I'ma sophomore": UD I | 'm | a sophomore ; wink keeps "I'ma"
    const text = "I'ma sophomore";
    const s = sentence(
      ["I PRON 4 nsubj B-NP", "'m AUX 4 cop B-VP", "a DET 4 det B-NP", "sophomore NOUN 0 root I-NP"],
      [{ start: 1, end: 3, form: "I'ma" }], text,
    );
    const rt = runtime(text, [["I'ma"], ["sophomore"]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(brief(r.words), ["I'ma/PRON/B-NP/2/nsubj", "sophomore/NOUN/B-NP/0/root"]);
    assert.equal(r.udCategory[0], "merge:other");
  });

  it("splits a UD word: main piece keeps labels, others attach with goeswith", () => {
    const text = "the 50's music";
    const s = sentence(["the DET 3 det B-NP", "50's NOUN 3 compound I-NP", "music NOUN 0 root I-NP"], [], text);
    const rt = runtime(text, [["the"], ["50"], ["'s"], ["music"]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(brief(r.words), [
      "the/DET/B-NP/4/det", "50/NOUN/I-NP/4/compound", "'s/X/I-NP/2/goeswith", "music/NOUN/I-NP/0/root",
    ]);
    assert.equal(r.udCategory[1], "split");
  });

  it("uses the first piece with a letter or digit as the main piece", () => {
    const text = "Hamid 'Akkab";
    const s = sentence(["Hamid PROPN 0 root B-NP", "'Akkab PROPN 1 flat I-NP"], [], text);
    const rt = runtime(text, [["Hamid"], ["'"], ["Akkab"]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(brief(r.words), ["Hamid/PROPN/B-NP/0/root", "'/PUNCT/I-NP/3/goeswith", "Akkab/PROPN/I-NP/1/flat"]);
  });

  it("handles partial overlaps (merge and split together)", () => {
    // UD: AK | - | 47's   runtime: AK-47 | 's
    const text = "their AK-47's";
    const s = sentence(["their PRON 4 nmod:poss B-NP", "AK PROPN 4 compound I-NP", "- PUNCT 4 punct I-NP", "47's NOUN 0 root I-NP"], [], text);
    const rt = runtime(text, [["their"], ["AK-47"], ["'s"]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(brief(r.words), ["their/PRON/B-NP/2/nmod:poss", "AK-47/NOUN/I-NP/0/root", "'s/X/I-NP/2/goeswith"]);
    assert.equal(r.udCategory[3], "complex");
    assert.equal(treeProblem(r.words.map((w) => w.head)), null);
  });

  it("keeps the runtime sentence index of each word", () => {
    const text = "Go. Now";
    const s = sentence(["Go VERB 0 root B-VP", ". PUNCT 1 punct O", "Now ADV 1 advmod B-ADVP"], [], text);
    const rt = runtime(text, [["Go", 0, 0], [".", 0, 0], ["Now", 0, 1]]);
    const r = alignSentence(s.words, locateUdWords(text, s, identity), rt);
    assert.deepEqual(r.words.map((w) => w.wink_sent), [0, 0, 1]);
  });

  it("throws if a runtime word covers no UD word", () => {
    const s = sentence(["cat NOUN 0 root B-NP"], [], "cat !");
    assert.throws(() => alignSentence(s.words, [{ start: 0, end: 3 }], runtime("cat !", [["cat"], ["!"]])), /no UD word/);
  });
});

describe("checks", () => {
  it("treeProblem finds roots, cycles, and range errors", () => {
    assert.equal(treeProblem([2, 0, 2]), null);
    assert.match(treeProblem([0, 0]), /2 roots/);
    assert.match(treeProblem([2, 3, 1, 0]), /cycle/);
    assert.match(treeProblem([5, 0]), /out of range/);
  });

  it("bioProblem rejects I- without a chunk and unknown types", () => {
    assert.equal(bioProblem(["B-NP", "I-NP", "O", "B-VP"]), null);
    assert.match(bioProblem(["I-NP"]), /does not continue/);
    assert.match(bioProblem(["B-NP", "I-VP"]), /does not continue/);
    assert.match(bioProblem(["B-XP"]), /bad tag/);
  });
});
