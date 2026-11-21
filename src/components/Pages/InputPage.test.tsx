// @vitest-environment jsdom
/**
 * src/components/Pages/InputPage.test.tsx — input page over a mocked parserService (T56)
 */

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockService } from "../../hooks/testParserService";
import { MAX_INPUT_CHARS, type ParseOutcome, type ParserService } from "../../services/parserService";
import { languageService } from "../../services/languageService";
import { renderPage } from "../testUtils";
import { InputPage } from "./InputPage";

const h = vi.hoisted(() => ({ service: null as ParserService | null }));
vi.mock("../../services/parserService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/parserService")>()),
  parserService: () => h.service,
}));

afterEach(cleanup);
beforeEach(async () => {
  await languageService().setLanguage("en");
});

const READY = { state: "ready", modelId: "m", backend: "wasm", modelVersion: "1" } as const;
const textbox = (): HTMLTextAreaElement => screen.getByLabelText("English text");
const parseButton = (): HTMLButtonElement => screen.getByRole("button", { name: "Parse" });

describe("InputPage", () => {
  it("keeps Parse disabled until the model is ready and explains why", () => {
    const m = mockService({ state: "no-model" });
    h.service = m.service;
    m.update({ draft: "The cat sat." });
    renderPage(<InputPage />, "/input");
    expect(textbox().value).toBe("The cat sat.");
    expect(parseButton().disabled).toBe(true);
    expect(screen.getByText(/No parser model is ready/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Choose a model" }).getAttribute("href")).toBe("/models");
  });

  it("stores typing in the service draft, counts characters, and parses then shows the output", async () => {
    const m = mockService(READY);
    h.service = m.service;
    vi.mocked(m.service.parseText).mockResolvedValueOnce({} as ParseOutcome);
    const router = renderPage(<InputPage />, "/input");
    fireEvent.change(textbox(), { target: { value: "Hi 😀." } });
    expect(m.service.setDraft).toHaveBeenCalledWith("Hi 😀.");
    expect(screen.getByText(`5 / ${MAX_INPUT_CHARS.toLocaleString("en")} characters`)).toBeTruthy();
    fireEvent.click(parseButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/output"));
    expect(m.service.parseText).toHaveBeenCalledWith("Hi 😀.");
  });

  it("blocks text over the limit with the count", () => {
    const m = mockService(READY);
    h.service = m.service;
    m.update({ draft: "a".repeat(MAX_INPUT_CHARS + 1) });
    renderPage(<InputPage />, "/input");
    expect(screen.getByRole("alert").textContent).toMatch(/5,001 characters long; the limit is 5,000/);
    expect(parseButton().disabled).toBe(true);
    expect(textbox().getAttribute("aria-invalid")).toBe("true");
  });

  it("shows parse errors and stays on the page", async () => {
    const m = mockService(READY);
    h.service = m.service;
    m.update({ draft: "x" });
    vi.mocked(m.service.parseText).mockRejectedValueOnce(new Error("worker crashed"));
    const router = renderPage(<InputPage />, "/input");
    fireEvent.click(parseButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Parsing failed: worker crashed");
    expect(router.state.location.pathname).toBe("/input");
  });

  it("accepts dropped .txt files and rejects other files", async () => {
    const m = mockService(READY);
    h.service = m.service;
    renderPage(<InputPage />, "/input");
    const drop = (file: File): void => {
      fireEvent.drop(textbox(), { dataTransfer: { files: [file], types: ["Files"] } });
    };
    drop(new File(["x"], "photo.png", { type: "image/png" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Only plain-text files/);
    drop(new File(["Dropped text."], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(m.service.setDraft).toHaveBeenCalledWith("Dropped text."));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("on failure offers Retry and the diagnostics", async () => {
    const m = mockService({ state: "failed", modelId: "m", reason: "network", message: "x" });
    h.service = m.service;
    renderPage(<InputPage />, "/input");
    expect(screen.getByText(/could not be downloaded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(m.service.retryLoad).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog", { name: "Parser diagnostics" });
    expect(within(dialog).getByText("Browser and device")).toBeTruthy();
  });
});
