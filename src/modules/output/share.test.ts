/**
 * src/modules/output/share.test.ts — tests for the shared-result codecs (T99)
 *
 * Covers: the reduced form (main readings only, other-readings flag), the
 * link rule (one sentence and fewer than 128 characters), file and link round
 * trips through annotate(), and refusal of damaged or hostile data.
 */

import { describe, expect, it } from "vitest";
import { annotate } from "./annotator";
import {
  SHARE_FORMAT,
  SHARE_LINK_MAX_CHARS,
  SHARE_MAX_FILE_BYTES,
  SHARE_MAX_LINK_CHARS,
  ShareFormatError,
  decodeShareFile,
  decodeShareLink,
  encodeShareFile,
  encodeShareLink,
  shareKind,
  toShared,
} from "./share";
import type { AnnotatorInput, InputPhrase, InputWord } from "./types";

const labels = {
  role: null,
  isHead: false,
  coordinated: false,
  splitPredicate: false,
  badge: false,
  attachTo: null,
  attachFrom: null,
  uncertain: false,
} as const;

type Sentence = AnnotatorInput["sentences"][number];

/** A sentence of space-separated words starting at `offset`; the first word is the root. */
function sentence(words: string[], offset = 0, over: Partial<Sentence> = {}): Sentence {
  let pos = offset;
  const tokens = words.map((text, index) => {
    const start = pos;
    pos += text.length + 1;
    return {
      index,
      text,
      start,
      end: start + text.length,
      lemma: index === 0 ? null : text.toLowerCase(),
      upos: "NOUN",
      chunkTag: index === 0 ? "B-NP" : "I-NP",
      head: index === 0 ? -1 : 0,
      relation: index === 0 ? "root" : "compound:prt",
    };
  });
  return { start: offset, end: pos - 1, tokens, chunks: [], phrases: null, alternatives: [], ...over };
}

const input = (sentences: Sentence[]): AnnotatorInput => ({
  sentences,
  modelId: "deberta_v3_xsmall",
  modelVersion: "1.0.0",
  backend: "wasm",
});

const word = (w: number, over: Partial<InputWord> = {}): InputWord => ({ word: w, ...labels, ...over });
const TEXT = "Dogs chase cats";
const phrases: Array<InputPhrase | InputWord> = [
  {
    category: "S",
    head: 1,
    start: 0,
    end: 2,
    contiguous: true,
    unsure: true,
    ...labels,
    children: [
      word(0, { role: "Subject", attachTo: 1, attachFrom: 1 }),
      {
        category: "VP",
        head: 1,
        start: 1,
        end: 2,
        contiguous: true,
        unsure: false,
        ...labels,
        role: "Predicate",
        isHead: true,
        children: [
          word(1, { isHead: true }),
          word(2, { role: "Object", attachTo: 1, attachFrom: 1, uncertain: true, badge: true }),
        ],
      },
    ],
  },
];
const full = (): AnnotatorInput =>
  input([
    sentence(TEXT.split(" "), 0, {
      chunks: [
        { type: "NP", start: 0, end: 0 },
        { type: "VP", start: 1, end: 2 },
      ],
      phrases,
    }),
  ]);

const alternative = {
  rank: 1,
  probability: 0.3,
  reason: "probability" as const,
  changes: [{ index: 1, upos: "VERB" }],
  chunks: [],
  phrases: null,
};

describe("toShared", () => {
  it("keeps the main reading and drops everything else", () => {
    const withExtras = full() as AnnotatorInput & { extra: number };
    withExtras.extra = 1;
    const first = withExtras.sentences[0]?.tokens[0] as { uposProb?: number };
    first.uposProb = 0.9;
    const shared = toShared(withExtras, TEXT);
    expect(shared.text).toBe(TEXT);
    expect(shared.input).toEqual(full());
    expect(Object.keys(shared.input.sentences[0]?.tokens[0] ?? {})).not.toContain("uposProb");
    expect(shared.input.sentences[0]?.otherReadings).toBeUndefined();
  });

  it("flags a sentence that had other readings, without including them", () => {
    const shared = toShared(input([sentence(["Dogs", "run"], 0, { alternatives: [alternative] })]), "Dogs run");
    expect(shared.input.sentences[0]?.alternatives).toEqual([]);
    expect(shared.input.sentences[0]?.otherReadings).toBe(true);
    // Sharing a shared result again keeps the flag.
    expect(toShared(shared.input, shared.text).input.sentences[0]?.otherReadings).toBe(true);
  });
});

