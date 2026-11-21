// @vitest-environment jsdom
/**
 * src/core/storage.test.ts — unit tests for the storage wrapper (T29)
 *
 * jsdom LocalStorage and fake-indexeddb (dev dependency, approved 2026-11-21).
 * Covers: round trip, namespaced and versioned keys, size-based backend choice and
 * one copy per key, explicit backend, keys(prefix), fallback when one backend is
 * missing, StorageUnavailableError, StorageQuotaError from both backends.
 */

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_SIZE_THRESHOLD, StorageQuotaError, StorageUnavailableError, createStorage } from "./storage";

beforeEach(() => localStorage.clear());

const big = (): string => "x".repeat(STORAGE_SIZE_THRESHOLD + 10);

describe("createStorage", () => {
  it("round-trips JSON values under namespaced, versioned keys", async () => {
    const s = createStorage({ indexedDB: new IDBFactory() });
    await s.set("vocab/list-1", { name: "Week 1", words: ["run", "ran"] });
    expect(await s.get("vocab/list-1")).toEqual({ name: "Week 1", words: ["run", "ran"] });
    expect(localStorage.getItem("enparse:v1:vocab/list-1")).not.toBeNull();
    expect(await s.get("missing")).toBeUndefined();
    await s.remove("vocab/list-1");
    expect(await s.get("vocab/list-1")).toBeUndefined();
  });

  it("puts large values in IndexedDB and keeps one copy per key", async () => {
    const s = createStorage({ indexedDB: new IDBFactory() });
    await s.set("k", "small");
    expect(localStorage.getItem("enparse:v1:k")).toBe('"small"');
    await s.set("k", big());
    expect(localStorage.getItem("enparse:v1:k")).toBeNull();
    expect(await s.get("k")).toBe(big());
    await s.set("k", "small again");
    expect(await s.get("k")).toBe("small again");
    await s.set("forced", 1, { backend: "indexeddb" });
    expect(localStorage.getItem("enparse:v1:forced")).toBeNull();
    expect(await s.get("forced")).toBe(1);
  });

  it("lists keys by prefix across both backends, without the namespace", async () => {
    const s = createStorage({ indexedDB: new IDBFactory() });
    await s.set("vocab/a", 1);
    await s.set("vocab/b", big());
    await s.set("settings", {});
    localStorage.setItem("other-app", "x");
    localStorage.setItem("enparse:v0:vocab/old", "1"); // older schema: not listed
    expect(await s.keys("vocab/")).toEqual(["vocab/a", "vocab/b"]);
    expect(await s.keys()).toEqual(["settings", "vocab/a", "vocab/b"]);
  });

  it("falls back to the other backend and throws when none is available", async () => {
    const onlyIdb = createStorage({ local: null, indexedDB: new IDBFactory() });
    await onlyIdb.set("k", "v");
    expect(await onlyIdb.get("k")).toBe("v");
    const onlyLocal = createStorage({ indexedDB: null });
    await onlyLocal.set("big", big());
    expect(await onlyLocal.get("big")).toBe(big());
    const none = createStorage({ local: null, indexedDB: null });
    await expect(none.get("k")).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(none.set("k", 1)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("turns quota errors into StorageQuotaError and rejects non-JSON values", async () => {
    const full = {
      length: 0,
      key: () => null,
      getItem: () => null,
      removeItem: () => undefined,
      clear: () => undefined,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    } as Storage;
    const s = createStorage({ local: full, indexedDB: null });
    await expect(s.set("k", "v")).rejects.toBeInstanceOf(StorageQuotaError);
    await expect(createStorage({ indexedDB: null }).set("k", undefined)).rejects.toBeInstanceOf(TypeError);
  });
});
