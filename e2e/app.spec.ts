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