describe("shareKind", () => {
  const one = (text: string) => toShared(input([sentence(text.split(" "))]), text);

  it("is a link only for one sentence shorter than the limit", () => {
    expect(shareKind(one(TEXT))).toBe("link");
    const longest = `${"a".repeat(SHARE_LINK_MAX_CHARS - 3)} b`;
    expect(longest).toHaveLength(SHARE_LINK_MAX_CHARS - 1);
    expect(shareKind(one(longest))).toBe("link");
    expect(shareKind(one(`${longest}c`))).toBe("file");
  });

  it("is a file for two sentences, however short", () => {
    const two = toShared(input([sentence(["Hi"]), sentence(["Bye"], 3)]), "Hi Bye");
    expect(shareKind(two)).toBe("file");
  });
});

describe("file and link round trips", () => {
  it("a file gives back the same result, and the same annotation", () => {
    const shared = toShared(full(), TEXT);
    const back = decodeShareFile(encodeShareFile(shared));
    expect(back).toEqual(shared);
    expect(annotate(back.input, back.text)).toEqual(annotate(full(), TEXT));
  });

  it("a link gives back the same result and carries the other-readings flag", async () => {
    const source = full();
    const shared = toShared(
      { ...source, sentences: source.sentences.map((s) => ({ ...s, alternatives: [alternative] })) },
      TEXT,
    );
    const data = await encodeShareLink(shared);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeShareLink(data);
    expect(back).toEqual(shared);
    const s = annotate(back.input, back.text).sentences[0];
    expect(s?.readings).toHaveLength(1);
    expect(s?.otherReadingsOmitted).toBe(true);
    expect(annotate(full(), TEXT).sentences[0]?.otherReadingsOmitted).toBe(false);
  });

  it("keeps a link for the longest allowed sentence short", async () => {
    const words =
      "The quick brown fox jumps over the lazy dog near the bank of the river while seven small birds watch from a tall tree above".split(
        " ",
      );
    const text = words.join(" ");
    expect(text.length).toBeLessThan(SHARE_LINK_MAX_CHARS);
    const nodes = words.map((_, i) => word(i, { role: "Modifier", attachTo: 0, attachFrom: 0 }));
    const data = await encodeShareLink(toShared(input([sentence(words, 0, { phrases: nodes })]), text));
    expect(data.length).toBeLessThan(2000);
  });

  it("keeps several sentences and paragraphs in a file", () => {
    const text = "Hi there\n\nBye now";
    const shared = toShared(input([sentence(["Hi", "there"]), sentence(["Bye", "now"], 10)]), text);
    const back = decodeShareFile(encodeShareFile(shared));
    expect(annotate(back.input, back.text).sentences.map((s) => [s.text, s.paragraph])).toEqual([
      ["Hi there", 0],
      ["Bye now", 1],
    ]);
  });
});

