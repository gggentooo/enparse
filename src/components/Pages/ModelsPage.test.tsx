// @vitest-environment jsdom
/**
 * src/components/Pages/ModelsPage.test.tsx — model library page over a mocked parserService (T54)
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { library as emptyLibrary, mockService } from "../../hooks/testParserService";
import { languageService } from "../../services/languageService";
import type { ParserService } from "../../services/parserService";
import { DEBERTA, MODERNBERT, fit, fixtureLibrary, renderPage } from "../testUtils";
import { ModelsPage } from "./ModelsPage";

const h = vi.hoisted(() => ({ service: null as ParserService | null }));
vi.mock("../../services/parserService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/parserService")>()),
  parserService: () => h.service,
}));

afterEach(cleanup);
beforeEach(async () => {
  await languageService().setLanguage("en");
});

const card = (name: string): HTMLElement => screen.getByRole("listitem", { name });

describe("ModelsPage", () => {
  it("lists models with labels, size, and details; first visit explains the one-time download", () => {
    const m = mockService();
    m.update({ library: fixtureLibrary() });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    expect(screen.getByText(/No model is downloaded yet/)).toBeTruthy();
    const list = screen.getByRole("list", { name: "Parser models" });
    expect(
      within(list)
        .getAllByRole("heading", { level: 2 })
        .map((e) => e.textContent),
    ).toEqual([DEBERTA.display_name, MODERNBERT.display_name]);
    const first = card(DEBERTA.display_name);
    for (const label of ["Recommended for this device", "Most accurate", "Fastest on this device"]) {
      expect(within(first).getByText(label)).toBeTruthy();
    }
    expect(within(first).getByText("Not downloaded · 90 MB")).toBeTruthy();
    expect(within(first).getByText("97%")).toBeTruthy(); // chunk F1 0.9701
    expect(within(first).getByText("0.4 s")).toBeTruthy();
    expect(within(first).getByText(DEBERTA.base_model)).toBeTruthy();
  });

  it("uses or only downloads a model", () => {
    const m = mockService();
    m.update({ library: fixtureLibrary() });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    fireEvent.click(within(card(DEBERTA.display_name)).getByRole("button", { name: "Use this model" }));
    expect(m.service.chooseModel).toHaveBeenCalledWith(DEBERTA.id);
    fireEvent.click(within(card(MODERNBERT.display_name)).getByRole("button", { name: "Download only" }));
    expect(m.service.downloadModel).toHaveBeenCalledWith(MODERNBERT.id);
  });

  it("shows blocked models with reasons and without actions", () => {
    const m = mockService();
    const reasons = [{ id: "model-memory", stage: "model", status: "fail", detail: "below-requirement" }] as const;
    m.update({
      library: fixtureLibrary({
        fitness: [fit(DEBERTA.id), fit(MODERNBERT.id, { verdict: "blocked", variant: null, reasons: [...reasons] })],
      }),
    });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    const blocked = card(MODERNBERT.display_name);
    expect(within(blocked).getByText("Not supported on this device")).toBeTruthy();
    expect(within(blocked).getByText(/Memory for this model: This device may not have enough memory/)).toBeTruthy();
    expect((within(blocked).getByRole("button", { name: "Use this model" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(blocked).queryByRole("button", { name: "Download only" })).toBeNull();
  });

  it("shows download progress with cancel, and deletes the active model after confirmation", async () => {
    const m = mockService({ state: "ready", modelId: DEBERTA.id, backend: "wasm", modelVersion: "1" });
    m.update({
      library: fixtureLibrary({
        activeId: DEBERTA.id,
        states: {
          [DEBERTA.id]: { state: "downloaded", bytesOnDisk: 90_000_000, variant: "int8" },
          [MODERNBERT.id]: { state: "downloading", bytesDone: 50_000_000, bytesTotal: 150_000_000, variant: "int8" },
        },
      }),
    });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    expect(screen.queryByText(/No model is downloaded yet/)).toBeNull();

    const loading = card(MODERNBERT.display_name);
    expect(within(loading).getByText("Downloading: 50 MB of 150 MB")).toBeTruthy();
    const bar = within(loading).getByRole("progressbar", { name: `Download progress of ${MODERNBERT.display_name}` });
    expect(bar.getAttribute("value")).toBe("33");
    fireEvent.click(within(loading).getByRole("button", { name: "Cancel download" }));
    expect(m.service.cancelDownload).toHaveBeenCalledWith(MODERNBERT.id);

    const active = card(DEBERTA.display_name);
    expect(within(active).getByText("In use")).toBeTruthy();
    expect(within(active).queryByRole("button", { name: "Use this model" })).toBeNull();
    fireEvent.click(within(active).getByRole("button", { name: `Delete ${DEBERTA.display_name}` }));
    const dialog = await screen.findByRole("dialog", { name: `Delete ${DEBERTA.display_name}?` });
    expect(within(dialog).getByText(/parsing stops/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(m.service.deleteModel).toHaveBeenCalledWith(DEBERTA.id);
  });

  it("shows the catalog failure without cards", () => {
    const m = mockService({ state: "failed", modelId: null, reason: "network", message: "offline" });
    m.update({ library: emptyLibrary });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    expect(screen.getByRole("alert").textContent).toMatch(/could not be downloaded/);
    expect(screen.queryByRole("list", { name: "Parser models" })).toBeNull();
  });
});
