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
import { type DictionaryService, createDictionaryService } from "../../services/dictionaryService";
import { createDictionaryModule } from "../../modules/dictionary";
import { fakeApi } from "../../modules/dictionary/testDictionary";
import { renderPage } from "../testUtils";
import { OutputPage } from "./OutputPage";

const h = vi.hoisted(() => ({
  parser: null as ParserService | null,
  vocab: null as VocabService | null,
  subword: null as SubwordService | null,
  dict: null as DictionaryService | null,
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
vi.mock("../../services/dictionaryService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/dictionaryService")>()),
  dictionaryService: () => h.dict,
}));

afterEach(cleanup);
beforeEach(async () => {
  await languageService().setLanguage("en");
  h.vocab = createVocabService(new VocabManager({ storage: createStorage({ indexedDB: new IDBFactory() }) }));
  h.dict = createDictionaryService(createDictionaryModule({ api: fakeApi() }), async () => null);
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
          type: "NP",
          level: "phrase",
          category: "NP",
          role: "Subject",
          attachTo: 2,
          attachFrom: 1,
          head: 0,
          start: 0,
          end: 0,
          contiguous: true,
          pinned: true,
          unsure: false,
          children: [{ ...labels, word: 0, isHead: true }],
        },
        {
          ...labels,
          type: "VP",
          level: "predicate",
          category: "VP",
          role: "Predicate",
          head: 1,
          start: 1,
          end: 2,
          contiguous: true,
          pinned: true,
          unsure: true,
          children: [
            { ...labels, word: 1, isHead: true },
            { ...labels, word: 2, role: "Complement", badge: true, attachTo: 0, attachFrom: 0, uncertain: true },
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

function setup(withNotice = false, parsed: ParseResult = result, text = TEXT): void {
  const m = mockService({ state: "ready", modelId: "deberta_v3_xsmall", backend: "wasm", modelVersion: "v1" });
  m.update({ annotation: annotate(parsed, text), notice: withNotice ? notice : null });
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
    fireEvent.click(screen.getByRole("radio", { name: "Phrases (flat)" }));
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
    fireEvent.click(screen.getByRole("radio", { name: "Phrases (flat)" }));
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
    // The main clause has no bracket: subject and predicate are the outermost groups (T82).
    expect(screen.queryByRole("group", { name: /Clause/ })).toBeNull();
    const subject = screen.getByRole("group", { name: /^Noun phrase \(NP\) · Subject/ });
    const predicate = screen.getByRole("group", { name: /^Verb phrase \(VP\) · Predicate; boundary uncertain/ });
    expect(subject.className).not.toMatch(/dashed/);
    expect(predicate.className).toMatch(/dashed/);
    expect(within(predicate).getByText("Complement").className).toMatch(/uncertain/);
  });

  it("draws an arrow from a word to what it attaches to, on hover and on focus, and names it for screen readers", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    const view = screen.getByRole("group", { name: /Predicate/ }).parentElement as HTMLElement;
    expect(view.querySelector("svg")).toBeNull();

    fireEvent.mouseOver(word("Dogs"));
    expect(view.querySelector("svg text")?.textContent).toBe("Subject");
    expect(view.querySelector("svg g")?.getAttribute("class") ?? "").not.toMatch(/unsure/);
    // The target is a span of words (T81): "look unhappy".
    expect(view.querySelector('[data-token="1"]')?.className).toMatch(/target/);
    expect(view.querySelector('[data-token="2"]')?.className).toMatch(/target/);
    expect(view.querySelector('[data-token="0"]')?.className).not.toMatch(/target/);
    fireEvent.mouseLeave(view);
    expect(view.querySelector("svg")).toBeNull();

    // An uncertain attachment: dashed arrow; the head word has no arrow of its own.
    fireEvent.focus(word("unhappy"));
    expect(view.querySelector("svg g")?.getAttribute("class")).toMatch(/unsure/);
    expect(view.querySelector('[data-token="0"]')?.className).toMatch(/target/);
    fireEvent.focus(word("look"));
    expect(view.querySelector("svg")).toBeNull();

    expect(screen.getByRole("group", { name: "Noun phrase (NP) · Subject; attaches to “look unhappy”" })).toBeTruthy();
    expect(within(view).getByText("attaches to “Dogs” (uncertain)")).toBeTruthy();
  });

  it("keeps Subject and Predicate labels pinned in every look", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    const view = screen.getByRole("group", { name: /Predicate/ }).parentElement as HTMLElement;
    expect(within(view).getByText("Subject").className).toMatch(/pinned/);
    expect(within(view).getByText("Predicate").className).toMatch(/pinned/);
    expect(within(view).getByText("Complement").className).not.toMatch(/pinned/);
  });

  it("opens in the structure view with labels on hover and blocks; single-choice toggles change the look (T88, T89)", () => {
    setup();
    expect((screen.getByRole("radio", { name: "Structure" }) as HTMLInputElement).checked).toBe(true);
    const labelGroup = screen.getByRole("group", { name: "Labels" });
    const position = screen.getByRole("group", { name: "Phrase Label Position" });
    const phrases = screen.getByRole("group", { name: "Phrases" });
    const checked = (g: HTMLElement): string[] =>
      within(g)
        .getAllByRole("radio")
        .filter((r) => (r as HTMLInputElement).checked)
        .map((r) => r.closest("label")?.textContent ?? "");
    expect(checked(labelGroup)).toEqual(["Show labels only on hover"]);
    expect(checked(phrases)).toEqual(["Draw as blocks"]);
    expect(checked(position)).toEqual(["Top"]);
    const nested = screen.getByRole("group", { name: /Predicate/ }).closest("div") as HTMLElement;
    expect(nested.className).toMatch(/boxes/);
    expect(nested.className).toMatch(/hover/);
    expect(nested.className).toMatch(/top/);
    // Boxes: outer phrases get more vertical padding than inner ones; the view reserves room for the deepest.
    expect(nested.style.getPropertyValue("--nest-max")).toBe("1");
    fireEvent.click(within(labelGroup).getByRole("radio", { name: "Always show labels" }));
    fireEvent.click(within(phrases).getByRole("radio", { name: "Draw as brackets" }));
    expect(nested.className).toMatch(/brackets/);
    expect(nested.className).toMatch(/always/);
    expect(checked(labelGroup)).toEqual(["Always show labels"]);
    // Phrase label position (T89): top by default; side puts the label before the phrase's words.
    fireEvent.click(within(position).getByRole("radio", { name: "Side" }));
    expect(nested.className).toMatch(/side/);
    expect(nested.className).not.toMatch(/\btop\b/);
    // The toggles belong to the structure view only.
    fireEvent.click(screen.getByRole("radio", { name: "Phrases (flat)" }));
    expect(screen.queryByRole("group", { name: "Labels" })).toBeNull();
  });

  it("moves the word panel to the bottom of the screen on request (T91)", () => {
    setup();
    const group = screen.getByRole("group", { name: "Word Panel Position" });
    expect((within(group).getByRole("radio", { name: "Side" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(word("look"));
    const panel = screen.getByRole("complementary", { name: "Selected word: look" });
    const layout = panel.parentElement as HTMLElement;
    expect(layout.className).not.toMatch(/panelBottom/);
    fireEvent.click(within(group).getByRole("radio", { name: "Bottom" }));
    expect(layout.className).toMatch(/panelBottom/);
    // The toggle is offered in both views.
    fireEvent.click(screen.getByRole("radio", { name: "Phrases (flat)" }));
    expect(screen.getByRole("group", { name: "Word Panel Position" })).toBeTruthy();
  });

  it("shows a near-tie as equal readings: note, open list, letters, explanations, and a fork (T83)", () => {
    const [sentence] = result.sentences;
    if (!sentence) throw new Error("fixture");
    // "unhappy" (2) may go with "look" (1; primary) or "Dogs" (0): 55% against 45%.
    const nearTie: ParseResult = {
      ...result,
      sentences: [
        {
          ...sentence,
          tokens: sentence.tokens.map((tok) => ({ ...tok, head: tok.index === 1 ? -1 : 1 })),
          alternatives: [
            {
              rank: 1,
              probability: 0.45,
              reason: "attachment",
              changes: [{ index: 2, head: 0 }],
              chunks: sentence.chunks,
              phrases: sentence.phrases,
              attachment: { word: 2, from: 1, to: 0 },
            },
          ],
        },
      ],
    };
    setup(false, nearTie);
    const article = screen.getByRole("article", { name: "Sentence 1" });
    expect(within(article).getByRole("note").textContent).toMatch(/about equally likely/);
    expect(within(article).getByText("Compare readings (2)")).toBeTruthy();
    expect(within(article).getByRole("radio", { name: "Reading A (55%)" })).toBeTruthy();
    expect(within(article).getByRole("radio", { name: "Reading B (45%)" })).toBeTruthy();
    expect(within(article).queryByRole("radio", { name: /Most likely/ })).toBeNull();
    expect(
      within(article).getByText("“unhappy” goes with the verb “look” (where, when, or how it happens)."),
    ).toBeTruthy();
    expect(within(article).getByText("“unhappy” describes the noun “Dogs” (which one, or what kind).")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Structure" }));
    const view = within(article).getByRole("group", { name: /Predicate/ }).parentElement as HTMLElement;
    const disputed = view.querySelector('[data-token="2"]') as HTMLElement;
    expect(disputed.className).toMatch(/disputed/);
    expect(within(disputed).getByText("readings differ here: “look” 55%, “Dogs” 45%")).toBeTruthy();
    fireEvent.mouseOver(word("unhappy", article));
    expect([...view.querySelectorAll("svg text")].map((x) => x.textContent)).toEqual(["55%", "45%"]);
    expect(view.querySelectorAll("svg g[class*='unsure']")).toHaveLength(2);
    expect(view.querySelector('[data-token="0"]')?.className).toMatch(/target/);
    expect(view.querySelector('[data-token="1"]')?.className).toMatch(/target/);
  });

  it("keeps the ranked list closed, with explanations, when one reading clearly leads", () => {
    setup();
    const article = screen.getByRole("article", { name: "Sentence 1" });
    expect(within(article).queryByRole("note")).toBeNull();
    expect(within(article).getByText("Other readings (1)").closest("details")?.open).toBe(false);
    expect(within(article).getByText("“look” is read as: Noun (NOUN).")).toBeTruthy();
    expect(within(article).getByText("“look” is read as: Verb (VERB).")).toBeTruthy();
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

  it("looks up both words of a phrasal verb as the phrasal verb (looked … up → look up)", async () => {
    const text = "She looked it up.";
    const parts: Array<[string, string, number, string]> = [
      ["She", "PRON", 1, "nsubj"],
      ["looked", "VERB", -1, "root"],
      ["it", "PRON", 1, "obj"],
      ["up", "ADP", 1, "compound:prt"],
      [".", "PUNCT", 1, "punct"],
    ];
    let pos = 0;
    const toks: Token[] = parts.map(([w, upos, head, relation], index) => {
      const start = text.indexOf(w, pos);
      pos = start + w.length;
      return {
        index,
        text: w,
        start,
        end: start + w.length,
        lemma: w === "looked" ? "look" : w.toLowerCase(),
        upos,
        uposProb: 0.9,
        chunkTag: "O",
        chunkProb: 0.9,
        head,
        relation,
        headProb: 0.9,
        relationProb: 0.9,
      };
    });
    const phrasal: ParseResult = {
      ...result,
      sentences: [
        { start: 0, end: text.length, tokens: toks, chunks: [], phrases: null, treeRepaired: false, alternatives: [] },
      ],
    };
    setup(false, phrasal, text);
    for (const w of ["looked", "up"]) {
      fireEvent.click(word(w));
      const panel = screen.getByRole("complementary", { name: `Selected word: ${w}` });
      const dict = within(panel).getByRole("region", { name: "Dictionary" });
      expect(await within(dict).findByRole("heading", { level: 3, name: "look up" })).toBeTruthy();
      expect(within(dict).getByText("“looked up” → base form: look up")).toBeTruthy();
      expect(within(dict).getByText("seek information from")).toBeTruthy();
      expect(within(dict).getByRole("link", { name: "More in the dictionary" }).getAttribute("href")).toBe(
        "/dictionary?q=looked+up&lemma=look+up&upos=VERB",
      );
    }
    // Other words are looked up on their own.
    fireEvent.click(word("it"));
    expect(await within(screen.getByRole("complementary")).findByText("No dictionary entry for “it”.")).toBeTruthy();
  });

  it("shows a phrasal verb the parse did not mark (ran out of → run out) with the word's own entry", async () => {
    const text = "They ran out of milk.";
    const parts: Array<[string, string, number, string]> = [
      ["They", "PRON", 1, "nsubj"],
      ["ran", "VERB", -1, "root"],
      ["out", "ADP", 4, "case"],
      ["of", "ADP", 2, "fixed"],
      ["milk", "NOUN", 1, "obl"],
      [".", "PUNCT", 1, "punct"],
    ];
    let pos = 0;
    const toks: Token[] = parts.map(([w, upos, head, relation], index) => {
      const start = text.indexOf(w, pos);
      pos = start + w.length;
      return {
        index,
        text: w,
        start,
        end: start + w.length,
        lemma: w === "ran" ? "run" : w.toLowerCase(),
        upos,
        uposProb: 0.9,
        chunkTag: "O",
        chunkProb: 0.9,
        head,
        relation,
        headProb: 0.9,
        relationProb: 0.9,
      };
    });
    setup(
      false,
      {
        ...result,
        sentences: [
          {
            start: 0,
            end: text.length,
            tokens: toks,
            chunks: [],
            phrases: null,
            treeRepaired: false,
            alternatives: [],
          },
        ],
      },
      text,
    );
    // "out" has no entry of its own in the test dictionary, so only the phrasal verb is shown for it.
    for (const [w, headings] of [
      ["ran", ["run out", "run"]],
      ["out", ["run out"]],
    ] as const) {
      fireEvent.click(word(w));
      const dict = within(screen.getByRole("complementary")).getByRole("region", { name: "Dictionary" });
      await within(dict).findByRole("heading", { level: 3, name: "run out" });
      expect(
        within(dict)
          .getAllByRole("article")
          .map((a) => a.querySelector("h3")?.textContent),
      ).toEqual(headings);
      expect(within(dict).getByText("떨어지다")).toBeTruthy();
      expect(within(dict).getByRole("link", { name: "More in the dictionary" }).getAttribute("href")).toBe(
        "/dictionary?q=ran+out&lemma=run+out&upos=VERB",
      );
    }
  });

  it("shows a dictionary summary for the selected word with a link to the dictionary page (T25, T53)", async () => {
    setup();
    fireEvent.click(word("look"));
    const panel = screen.getByRole("complementary", { name: "Selected word: look" });
    const dict = within(panel).getByRole("region", { name: "Dictionary" });
    // The parse's part of speech (VERB) comes first; compact: Korean words and two definitions.
    expect(await within(dict).findByText("보다")).toBeTruthy();
    expect(within(dict).getByRole("heading", { level: 3, name: "Verb (VERB)" })).toBeTruthy();
    expect(within(dict).getByText("perceive with attention")).toBeTruthy();
    expect(within(dict).queryByText("the act of looking")).toBeNull();
    expect(within(dict).getByRole("link", { name: "More in the dictionary" }).getAttribute("href")).toBe(
      "/dictionary?q=look&lemma=look&upos=VERB",
    );
    fireEvent.click(word("Dogs"));
    expect(await within(screen.getByRole("complementary")).findByText("No dictionary entry for “Dogs”.")).toBeTruthy();
  });
});
