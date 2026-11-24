/**
 * e2e/app.spec.ts — the main learning flow, end to end (T62)
 *
 * Description:
 *   Choose a model (download, checks, load) → paste text → parse → see the
 *   phrase chunks and the structure view → select a word → its dictionary
 *   summary → the dictionary page → add the word to a list → export the lists
 *   as JSON. Runs against the e2e stand-ins (fake backend, test dictionary;
 *   CI) or, with E2E_TARGET=models, the real models and dictionary
 *   (playwright.config.ts). The interface is switched to English for stable
 *   selectors.
 *
 * Status: implemented (T62).
 */

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const REAL = process.env.E2E_TARGET === "models" || process.env.E2E_TARGET === "release";
/** Model to choose: the e2e stand-in, or the real Compact model (int8 runs everywhere). */
const MODEL = REAL ? "Compact" : "E2E";
const TEXT = "The little dog runs fast. It barks loudly.";

test("paste text → chunks → look up a word → add to vocabulary → export", async ({ page }) => {
  // English interface, then choose the model: download, checks, load.
  await page.goto("/#/models");
  await page.getByLabel("언어").selectOption("en");
  await page.getByRole("listitem", { name: MODEL }).getByRole("button", { name: "Use this model" }).click();
  await expect(page.getByText(`Ready: ${MODEL}`).first()).toBeVisible();

  // Paste and parse.
  await page.getByRole("link", { name: "Input" }).click();
  await page.getByLabel("English text").fill(TEXT);
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page).toHaveURL(/#\/output/);

  // Structure view by default (T88): subject and predicate of the first sentence.
  const first = page.getByRole("article", { name: "Sentence 1" });
  await expect(first.getByRole("group", { name: /Subject/ }).first()).toContainText("dog");
  await expect(first.getByRole("group", { name: /Predicate/ }).first()).toContainText("runs");

  // Phrase (flat) view: color-coded chunks with their type.
  await page.getByRole("radio", { name: "Phrases (flat)" }).check();
  await expect(first.getByRole("group", { name: "Noun phrase (NP)" }).first()).toContainText("The little dog");
  await expect(first.getByRole("group", { name: "Verb phrase (VP)" }).first()).toContainText("runs");

  // Select a word: details with its dictionary summary (lemma "run" → 달리다).
  await first.getByRole("button", { name: /^runs\b/ }).click();
  const panel = page.getByRole("complementary", { name: "Selected word: runs" });
  await expect(panel.getByText("Verb (VERB)").first()).toBeVisible();
  const summary = panel.getByRole("region", { name: "Dictionary" });
  await expect(summary.getByText(/달리다/).first()).toBeVisible();

  // Add the word to a (new) list from the panel.
  await panel.getByRole("button", { name: "Add to list" }).click();
  await expect(panel.getByText("Added “runs” to “My words”.")).toBeVisible();

  // The dictionary page for the word (T25: popup → more).
  await summary.getByRole("link", { name: "More in the dictionary" }).click();
  await expect(page).toHaveURL(/#\/dictionary\?q=runs/);
  const entry = page.getByRole("article", { name: "run" });
  await expect(entry.getByText("“runs” → base form: run")).toBeVisible();
  await expect(entry.getByText(/달리다/).first()).toBeVisible();

  // Vocabulary: the word is in the list; export it as JSON.
  await page.getByRole("link", { name: "Vocabulary" }).click();
  await expect(page.getByRole("rowheader", { name: "runs" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^enparse-vocab-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile((await file.path()) as string, "utf8")) as unknown;
  expect(JSON.stringify(exported)).toContain('"word":"runs"');
  expect(JSON.stringify(exported)).toContain('"lemma":"run"');
});

test("share a parsed result: a short sentence as a link, anything else as a file; opened without a model (T99)", async ({
  page,
  browser,
}) => {
  await page.goto("/#/models");
  await page.getByLabel("언어").selectOption("en");
  await page.getByRole("listitem", { name: MODEL }).getByRole("button", { name: "Use this model" }).click();
  await expect(page.getByText(`Ready: ${MODEL}`).first()).toBeVisible();
  const parse = async (text: string): Promise<void> => {
    await page.getByRole("link", { name: "Input" }).click();
    await page.getByLabel("English text").fill(text);
    await page.getByRole("button", { name: "Parse", exact: true }).click();
    await expect(page.getByRole("article", { name: "Sentence 1" })).toBeVisible();
  };
  // No request may carry a result anywhere: only GET and HEAD leave the page.
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(`${r.method()} ${r.url()}`);
  });

  // One short sentence → a link.
  await parse("The little dog runs fast.");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  expect(link).toMatch(/#\/output\?s=[A-Za-z0-9_-]+$/);

  // Two sentences → a file.
  await parse(TEXT);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^enparse-share-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByRole("textbox", { name: "Share link" })).toHaveCount(0);
  expect(writes).toEqual([]);

  // Someone else: a fresh browser profile with no model downloaded.
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(link);
  await other.getByLabel("언어").selectOption("en");
  const shared = other.getByRole("article", { name: "Sentence 1" });
  await expect(shared.getByRole("group", { name: /Subject/ }).first()).toContainText("dog");
  await expect(other.getByRole("article", { name: "Sentence 2" })).toHaveCount(0);
  await expect(other.getByRole("status").filter({ hasText: "Shared result" })).toBeVisible();

  await other.goto("/#/input");
  await other.getByLabel("Open a shared file").setInputFiles((await file.path()) as string);
  await expect(other).toHaveURL(/#\/output$/);
  await expect(
    other
      .getByRole("article", { name: "Sentence 2" })
      .getByRole("group", { name: /Predicate/ })
      .first(),
  ).toContainText("barks");
  await context.close();
});

test("vocabulary statistics and a vocabulary list from the text (T105, T106)", async ({ page }) => {
  await page.goto("/#/models");
  await page.getByLabel("언어").selectOption("en");
  await page.getByRole("listitem", { name: MODEL }).getByRole("button", { name: "Use this model" }).click();
  await expect(page.getByText(`Ready: ${MODEL}`).first()).toBeVisible();
  await page.getByRole("link", { name: "Input" }).click();
  await page.getByLabel("English text").fill(`${TEXT} The dog runs again.`);
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.getByRole("article", { name: "Sentence 1" })).toBeVisible();

  // Statistics: every word once with its uses and Korean meaning; the top bar stays while the table scrolls.
  await page.setViewportSize({ width: 390, height: 420 });
  await page.getByRole("button", { name: "Vocabulary statistics" }).click();
  const stats = page.getByRole("dialog", { name: "Vocabulary statistics" });
  const run = stats.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "run", exact: true }) });
  await expect(run.getByRole("cell").nth(1)).toHaveText(/달리다/);
  await expect(run.getByRole("cell").nth(2)).toHaveText("2");
  await expect(stats.getByRole("rowheader", { name: "dog", exact: true })).toHaveCount(1);
  await stats.getByLabel("Sort by").selectOption("alpha");
  await expect(stats.getByRole("rowheader").first()).toHaveText("again");
  const bar = stats.getByRole("button", { name: "Close" });
  const before = await bar.boundingBox();
  const region = stats.getByRole("region", { name: "Vocabulary statistics" });
  const scrolled = await region.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop > 0;
  });
  expect(scrolled).toBe(true);
  expect(await bar.boundingBox()).toEqual(before);
  const box = await stats.boundingBox();
  expect(box?.height).toBe(420);
  await bar.click();
  await page.setViewportSize({ width: 1280, height: 800 });

  // A list of every word once, with meanings from the dictionary.
  await page.getByRole("button", { name: "Create a vocabulary list from this text" }).click();
  const create = page.getByRole("dialog", { name: "New vocabulary list from this text" });
  await create.getByLabel("List title").fill("Dog text");
  await create.getByRole("button", { name: "Create list" }).click();
  await expect(create.getByText(/^Created “Dog text” with \d+ words\.$/)).toBeVisible();
  await create.getByRole("link", { name: "Open the list" }).click();
  await expect(page).toHaveURL(/#\/vocab\?list=/);
  await expect(page.getByRole("heading", { level: 2, name: "Dog text" })).toBeVisible();
  const item = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "run", exact: true }) });
  await expect(item).toContainText("달리다");
});

test("head hint and the floating back-to-top button (T107)", async ({ page }) => {
  await page.goto("/#/models");
  await page.getByLabel("언어").selectOption("en");
  await page.getByRole("listitem", { name: MODEL }).getByRole("button", { name: "Use this model" }).click();
  await expect(page.getByText(`Ready: ${MODEL}`).first()).toBeVisible();
  await page.getByRole("link", { name: "Input" }).click();
  await page.getByLabel("English text").fill(Array.from({ length: 12 }, () => TEXT).join("\n\n"));
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.getByText("Words marked in bold are the head of the phrase they belong to.")).toBeVisible();

  // Always in the bottom right corner of the viewport, also after scrolling.
  await page.setViewportSize({ width: 1280, height: 700 });
  const toTop = page.getByRole("button", { name: "Back to top" });
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const box = await toTop.boundingBox();
  expect(box && 1280 - (box.x + box.width)).toBeLessThan(40);
  expect(box && 700 - (box.y + box.height)).toBeLessThan(40);
  await toTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("#content")).toBeFocused();
});
