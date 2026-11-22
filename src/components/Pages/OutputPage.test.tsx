// @vitest-environment jsdom
/**
 * src/components/Pages/OutputPage.test.tsx — annotated output, readings, views, word details (T57)
 */

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "../../core/storage";
import { mockService } from "../../hooks/testParserService";
import { annotate } from "../../modules/output";
import type { ParseResult, Token } from "../../modules/parser";
import { VocabManager } from "../../modules/vocab";
import { languageService } from "../../services/languageService";
import type { ParserService, PreprocessResult } from "../../services/parserService";
import type { SubwordService } from "../../services/subwordService";
import { type VocabService, createVocabService } from "../../services/vocabService";
import { renderPage } from "../testUtils";
import { OutputPage } from "./OutputPage";

const h = vi.hoisted(() => ({
  parser: null as ParserService | null,
  vocab: null as VocabService | null,
  subword: null as SubwordService | null,
}));
vi.mock("../../services/parserService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/parserService")>()),
  parserService: () => h.parser,
}));
vi.mock("../../services/vocabService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/vocabService")>()),
  vocabService: () => h.vocab,
}));
vi.mock("../../services/subwordService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/subwordService")>()),
  subwordService: () => h.subword,
}));

afterEach(cleanup);
beforeEach(async () => {
  await languageService().setLanguage("en");
  h.vocab = createVocabService(new VocabManager({ storage: createStorage({ indexedDB: new IDBFactory() }) }));
  h.subword = {
    segmentWord: vi.fn<SubwordService["segmentWord"]>(async (word) =>
      word === "unhappy"
        ? {
            word,
            lemma: word,
            segments: [
              {
                text: "un",
                kind: "prefix",
                affix: {
                  id: "prefix:un",
                  kind: "prefix",
                  form: "un",
                  variants: [],
                  level: 3,
                  meaning: "not",
                  gloss: "아닌",
                  examples: [],
                },
              },
              { text: "happy", kind: "base" },
            ],
          }
        : { word, lemma: word, segments: [{ text: word, kind: "base" }] },
    ),
  };
});

const TEXT = "Dogs look unhappy.";
const words = ["Dogs", "look", "unhappy", "."];
const tokens: Token[] = words.map((text, index) => {
  const start = TEXT.indexOf(text);
  return {
    index,
    text,
    start,
    end: start + text.length,
    lemma: text === "Dogs" ? "dog" : text.toLowerCase(),
    upos: ["NOUN", "VERB", "ADJ", "PUNCT"][index] as string,
    uposProb: 0.9,
    chunkTag: "O",
    chunkProb: 0.9,
    head: -1,
    relation: "dep",
    headProb: 0.9,
    relationProb: 0.9,
  };
});
const labels = { role: null, isHead: false, coordinated: false, splitPredicate: false, badge: false } as const;
const result: ParseResult = {
  modelId: "deberta_v3_xsmall",
  modelVersion: "v1",
  backend: "wasm",
  sentences: [
    {
      start: 0,
      end: TEXT.length,
      tokens,
      chunks: [
        { type: "NP", start: 0, end: 0 },
        { type: "VP", start: 1, end: 1 },
        { type: "ADJP", start: 2, end: 2 },
      ],
      treeRepaired: false,
      phrases: [
        {
          ...labels,
          type: "VP",
          category: "S",
          head: 1,
          start: 0,
          end: 2,
          contiguous: true,
          wrapper: false,
          children: [
            { ...labels, word: 0, role: "Subject" },
            { ...labels, word: 1, isHead: true, role: "Predicate" },
            { ...labels, word: 2, role: "Complement", badge: true },
          ],
        },
        { ...labels, word: 3 },
      ],
      alternatives: [
        {
          rank: 1,
          probability: 0.2,
          reason: "probability",
          changes: [{ index: 1, upos: "NOUN", chunkTag: "B-NP" }],
          chunks: [{ type: "NP", start: 0, end: 1 }],
          phrases: null,
        },
      ],
    },
  ],
};
const notice = {
  text: TEXT,
  hasRemovals: true,
  removed: {
    nonLatin: { count: 3, samples: ["한국어"] },
    emoji: { count: 0, samples: [] },
    control: { count: 0, samples: [] },
  },
} as unknown as PreprocessResult;