describe("refusing bad data", () => {
  type Loose = Record<string, unknown> & { s: Array<Record<string, unknown> & { k: unknown[][]; p: unknown[][] }> };
  const wire = (): Loose => JSON.parse(encodeShareFile(toShared(full(), TEXT))) as Loose;
  const expectRefused = (change: (w: Loose) => void, reason = "invalid"): void => {
    const w = wire();
    change(w);
    let thrown: unknown;
    try {
      decodeShareFile(JSON.stringify(w));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ShareFormatError);
    expect((thrown as ShareFormatError).reason).toBe(reason);
  };

  it("refuses other files, other versions, and files that are too large", () => {
    expect(wire().f).toBe(SHARE_FORMAT);
    expect(() => decodeShareFile("not json")).toThrow(ShareFormatError);
    expect(() => decodeShareFile("[]")).toThrow(ShareFormatError);
    expectRefused((w) => (w.f = "other"));
    expectRefused((w) => (w.v = 2), "version");
    expect(() => decodeShareFile(" ".repeat(SHARE_MAX_FILE_BYTES + 1))).toThrow(/too large/);
  });

  it("refuses text over the input limit and unknown backends", () => {
    expect.hasAssertions();
    expectRefused((w) => (w.t = "a".repeat(5001)));
    expectRefused((w) => (w.b = "cuda"));
    expectRefused((w) => (w.m = "m".repeat(65)));
    expectRefused((w) => (w.s = []));
  });

  it("refuses offsets, heads, and labels out of range", () => {
    expect.hasAssertions();
    expectRefused((w) => ((w.s[0] as Loose["s"][number]).e = 99));
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[0] as unknown[])[1] = 99)); // word end past the sentence
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[1] as unknown[])[0] = 0)); // overlaps the previous word
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[1] as unknown[])[4] = 3)); // head out of range
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[1] as unknown[])[4] = 1)); // own head
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[0] as unknown[])[2] = "<b>"));
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[0] as unknown[])[3] = "B-XP"));
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).k[0] as unknown[])[5] = "Root!"));
    expectRefused((w) => ((w.s[0] as Loose["s"][number]).k[0] as unknown[]).push(1));
    expectRefused((w) => ((w.s[0] as Loose["s"][number]).o = 2));
    expectRefused((w) => ((w.s[0] as Loose["s"][number]).c = [[9, 0, 0]]));
  });

  it("refuses bad nested nodes, deep nesting, and too many nodes", () => {
    expect.hasAssertions();
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).p[0] as unknown[])[0] = 99)); // category
    expectRefused((w) => (((w.s[0] as Loose["s"][number]).p[0] as unknown[])[3] = 7)); // phrase end
    expectRefused((w) => ((w.s[0] as Loose["s"][number]).p = [[5, 0, 0, -1, -1]])); // word out of range
    expectRefused((w) => ((w.s[0] as Loose["s"][number]).p = [[0, 0]]));
    expectRefused((w) => {
      let node: unknown[] = [0, -1, 0, -1, -1];
      for (let i = 0; i < 80; i++) node = [-1, 0, 0, 0, -1, 0, -1, -1, [node]];
      (w.s[0] as Loose["s"][number]).p = [node];
    });
    expectRefused((w) => {
      const leaf = [0, -1, 0, -1, -1];
      const wide = (): unknown[] => [-1, 0, 0, 0, -1, 0, -1, -1, Array.from({ length: 12 }, () => leaf)];
      (w.s[0] as Loose["s"][number]).p = [wide(), wide()];
    });
  });

  it("refuses damaged, oversized, and non-share links", async () => {
    await expect(decodeShareLink("not base64!")).rejects.toBeInstanceOf(ShareFormatError);
    await expect(decodeShareLink("AAAA")).rejects.toBeInstanceOf(ShareFormatError);
    await expect(decodeShareLink("A".repeat(SHARE_MAX_LINK_CHARS + 1))).rejects.toThrow(/too long/);
    const good = await encodeShareLink(toShared(full(), TEXT));
    await expect(decodeShareLink(good.slice(0, -6))).rejects.toBeInstanceOf(ShareFormatError);
    // A small link that inflates to far more than a result can be.
    const bomb = new Blob([new Uint8Array(4 * 1024 * 1024)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(bomb).arrayBuffer());
    const data = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(data.length).toBeLessThan(SHARE_MAX_LINK_CHARS);
    await expect(decodeShareLink(data)).rejects.toThrow(/too large/);
  });
});
