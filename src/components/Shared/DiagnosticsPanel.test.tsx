// @vitest-environment jsdom
/**
 * src/components/Shared/DiagnosticsPanel.test.tsx — diagnostics and the header status badge (T55)
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockService } from "../../hooks/testParserService";
import { languageService } from "../../services/languageService";
import type { ParserService, PreflightReport } from "../../services/parserService";
import { Header } from "../Layout/Header";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

const h = vi.hoisted(() => ({ service: null as ParserService | null }));
vi.mock("../../services/parserService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/parserService")>()),
  parserService: () => h.service,
}));

afterEach(cleanup);
beforeEach(async () => {
  await languageService().setLanguage("en");
});

const device: PreflightReport = {
  verdict: "warn",
  startedAt: 0,
  finishedAt: 0,
  backendHint: "wasm",
  checks: [
    { id: "wasm", stage: "device", status: "pass", detail: "ok" },
    {
      id: "storage-quota",
      stage: "device",
      status: "warn",
      detail: "low",
      measured: 50_000_000,
      required: 200_000_000,
    },
    { id: "memory-hint", stage: "device", status: "skip", detail: "not-exposed" },
    { id: "wasm-threads", stage: "device", status: "warn", detail: "not-isolated" },
  ],
};

const show = (ui: React.JSX.Element): void => {
  render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe("DiagnosticsPanel", () => {
  it("lists device checks with warnings first, status as text, hints, and formatted values", () => {
    const m = mockService({ state: "ready", modelId: "m", backend: "wasm", modelVersion: "1" });
    m.update({ preflight: device });
    h.service = m.service;
    show(<DiagnosticsPanel />);
    expect(screen.getByText("The parser can run, with the warnings below.")).toBeTruthy();
    expect(screen.getByText("Runs on: WASM")).toBeTruthy();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("span:nth-child(2)")?.textContent)).toEqual([
      "Storage space",
      "WebAssembly threads",
      "WebAssembly",
      "Device memory",
    ]);
    expect(within(rows[0] as HTMLElement).getByText("Warning")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/Free some storage space/)).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("Measured: 50 MB · Required: 200 MB")).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText("Not checked")).toBeTruthy();
    expect(screen.getByText("Not checked yet.")).toBeTruthy(); // model stage
  });

  it("offers Retry when loading failed", () => {
    const m = mockService({ state: "failed", modelId: "m", reason: "out-of-memory", message: "oom" });
    h.service = m.service;
    show(<DiagnosticsPanel />);
    expect(screen.getByRole("alert").textContent).toMatch(/needs more memory/);
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(m.service.retryLoad).toHaveBeenCalled();
  });

  it("is opened from the header status badge", async () => {
    const m = mockService({ state: "failed", modelId: null, reason: "unsupported", message: "x" });
    h.service = m.service;
    show(<Header />);
    const badge = screen.getByRole("button", { name: "Parser status: Problem. Show details" });
    fireEvent.click(badge);
    const dialog = await screen.findByRole("dialog", { name: "Parser diagnostics" });
    expect(within(dialog).getByText(/cannot run the parser/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
