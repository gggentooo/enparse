/**
 * e2e/release.spec.ts — every packaged model in the production build (Phase 11, T66)
 *
 * Description:
 *   Runs only with E2E_TARGET=release (`npm run test:e2e:release`): the built
 *   app in `vite preview --mode release`, with /models and /dict served by the
 *   Pages Functions from the release files (vite.release.ts). For each model in
 *   public/models/catalog.json, in catalog order: the model library downloads
 *   and verifies it (bytes and SHA-256 per file), the worker loads it, a parse
 *   reports the model and its model_version, and choosing the next model
 *   replaces it (the worker unloads the previous model first). The per-model
 *   check against the Phase 9 outputs runs in Node
 *   (src/modules/parser/packagedModels.test.ts).
 *
 * Status: implemented (T66).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";

type Entry = { id: string; display_name: string; model_version: string };
const RELEASE = process.env.E2E_TARGET === "release";
const CATALOG = new URL("../public/models/catalog.json", import.meta.url);
const models: Entry[] = RELEASE ? (JSON.parse(readFileSync(CATALOG, "utf8")) as { models: Entry[] }).models : [];

test.skip(!RELEASE, "release target only (npm run test:e2e:release)");

test("downloads, verifies, loads, and parses with every packaged model, switching between them", async ({
  baseURL,
}) => {
  // A persistent profile: a fresh test context has private-window storage quota, too small for the
  // 302 MB fp16 file (the app then shows its storage warning, as for a private window).
  const profile = mkdtempSync(join(tmpdir(), "enparse-release-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "chrome", baseURL });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/#/models");
  await page.getByLabel("언어").selectOption("en");
  for (const m of models) {
    await page.getByRole("link", { name: "Models" }).first().click();
    await page.getByRole("listitem", { name: m.display_name }).getByRole("button", { name: "Use this model" }).click();
    await expect(page.getByText(`Ready: ${m.display_name}`).first()).toBeVisible();

    await page.getByRole("link", { name: "Input" }).click();
    await page.getByLabel("English text").fill("Water in these disks could be found as water vapor or ice.");
    await page.getByRole("button", { name: "Parse", exact: true }).click();
    await expect(page).toHaveURL(/#\/output/);
    await expect(page.getByText(new RegExp(`^Parsed with ${m.display_name} \\(${m.model_version}, `))).toBeVisible();
    const sentence = page.getByRole("article", { name: "Sentence 1" });
    await expect(sentence.getByRole("group", { name: /subject/i }).first()).toContainText("Water");
  }
  await context.close();
  rmSync(profile, { recursive: true, force: true });
});
