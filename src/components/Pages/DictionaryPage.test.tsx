// @vitest-environment jsdom
/**
 * src/components/Pages/DictionaryPage.test.tsx — dictionary page over the real dictionaryService and module (T53)
 *
 * Fake dictionary server and cache (modules/dictionary/testDictionary.ts). Covers: search from the form and the
 * URL, inflected and ambiguous forms, the queried part of speech first, "show all" definitions, examples with
 * attribution, word parts, add to list, not found, and the offline error with its link.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDictionaryModule } from "../../modules/dictionary";
import { type FakeApi, ENTRIES, fakeApi } from "../../modules/dictionary/testDictionary";
import { type DictionaryService, createDictionaryService } from "../../services/dictionaryService";
import { languageService } from "../../services/languageService";
import type { SubwordService } from "../../services/subwordService";
import { type VocabService, createVocabService } from "../../services/vocabService";
import { createStorage } from "../../core/storage";
import { VocabManager } from "../../modules/vocab";
import { IDBFactory } from "fake-indexeddb";
import { renderPage } from "../testUtils";
import { DictionaryPage, dictionaryLink } from "./DictionaryPage";

const h = vi.hoisted(() => ({
  dict: null as DictionaryService | null,
  api: null as FakeApi | null,
  subword: null as SubwordService | null,
  vocab: null as VocabService | null,
}));
vi.mock("../../services/dictionaryService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/dictionaryService")>()),
  dictionaryService: () => h.dict,
}));
vi.mock("../../services/subwordService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/subwordService")>()),
  subwordService: () => h.subword,
}));
vi.mock("../../services/vocabService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/vocabService")>()),
  vocabService: () => h.vocab,
}));

afterEach(cleanup);
beforeEach(async () => {
  h.api = fakeApi();
  h.dict = createDictionaryService(createDictionaryModule({ api: h.api }), async () => null);
  h.vocab = createVocabService(new VocabManager({ storage: createStorage({ indexedDB: new IDBFactory() }) }));
  h.subword = {
    segmentWord: async (word) =>
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
  };
  await languageService().setLanguage("en");
});

const open = (query: string) => renderPage(<DictionaryPage />, "/dictionary", `/dictionary?${query}`);

describe("DictionaryPage", () => {
  it("explains the page before a search and searches from the form", async () => {
    const router = renderPage(<DictionaryPage />, "/dictionary");
    expect(screen.getByText(/Inflected forms such as ran find their base word/)).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "English word or phrasal verb" }), {
      target: { value: "  look up " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(router.state.location.search).toBe("?q=look+up");
    expect(await screen.findByRole("heading", { level: 2, name: "look up" })).toBeTruthy();
  });

  it("finds the base form of an inflected word, with Korean words, definitions, and examples", async () => {
    open("q=ran");
    const entry = await screen.findByRole("article", { name: "run" });
    expect(within(entry).getByText("“ran” → base form: run")).toBeTruthy();
    const verb = within(entry).getByRole("region", { name: "Verb (VERB)" });
    expect(within(verb).getByText("달리다, 뛰다")).toBeTruthy();
    expect(within(verb).getByText("move fast")).toBeTruthy();
    expect(within(verb).getByText("Definitions: Open English WordNet")).toBeTruthy();
    const examples = within(entry).getByRole("region", { name: "Example sentences" });
    expect(within(examples).getByText("우유가 떨어졌다.")).toBeTruthy();
    expect(
      within(examples)
        .getByRole("link", { name: /Tatoeba #2/ })
        .getAttribute("href"),
    ).toBe("https://tatoeba.org/en/sentences/show/2");
  });

  it("lists every headword of an ambiguous form and puts the queried part of speech first", async () => {
    open("q=saw");
    await screen.findByRole("article", { name: "saw" });
    expect(
      screen
        .getAllByRole("article")
        .map((a) => a.getAttribute("aria-labelledby") && a.querySelector("h2")?.textContent),
    ).toEqual(["saw", "see"]);
    cleanup();
    open(`q=run&upos=NOUN`);
    const entry = await screen.findByRole("article", { name: "run" });
    expect(
      within(entry)
        .getAllByRole("heading", { level: 3 })
        .map((x) => x.textContent),
    ).toEqual(["Noun (NOUN)", "Verb (VERB)", "Example sentences"]);
  });

  it("shows the first definitions with “show all” for long entries", async () => {
    const run = ENTRIES.run as { pos: Array<{ senses: unknown[] }> };
    const verb = run.pos[0] as { senses: unknown[] };
    const before = verb.senses;
    verb.senses = Array.from({ length: 8 }, (_, i) => ({ def: `sense ${i + 1}`, examples: [] }));
    h.api = fakeApi();
    h.dict = createDictionaryService(createDictionaryModule({ api: h.api }), async () => null);
    verb.senses = before;
    open("q=run");
    const entry = await screen.findByRole("article", { name: "run" });
    const defs = within(entry).getAllByRole("list", { name: "Definitions" })[0] as HTMLElement;
    expect(within(defs).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(within(entry).getByRole("button", { name: "Show all 8 definitions" }));
    expect(within(defs).getAllByRole("listitem")).toHaveLength(8);
  });

  it("shows word parts and adds an entry to a list", async () => {
    open("q=unhappy");
    expect(await screen.findByText("No dictionary entry for “unhappy”.")).toBeTruthy();
    expect(await screen.findByText("un-")).toBeTruthy();
    cleanup();
    open("q=run");
    const entry = await screen.findByRole("article", { name: "run" });
    fireEvent.click(within(entry).getByRole("button", { name: "Add to list" }));
    expect(await within(entry).findByText("Added “run” to “My words”.")).toBeTruthy();
    const items = h.vocab?.getSnapshot().lists[0]?.items ?? [];
    expect(items[0]).toMatchObject({ word: "run", lemma: "run", upos: "VERB", definitionKo: "달리다, 뛰다" });
  });

  it("explains a network error and links to the offline option", async () => {
    (h.api as FakeApi).offline = true;
    open("q=run");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be loaded/);
    expect(
      within(alert).getByRole("link", { name: "Make the dictionary available offline" }).getAttribute("href"),
    ).toBe("/models");
  });

  it("builds links with the parse's lemma and part of speech", () => {
    expect(dictionaryLink("ran", "run", "VERB")).toBe("/dictionary?q=ran&lemma=run&upos=VERB");
    expect(dictionaryLink("look up")).toBe("/dictionary?q=look+up");
  });
});
