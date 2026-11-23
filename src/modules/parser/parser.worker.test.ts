/**
 * src/modules/parser/parser.worker.test.ts — unit tests for the worker message handler (T35)
 *
 * Covers: parse refused before ready, load → loading/ready statuses, load failure → failed
 * with reason, retry, switching models unloads first, unload → idle, request ordering.
 */

import { describe, expect, it } from "vitest";
import { type WorkerScope, createWorkerHandler, registerWorker } from "./parser.worker";
import { MODEL, mockBackend } from "./testFixtures";
import { type ParserBackend, ParserLoadError, type WorkerRequest, type WorkerResponse } from "./types";

function setup(createBackend: () => ParserBackend = () => mockBackend({ ready: false })) {
  const out: WorkerResponse[] = [];
  const handle = createWorkerHandler({ createBackend, post: (m) => out.push(m) });
  const statuses = () => out.flatMap((m) => (m.type === "status" ? [m.status.state] : []));
  const reply = (id: number) => out.find((m) => m.type !== "status" && m.id === id);
  return { out, handle, statuses, reply };
}

describe("createWorkerHandler", () => {
  it("rejects parse requests until the model is ready", async () => {
    const { handle, reply } = setup();
    await handle({ type: "parse", id: 1, text: "Hi." });
    expect(reply(1)).toMatchObject({ type: "error", error: { name: "ParserNotReadyError" } });
  });

  it("loads (loading → ready) and then parses", async () => {
    const { handle, reply, statuses, out } = setup();
    await handle({ type: "load", id: 1, model: MODEL });
    expect(reply(1)).toEqual({ type: "done", id: 1 });
    expect(statuses()).toEqual(["loading", "ready"]);
    expect(out.find((m) => m.type === "status" && m.status.state === "ready")).toMatchObject({
      status: { modelId: "test-model", backend: "wasm", modelVersion: "1.0.0" },
    });
    await handle({ type: "parse", id: 2, text: "The dog barks." });
    const r = reply(2);
    expect(r?.type).toBe("result");
    expect(r && r.type === "result" ? r.result.sentences[0]?.tokens.length : 0).toBe(4);
  });

  it("reports a failed load with its reason, and retry reloads the same model", async () => {
    let attempts = 0;
    const { handle, reply, statuses } = setup(() => {
      const b = mockBackend({ ready: false });
      if (attempts++ === 0) b.load = async () => Promise.reject(new ParserLoadError("out-of-memory", "too big"));
      return b;
    });
    await handle({ type: "load", id: 1, model: MODEL });
    expect(reply(1)).toMatchObject({ type: "error", error: { name: "ParserLoadError", reason: "out-of-memory" } });
    expect(statuses()).toEqual(["loading", "failed"]);
    await handle({ type: "retry", id: 2 });
    expect(reply(2)).toEqual({ type: "done", id: 2 });
    expect(statuses().at(-1)).toBe("ready");
  });

  it("maps unexpected load errors to invalid-model", async () => {
    const { handle, reply } = setup(() => {
      const b = mockBackend({ ready: false });
      b.load = async () => Promise.reject(new Error("bad file"));
      return b;
    });
    await handle({ type: "load", id: 1, model: MODEL });
    expect(reply(1)).toMatchObject({
      error: { name: "ParserLoadError", reason: "invalid-model", message: "bad file" },
    });
  });

  it("unloads the current model before loading another, and unload returns to idle", async () => {
    const unloaded: string[] = [];
    let n = 0;
    const { handle, statuses } = setup(() => {
      const b = mockBackend({ ready: false });
      const name = `b${n++}`;
      const unload = b.unload.bind(b);
      b.unload = async () => {
        unloaded.push(name);
        await unload();
      };
      return b;
    });
    await handle({ type: "load", id: 1, model: MODEL });
    await handle({ type: "load", id: 2, model: { ...MODEL, id: "other" } });
    expect(unloaded).toEqual(["b0"]);
    await handle({ type: "unload", id: 3 });
    expect(unloaded).toEqual(["b0", "b1"]);
    expect(statuses().at(-1)).toBe("idle");
  });

  it("handles requests in arrival order (a parse sent during load waits for it)", async () => {
    const { handle, reply } = setup();
    const load = handle({ type: "load", id: 1, model: MODEL });
    const parse = handle({ type: "parse", id: 2, text: "The dog barks." });
    await Promise.all([load, parse]);
    expect(reply(2)?.type).toBe("result");
  });

  it("answers status requests", async () => {
    const { handle, out } = setup();
    await handle({ type: "status", id: 1 });
    expect(out).toEqual([
      { type: "status", status: { state: "idle" } },
      { type: "done", id: 1 },
    ]);
  });
});

describe("registerWorker (T97)", () => {
  it("registers one handler per worker scope, so a re-evaluated entry module cannot answer twice", async () => {
    const out: WorkerResponse[] = [];
    const listeners: Array<(e: { data: WorkerRequest }) => void> = [];
    const scope: WorkerScope = {
      postMessage: (m) => out.push(m),
      addEventListener: (_type, fn) => listeners.push(fn),
    };
    // Safari evaluates the worker's entry module again when a chunk imports it: two registrations.
    expect(registerWorker(scope, () => mockBackend({ ready: false }))).toBe(true);
    expect(registerWorker(scope, () => mockBackend({ ready: false }))).toBe(false);
    expect(listeners).toHaveLength(1);
    for (const fn of listeners) fn({ data: { type: "parse", id: 7, text: "Hi." } });
    await new Promise((r) => setTimeout(r, 0));
    // Exactly one answer per request (here: not ready, since nothing was loaded).
    expect(out.filter((m) => m.type !== "status" && m.id === 7)).toHaveLength(1);
  });
});
