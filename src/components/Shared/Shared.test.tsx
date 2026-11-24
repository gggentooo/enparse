// @vitest-environment jsdom
/**
 * src/components/Shared/Shared.test.tsx — shared components (T39)
 *
 * Covers: Button (default type, loading = disabled + aria-busy), LoadingSpinner (status
 * label, determinate progress), Modal (title, Escape/cancel and Close call onClose),
 * Tooltip (toggle, Escape, outside click), ScrollToTop (T107).
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { languageService } from "../../services/languageService";
import { Button } from "./Button";
import { LoadingSpinner } from "./LoadingSpinner";
import { Modal } from "./Modal";
import { ScrollToTop } from "./ScrollToTop";
import { Tooltip } from "./Tooltip";

afterEach(cleanup);
// These tests read English text; the Korean default is covered in Header.test.tsx.
beforeEach(async () => {
  await languageService().setLanguage("en");
});

describe("Button", () => {
  it("defaults to type=button and is disabled and busy while loading", () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button onClick={onClick} isLoading>
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(b.type).toBe("button");
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("LoadingSpinner", () => {
  it("announces an indeterminate status and renders determinate progress", () => {
    render(<LoadingSpinner label="Loading model" />);
    expect(screen.getByRole("status").textContent).toContain("Loading model");
    cleanup();
    render(<LoadingSpinner label="Downloading" progress={0.42} />);
    const bar = screen.getByRole("progressbar", { name: "Downloading" }) as HTMLProgressElement;
    expect(bar.value).toBe(42);
  });
});

describe("Modal", () => {
  it("shows its title and calls onClose from Escape (cancel) and the Close button", () => {
    const onClose = vi.fn<() => void>();
    render(
      <Modal open title="Diagnostics" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Diagnostics" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("tall variant: title, toolbar, and Close in the top bar; the body in a scrollable region (T104)", () => {
    const onClose = vi.fn<() => void>();
    render(
      <Modal open variant="tall" title="Words" onClose={onClose} toolbar={<select aria-label="Sort" />}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Words" });
    const region = within(dialog).getByRole("region", { name: "Words" });
    expect(within(region).getByText("Body")).toBeTruthy();
    expect(within(region).queryByRole("button")).toBeNull();
    expect(region.tabIndex).toBe(0);
    expect(within(dialog).getByRole("combobox", { name: "Sort" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Tooltip", () => {
  it("toggles on click and closes on Escape and outside click", () => {
    render(
      <div>
        <Tooltip label="Look up dog" content="a domestic animal">
          dog
        </Tooltip>
        <p>outside</p>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Look up dog" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog").textContent).toBe("a domestic animal");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ScrollToTop (T107)", () => {
  it("scrolls to the top (no animation with reduced motion) and focuses the main content", () => {
    const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList);
    render(
      <>
        <main id="content" tabIndex={-1}>
          page
        </main>
        <ScrollToTop />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to top" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(document.activeElement?.id).toBe("content");
    vi.unstubAllGlobals();
  });
});
