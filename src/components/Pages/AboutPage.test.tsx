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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { languageService } from "../../services/languageService";
import { AboutPage, EWT_ATTRIBUTION, REQUIRED_NOTICE } from "./AboutPage";

afterEach(cleanup);
// These tests read English text; the Korean default is covered in Header.test.tsx.
beforeEach(async () => {
  await languageService().setLanguage("en");
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
