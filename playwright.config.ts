/**
 * playwright.config.ts — end-to-end tests (T62)
 *
 * Description:
 *   Runs e2e/*.spec.ts in the system Chrome (channel "chrome"; owner,
 *   2026-11-23: GitHub's Ubuntu runners have it, so no browser download)
 *   against a Vite dev server started here:
 *     npm run test:e2e         → `vite --mode e2e` (fake model backend, e2e
 *                                catalog, test dictionary; vite.e2e.ts). CI.
 *     npm run test:e2e:models  → `vite --mode local-models` (the trained models
 *                                and the built dictionary on this machine;
 *                                vite.localModels.ts). Local only.
 *     npm run test:e2e:release → the production build in `vite preview --mode
 *                                release` (the packaged public/models/, ONNX
 *                                Runtime, and dictionary through the Pages
 *                                Functions; vite.release.ts). Local only, before
 *                                uploading a release (T66).
 *   The target is chosen with E2E_TARGET (fake | models | release). Each test starts in a
 *   fresh browser context (empty Cache Storage and IndexedDB), so it downloads
 *   the model and creates its own lists.
 *
 * Dependencies: @playwright/test (dev); Google Chrome installed.
 * Status: implemented (T62).
 */

import { defineConfig } from "@playwright/test";

type Target = "fake" | "models" | "release";
const target: Target =
  process.env.E2E_TARGET === "models" || process.env.E2E_TARGET === "release" ? process.env.E2E_TARGET : "fake";
const PORT = { fake: 5180, models: 5181, release: 5182 }[target];
const SERVER: Record<Target, string> = {
  fake: `npx vite --mode e2e --port ${PORT} --strictPort`,
  models: `npx vite --mode local-models --port ${PORT} --strictPort`,
  // The production build behind the Pages Functions, R2 from disk (vite.release.ts).
  release: `npx vite build && npx vite preview --mode release --port ${PORT} --strictPort`,
};
const real = target !== "fake";

export default defineConfig({
  testDir: "e2e",
  timeout: real ? 600_000 : 60_000,
  expect: { timeout: real ? 180_000 : 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: SERVER[target],
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
