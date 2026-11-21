// @vitest-environment jsdom
/**
 * src/routes.test.tsx — app shell: routing, layout, navigation (T39)
 *
 * Covers: index and unknown paths redirect to #/input, every page renders in the layout,
 * the active link has aria-current, and the skip link focuses the content region.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { languageService } from "./services/languageService";
import { routes } from "./routes";

afterEach(cleanup);
// These tests read English text; the Korean default is covered in Header.test.tsx.
beforeEach(async () => {
  await languageService().setLanguage("en");
});

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

describe("app shell", () => {
  it("redirects the index and unknown paths to the input page", async () => {
    const r = renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Input" })).toBeTruthy();
    expect(r.state.location.pathname).toBe("/input");
    cleanup();
    const r2 = renderAt("/nope");
    await screen.findByRole("heading", { level: 1, name: "Input" });
    expect(r2.state.location.pathname).toBe("/input");
  });

  it.each([
    ["/output", "Output"],
    ["/vocab", "Vocabulary"],
    ["/dictionary", "Dictionary"],
    ["/models", "Models"],
    ["/about", "About & licenses"],
  ])("renders %s inside the layout with the active link marked", async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Pages" });
    const active = nav.querySelector('[aria-current="page"]');
    expect(active?.textContent).toBe(title);
  });

  it("navigates with the sidebar links", async () => {
    const r = renderAt("/input");
    fireEvent.click(await screen.findByRole("link", { name: "Models" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Models" })).toBeTruthy();
    expect(r.state.location.pathname).toBe("/models");
  });

  it("skip link moves focus to the main content", async () => {
    renderAt("/input");
    fireEvent.click(await screen.findByText("Skip to content"));
    expect(document.activeElement?.id).toBe("content");
  });
});
