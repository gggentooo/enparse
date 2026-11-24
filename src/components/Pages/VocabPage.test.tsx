// @vitest-environment jsdom
/**
 * src/components/Pages/VocabPage.test.tsx — vocabulary page over a real vocabService with in-memory IndexedDB (T48)
 *
 * Covers: empty state, create/select lists, add/edit/move/remove words (removal confirmed), rename and delete a
 * list (confirmed), JSON export download, import with a name conflict, and error display.
 */

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "../../core/storage";
import { VocabManager } from "../../modules/vocab";
import { languageService } from "../../services/languageService";
import { type VocabService, createVocabService } from "../../services/vocabService";
import { renderPage } from "../testUtils";
import { VocabPage } from "./VocabPage";
import { exportFileName } from "./VocabTransfer";

const h = vi.hoisted(() => ({ service: null as VocabService | null }));
vi.mock("../../services/vocabService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/vocabService")>();
  return { ...actual, vocabService: () => h.service };
});

afterEach(cleanup);
beforeEach(async () => {
  localStorage.clear();
  h.service = createVocabService(new VocabManager({ storage: createStorage({ indexedDB: new IDBFactory() }) }));
  await languageService().setLanguage("en");
});

const type = (label: string, value: string, scope: HTMLElement = document.body): void => {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
};
const click = (name: string | RegExp, scope: HTMLElement = document.body): void => {
  fireEvent.click(within(scope).getByRole("button", { name }));
};
const dialog = (name: string | RegExp): Promise<HTMLElement> => screen.findByRole("dialog", { name });

async function createList(name: string): Promise<void> {
  type("New list name", name);
  click("Create list");
  await screen.findByRole("heading", { level: 2, name });
}

describe("VocabPage", () => {
  it("creates lists and adds, edits, moves, and removes words", async () => {
    renderPage(<VocabPage />, "/vocab");
    expect(await screen.findByText(/No lists yet/)).toBeTruthy();
    await createList("Week 1");
    expect(screen.getByText(/This list has no words yet/)).toBeTruthy();

    const add = screen.getByRole("form", { name: "Add word" });
    type("Word", "run", add);
    type("Korean meaning", "달리다", add);
    type("Tags (comma-separated)", "verb, a1", add);
    click("Add word", add);
    const table = await screen.findByRole("table", { name: "Words in “Week 1”" });
    expect(within(table).getByRole("rowheader", { name: "run" })).toBeTruthy();
    expect(within(table).getByText("달리다")).toBeTruthy();
    expect(within(table).getByText("verb, a1")).toBeTruthy();
    await waitFor(() => expect((within(add).getByLabelText("Word") as HTMLInputElement).value).toBe(""));

    // Same word again → kept and flagged as a duplicate (T27).
    type("Word", "run", add);
    click("Add word", add);
    expect(await within(table).findByText("Duplicate")).toBeTruthy();

    click("Edit “run”", within(table).getAllByRole("row")[1] as HTMLElement);
    const edit = await dialog("Edit “run”");
    type("Notes", "past: ran", edit);
    click("Save", edit);
    expect(await within(table).findByText("past: ran")).toBeTruthy();

    // Remove asks first; Cancel keeps the word.
    click("Remove “run”", within(table).getAllByRole("row")[2] as HTMLElement);
    click("Cancel", await dialog("Remove “run”"));
    expect(within(table).getAllByRole("rowheader", { name: /run/ })).toHaveLength(2);
    click("Remove “run”", within(table).getAllByRole("row")[2] as HTMLElement);
    click("Delete", await dialog("Remove “run”"));
    await waitFor(() => expect(within(table).getAllByRole("rowheader")).toHaveLength(1));

    // Move the remaining word to a second list.
    await createList("Week 2");
    fireEvent.click(screen.getByRole("button", { name: /Week 1/ }));
    await screen.findByRole("heading", { level: 2, name: "Week 1" });
    click("Move “run”");
    const move = await dialog("Move “run”");
    expect((within(move).getByLabelText("Move to") as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      "Week 2",
    );
    click("Move", move);
    expect(await screen.findByText(/This list has no words yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Week 2.*1 words/ })).toBeTruthy();
  });

  it("renames and deletes a list after confirmation", async () => {
    renderPage(<VocabPage />, "/vocab");
    await screen.findByText(/No lists yet/);
    await createList("Draft");
    click("Rename list");
    type("List name", "Final");
    click("Save");
    expect(await screen.findByRole("heading", { level: 2, name: "Final" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Final/ }).getAttribute("aria-current")).toBe("true");

    click("Delete list");
    const confirm = await dialog("Delete list");
    expect(within(confirm).getByText(/Delete the list “Final” and its 0 words/)).toBeTruthy();
    click("Delete", confirm);
    expect(await screen.findByText(/No lists yet/)).toBeTruthy();
  });

  it("exports JSON as a download and imports it back, asking on a name conflict", async () => {
    const created: Blob[] = [];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = (b: Blob | MediaSource): string => {
      created.push(b as Blob);
      return "blob:export";
    };
    URL.revokeObjectURL = (): void => undefined;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage(<VocabPage />, "/vocab");
    await screen.findByText(/No lists yet/);
    await createList("Shared");
    type("Word", "go", screen.getByRole("form", { name: "Add word" }));
    click("Add word");
    await screen.findByRole("table");

    click("Export JSON");
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const exported = created[0] as Blob;
    expect(exported.type).toBe("application/json");
    expect(exportFileName("json", new Date(2026, 10, 21))).toBe("enparse-vocab-2026-11-21.json");

    // Re-import: a different list with an existing name → conflict dialog → import as new list.
    const input = screen.getByLabelText("Import file (JSON or CSV)");
    // Change the ids so the import is a different list with the same name.
    const text = (await exported.text()).replaceAll(/"id": ?"([^"]+)"/g, '"id":"new-$1"');
    fireEvent.change(input, { target: { files: [new File([text], "backup.json", { type: "application/json" })] } });
    const conflict = await dialog("A list named “Shared” already exists");
    click("Import as new list", conflict);
    expect(await screen.findByText(/Import finished: 1 new lists/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Shared/ }).length).toBeGreaterThanOrEqual(2);
    clickSpy.mockRestore();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  it("shows import errors from the service", async () => {
    renderPage(<VocabPage />, "/vocab");
    await screen.findByText(/No lists yet/);
    const bad = new File(["not,valid\n1,2"], "bad.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Import file (JSON or CSV)"), { target: { files: [bad] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/The last action failed/);
  });

  it("opens the list named in ?list= (link from a list made from a text; T106)", async () => {
    const a = await h.service?.createList("First");
    const b = await h.service?.createListWithItems("From text", [{ word: "look", upos: "VERB" }]);
    expect(a && b).toBeTruthy();
    renderPage(<VocabPage />, "/vocab", `/vocab?list=${b?.id}`);
    expect(await screen.findByRole("heading", { level: 2, name: "From text" })).toBeTruthy();
  });
});
