/**
 * src/modules/parser/parser.test.ts — unit tests for the parse flow (T35)
 *
 * Covers: BIO repair and chunk grouping, refusal before ready, tokens (offsets, heads,
 * relations), nested view on/off with gating and roles, backend errors, empty input.
 * The backend is mocked; words come from the real winkBackend.
 */

import { describe, expect, it } from "vitest";
import { Parser, buildSentenceParse, groupChunks, repairBio } from "./parser";
import { LABELS, MODEL, arcFor, mockBackend, taggedDog } from "./testFixtures";
import { type LabelConfig, ParserNotReadyError, ParserRuntimeError, type SentenceSpan } from "./types";

describe("repairBio and groupChunks", () => {
  it("turns a stray I-X into B-X and keeps valid sequences", () => {
    expect(repairBio(["I-NP", "I-NP", "O", "I-VP", "B-NP", "I-PP"])).toEqual([
      "B-NP",
      "I-NP",
      "O",
      "B-VP",
      "B-NP",
      "B-PP",
    ]);
    expect(repairBio(["B-NP", "I-NP", "B-VP"])).toEqual(["B-NP", "I-NP", "B-VP"]);
  });

  it("groups chunks with inclusive token ranges", () => {
    expect(groupChunks(["B-NP", "I-NP", "B-VP", "O", "I-PP", "I-PP"])).toEqual([
      { type: "NP", start: 0, end: 1 },
      { type: "VP", start: 2, end: 2 },
      { type: "PP", start: 4, end: 5 },
    ]);
    expect(groupChunks([])).toEqual([]);
  });
});

describe("Parser", () => {
  it("refuses to parse before the backend is ready", async () => {
    await expect(new Parser(mockBackend({ ready: false }), MODEL).parse("The dog barks.")).rejects.toBeInstanceOf(
      ParserNotReadyError,
    );
  });

  it("returns tokens with wink offsets, heads, relations, chunks, and model traceability", async () => {
    const text = "The dog barks.";
    const result = await new Parser(mockBackend(), MODEL).parse(text);
    expect(result).toMatchObject({ modelId: "test-model", modelVersion: "1.0.0", backend: "wasm" });
    const [s] = result.sentences;
    expect(s?.tokens.map((t) => text.slice(t.start, t.end))).toEqual(["The", "dog", "barks", "."]);
    expect(s?.tokens.map((t) => t.head)).toEqual([1, 2, -1, 2]);
    expect(s?.tokens.map((t) => t.relation)).toEqual(["det", "nsubj", "root", "punct"]);
    expect(s?.tokens[0]?.headProb).toBeCloseTo(0.98, 6);
    expect(s?.tokens[0]?.relationProb).toBeCloseTo(0.95, 6);
    expect(s?.chunks).toEqual([
      { type: "NP", start: 0, end: 1 },
      { type: "VP", start: 2, end: 2 },
    ]);
    expect(s?.treeRepaired).toBe(false);
    expect(s?.alternatives).toEqual([]);
  });

  it("builds the labeled nested view only for models that ship it", async () => {
    const [withNested] = (await new Parser(mockBackend(), MODEL).parse("The dog barks.")).sentences;
    const top = withNested?.phrases?.[0];
    expect(top && "category" in top ? top.category : null).toBe("S");
    const subject = top && "children" in top ? top.children[0] : undefined;
    expect(subject && "role" in subject ? subject.role : null).toBe("Subject");
    const [flat] = (await new Parser(mockBackend(), { ...MODEL, nestedView: false }).parse("The dog barks.")).sentences;
    expect(flat?.phrases).toBeNull();
  });

  it("collapses uncertain brackets and badges their roles", () => {
    const t = taggedDog();
    t.arc = arcFor([2, 3, 0, 3], 0.4); // every head uncertain: brackets collapse, roles below the role gate
    const span: SentenceSpan = {
      start: 0,
      end: 14,
      words: ["The", "dog", "barks", "."].map((w, i) => ({ text: w, start: i, end: i + 1 })),
    };
    const s = buildSentenceParse(span, t, LABELS, true);
    expect(s.phrases?.some((x) => "children" in x && x.end > x.start)).toBe(false);
  });

  it("wraps backend failures as ParserRuntimeError and checks sentence counts", async () => {
    const failing = mockBackend({ tag: async () => Promise.reject(new Error("session lost")) });
    await expect(new Parser(failing, MODEL).parse("Hi there.")).rejects.toBeInstanceOf(ParserRuntimeError);
    const short = mockBackend({ tag: async () => [] });
    await expect(new Parser(short, MODEL).parse("Hi there.")).rejects.toThrow(/0 sentences/);
  });

  it("rejects labels.json without the Phase 8 thresholds", () => {
    const labels = { ...LABELS, nested: { bracket_threshold: null, role_threshold: null } } as LabelConfig;
    const span: SentenceSpan = {
      start: 0,
      end: 4,
      words: ["a", "b", "c", "d"].map((w, i) => ({ text: w, start: i, end: i + 1 })),
    };
    expect(() => buildSentenceParse(span, taggedDog(), labels, true)).toThrow(ParserRuntimeError);
  });

  it("returns no sentences for empty text without calling the backend", async () => {
    let called = false;
    const backend = mockBackend({
      tag: async () => {
        called = true;
        return [];
      },
    });
    expect((await new Parser(backend, MODEL).parse("   ")).sentences).toEqual([]);
    expect(called).toBe(false);
  });
});
