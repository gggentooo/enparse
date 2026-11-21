// @vitest-environment jsdom
/**
 * src/components/Layout/Header.test.tsx — Korean default and the language menu (T68)
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../../routes";
import { languageService } from "../../services/languageService";

afterEach(async () => {
  cleanup();
  await languageService().setLanguage("ko");
});

describe("Header language menu", () => {
  it("shows Korean by default and switches the whole UI to English", async () => {
    await languageService().setLanguage("ko");
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/input"] })} />);
    expect(await screen.findByRole("heading", { level: 1, name: "입력" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "단어장" })).toBeTruthy();
    const menu = screen.getByLabelText("언어") as HTMLSelectElement;
    expect(menu.value).toBe("ko");
    fireEvent.change(menu, { target: { value: "en" } });
    expect(await screen.findByRole("heading", { level: 1, name: "Input" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vocabulary" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe("en");
  });
});