function setup(withNotice = false): void {
  const m = mockService({ state: "ready", modelId: "deberta_v3_xsmall", backend: "wasm", modelVersion: "v1" });
  m.update({ annotation: annotate(result, TEXT), notice: withNotice ? notice : null });
  h.parser = m.service;
  renderPage(<OutputPage />, "/output");
}
const word = (text: string, scope: HTMLElement = document.body): HTMLElement =>
  within(scope).getByRole("button", { name: new RegExp(`^${text}\\b`) });

describe("OutputPage", () => {
  it("points to the input page before anything is parsed", () => {
    h.parser = mockService().service;
    renderPage(<OutputPage />, "/output");
    expect(screen.getByText("Nothing has been parsed yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the input page" }).getAttribute("href")).toBe("/input");
  });

  it("shows color-coded chunks with labels, the model, the removal notice, and ambiguity marks", () => {
    setup(true);
    expect(screen.getByText("Parsed with deberta_v3_xsmall (v1, WASM)")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "Some text was removed before parsing: 3 non-English characters.",
    );
    const sentence = screen.getByRole("article", { name: "Sentence 1" });
    expect(within(sentence).getByRole("group", { name: "Noun phrase (NP)" }).textContent).toContain("Dogs");
    expect(within(sentence).getByRole("group", { name: "Adjective phrase (ADJP)" }).textContent).toContain("unhappy");
    expect(word("look", sentence).textContent).toBe("look (other readings possible)");
    expect(screen.getByText(/dotted underline/)).toBeTruthy();
  });

  it("switches a sentence to another reading and back", () => {
    setup();
    const sentence = screen.getByRole("article", { name: "Sentence 1" });
    fireEvent.click(within(sentence).getByText("Other readings (1)"));
    fireEvent.click(within(sentence).getByRole("radio", { name: "Reading 2 (20%, word labels)" }));
    const np = within(sentence).getByRole("group", { name: "Noun phrase (NP)" });
    expect(np.textContent).toContain("Dogs");
    expect(np.textContent).toContain("look");
    expect(word("look", sentence).textContent).toBe("look (changed in this reading)");
    fireEvent.click(within(sentence).getByRole("radio", { name: "Most likely (80%)" }));
    expect(within(sentence).getByRole("group", { name: "Verb phrase (VP)" })).toBeTruthy();
  });

  it("shows the nested view with categories, roles, and uncertain-role badges", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    const clause = screen.getByRole("group", { name: "Clause (S)" });
    expect(within(clause).getByText("Subject")).toBeTruthy();
    expect(within(clause).getByText("Predicate")).toBeTruthy();
    expect(within(clause).getByText("Complement").className).toMatch(/uncertain/);
  });

  it("toggles the nested look: labels on hover or always, brackets or boxes", () => {
    setup();
    expect(screen.queryByRole("checkbox", { name: "Draw phrases as brackets" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    const clause = screen.getByRole("group", { name: "Clause (S)" });
    const nested = clause.closest("div") as HTMLElement;
    expect(nested.className).toMatch(/brackets/);
    expect(nested.className).toMatch(/hover/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show labels only on hover" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Draw phrases as brackets" }));
    expect(nested.className).toMatch(/boxes/);
    expect(nested.className).toMatch(/always/);
  });

  it("selects a word: details with base form, part of speech, word parts, and add to list", async () => {
    setup();
    expect(screen.getByText("Select a word to see its details.")).toBeTruthy();
    fireEvent.click(word("unhappy"));
    expect(word("unhappy").getAttribute("aria-pressed")).toBe("true");
    const panel = screen.getByRole("complementary", { name: "Selected word: unhappy" });
    expect(within(panel).getByText("Adjective (ADJ)")).toBeTruthy();
    expect(await within(panel).findByText("un-")).toBeTruthy();
    expect(within(panel).getByText("prefix · 아닌")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Add to list" }));
    expect(await within(panel).findByText("Added “unhappy” to “My words”.")).toBeTruthy();
    const lists = h.vocab?.getSnapshot().lists ?? [];
    expect(lists[0]?.items[0]).toMatchObject({ word: "unhappy", lemma: "unhappy", upos: "ADJ", sourceSentence: TEXT });

    // The part of speech follows the reading the word was selected in.
    const sentence = screen.getByRole("article", { name: "Sentence 1" });
    fireEvent.click(within(sentence).getByText("Other readings (1)"));
    fireEvent.click(within(sentence).getByRole("radio", { name: /Reading 2/ }));
    fireEvent.click(word("look", sentence));
    await waitFor(() => expect(screen.getByRole("complementary").textContent).toContain("Noun (NOUN)"));
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
