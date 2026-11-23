// @vitest-environment jsdom
/**
 * src/components/Pages/AboutPage.test.tsx — About & licenses page (T50)
 *
 * Covers: sections, model and library licenses, external links open safely in a new tab,
 * and the training-data attribution is identical to training/MODEL_CARD.md (required by the
 * model card and CC BY-SA 4.0 §3(a)).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockService } from "../../hooks/testParserService";
import { languageService } from "../../services/languageService";
import type { ParserService } from "../../services/parserService";
import { fixtureLibrary } from "../testUtils";
import { AboutPage, EWT_ATTRIBUTION, REQUIRED_NOTICE } from "./AboutPage";

const h = vi.hoisted(() => ({ service: null as ParserService | null }));
vi.mock("../../services/parserService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/parserService")>()),
  parserService: () => h.service,
}));

afterEach(cleanup);
// These tests read English text; the Korean default is covered in Header.test.tsx.
beforeEach(async () => {
  await languageService().setLanguage("en");
  h.service = mockService().service; // no catalog loaded: the static model credits
});

describe("AboutPage", () => {
  it("shows app, models, data, libraries, and dictionary sections with licenses", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: "About & licenses" })).toBeTruthy();
    for (const name of ["Enparse", "Parser models", "Training data", "Word lists", "Libraries", "Dictionary sources"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    const models = screen.getByRole("region", { name: "Parser models" });
    expect(within(models).getAllByText(/CC BY-SA 4.0 \(trained\)/)).toHaveLength(2);
    expect(screen.getByText(EWT_ATTRIBUTION)).toBeTruthy();
    expect(screen.getByText(/^Required Notice: Copyright Hankyung Lee/)).toBeTruthy();
  });

  it("credits the models from the catalog once it has loaded: base model, its license, and the trained files' (T66)", () => {
    const m = mockService();
    m.update({ library: fixtureLibrary() });
    h.service = m.service;
    render(<AboutPage />);
    const models = screen.getByRole("region", { name: "Parser models" });
    const items = within(models).getAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("link").textContent)).toEqual([
      "answerdotai/ModernBERT-base (opens in a new tab)",
      "microsoft/deberta-v3-xsmall (opens in a new tab)",
    ]);
    expect(
      within(models)
        .getByRole("link", { name: /ModernBERT-base/ })
        .getAttribute("href"),
    ).toBe("https://huggingface.co/answerdotai/ModernBERT-base");
    expect(
      within(models).getByText(
        "Large model. Fine-tuned from answerdotai/ModernBERT-base (Apache 2.0). Trained model files: CC BY-SA 4.0.",
      ),
    ).toBeTruthy();
    expect(within(models).getByText("License: MIT (base) · CC BY-SA 4.0 (trained)")).toBeTruthy();
  });

  it("credits the dictionary sources and states the dictionary data license (T70)", () => {
    render(<AboutPage />);
    const section = screen.getByRole("heading", { name: "Dictionary sources" }).closest("section") as HTMLElement;
    for (const name of ["Open English WordNet 2025", "English Wiktionary (kaikki.org extract)", "Tatoeba"]) {
      expect(within(section).getByRole("link", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })).toBeTruthy();
    }
    for (const license of ["CC BY 4.0", "CC BY 2.0 FR"])
      expect(within(section).getByText(`License: ${license}`)).toBeTruthy();
    expect(within(section).getByText(/shared under/)).toBeTruthy();
  });

  it("opens external links in a new tab without opener or referrer", () => {
    render(<AboutPage />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(5);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("shows the same Required Notice as LICENSE.md", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const license = readFileSync(resolve(here, "../../../LICENSE.md"), "utf8");
    const notice = /^Required Notice: .*$/m.exec(license)?.[0];
    expect(notice).toBe(REQUIRED_NOTICE);
    render(<AboutPage />);
    expect(screen.getByText(REQUIRED_NOTICE)).toBeTruthy();
  });

  it("uses the same attribution text as training/MODEL_CARD.md", () => {
    // jsdom replaces the URL class, so resolve the path with node:path from this file's location.
    const here = dirname(fileURLToPath(import.meta.url));
    const card = readFileSync(resolve(here, "../../../training/MODEL_CARD.md"), "utf8");
    const quoted = /^> (This model was trained.*)$/m.exec(card)?.[1];
    expect(quoted).toBe(EWT_ATTRIBUTION);
  });
});
