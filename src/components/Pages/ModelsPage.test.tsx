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
import { createDictionaryModule } from "../../modules/dictionary";
import { type FakeApi, fakeApi } from "../../modules/dictionary/testDictionary";
import { type DictionaryService, createDictionaryService } from "../../services/dictionaryService";

const h = vi.hoisted(() => ({
  service: null as ParserService | null,
  dict: null as DictionaryService | null,
  api: null as FakeApi | null,
  free: null as number | null,
}));
vi.mock("../../services/parserService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/parserService")>()),
  parserService: () => h.service,
}));
vi.mock("../../services/dictionaryService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/dictionaryService")>()),
  dictionaryService: () => h.dict,
}));

afterEach(cleanup);
beforeEach(async () => {
  await languageService().setLanguage("en");
  h.api = fakeApi();
  h.free = 10 * 1024 ** 3;
  h.dict = createDictionaryService(createDictionaryModule({ api: h.api }), async () =>
    h.free === null ? null : { quotaBytes: h.free, usageBytes: 0 },
  );
  h.service = mockService().service;
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
    ).toEqual(["Large", "Compact"]);
    const first = card("Large");
    for (const label of ["Recommended for this device", "Default"]) {
      expect(within(first).getByText(label)).toBeTruthy();
    }
    expect(within(first).getByText(/^Larger download\. The default model/)).toBeTruthy();
    expect(within(first).getByText(MODERNBERT.base_model)).toBeTruthy();
    const compact = card("Compact");
    expect(within(compact).getByText("Fastest on this device")).toBeTruthy();
    expect(within(compact).getByText("Not downloaded · 90 MB")).toBeTruthy();
    expect(within(compact).getByText("97%")).toBeTruthy(); // chunk F1 0.9701
    expect(within(compact).getByText("0.4 s")).toBeTruthy();
  });

  it("shows the description in the interface language (Korean)", async () => {
    await languageService().setLanguage("ko");
    const m = mockService();
    m.update({ library: fixtureLibrary() });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    const compact = card("Compact");
    expect(
      within(compact)
        .getByText(/Large가 잘 동작하지 않을 때/)
        .getAttribute("lang"),
    ).toBe("ko");
    expect(within(card("Large")).getByText("기본 모델")).toBeTruthy();
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
    const reasons = [{ id: "model-variant", stage: "model", status: "fail", detail: "needs-webgpu-fp16" }] as const;
    m.update({
      library: fixtureLibrary({
        fitness: [fit(DEBERTA.id), fit(MODERNBERT.id, { verdict: "blocked", variant: null, reasons: [...reasons] })],
      }),
    });
    h.service = m.service;
    renderPage(<ModelsPage />, "/models");
    const blocked = card(MODERNBERT.display_name);
    expect(within(blocked).getByText("Not supported on this device")).toBeTruthy();
    expect(
      within(blocked).getByText(/Model format for this device: This model has no format this device can run/),
    ).toBeTruthy();
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

describe("Dictionary offline (T72)", () => {
  const box = (): HTMLElement => screen.getByRole("region", { name: "Dictionary offline" });

  it("downloads the whole dictionary with its size, then offers to delete it (confirmed)", async () => {
    renderPage(<ModelsPage />, "/models");
    expect(await within(box()).findByText(/Not stored on this device/)).toBeTruthy();
    fireEvent.click(within(box()).getByRole("button", { name: /Make dictionary available offline \(.+\)/ }));
    expect(await within(box()).findByText(/Available offline/)).toBeTruthy();
    expect(within(box()).queryByRole("button", { name: /Make dictionary available offline/ })).toBeNull();
    fireEvent.click(within(box()).getByRole("button", { name: "Delete offline dictionary" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the offline dictionary?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(box()).findByText(/Not stored on this device/)).toBeTruthy();
  });

  it("shows partly stored data after lookups", async () => {
    await h.dict?.lookupWord({ word: "run" });
    renderPage(<ModelsPage />, "/models");
    expect(await within(box()).findByText(/Partly stored/)).toBeTruthy();
    expect(within(box()).getByRole("button", { name: "Delete offline dictionary" })).toBeTruthy();
  });

  it("blocks the download when it cannot fit and warns when storage is tight (T24)", async () => {
    h.free = 10;
    renderPage(<ModelsPage />, "/models");
    expect(await within(box()).findByText(/Not enough storage/)).toBeTruthy();
    const button = within(box()).getByRole("button", {
      name: /Make dictionary available offline/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    cleanup();
    h.free = 200 * 1024 ** 2; // fits, but less than the 256 MiB margin left
    renderPage(<ModelsPage />, "/models");
    expect(await within(box()).findByText(/Storage is tight/)).toBeTruthy();
  });

  it("explains a failed download", async () => {
    (h.api as FakeApi).full = true;
    renderPage(<ModelsPage />, "/models");
    fireEvent.click(await within(box()).findByRole("button", { name: /Make dictionary available offline/ }));
    expect((await within(box()).findByRole("alert")).textContent).toMatch(/not enough storage/);
  });
});
