/**
 * src/modules/parser/index.test.ts — unit tests for the parser client (T35)
 *
 * The client talks to the real worker handler through an in-memory port (no Worker).
 * Covers: parse refused before ready without a message, load/parse round trip, typed
 * errors across the boundary, status subscription, dispose.
 */

import { describe, expect, it } from "vitest";
import { type WorkerPort, createParserClient } from "./index";
import { createWorkerHandler } from "./parser.worker";
import { MODEL, mockBackend } from "./testFixtures";
import {
  ParserLoadError,
  ParserNotReadyError,
  ParserRuntimeError,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerStatus,
} from "./types";

function connect(fail = false) {
  const sent: WorkerRequest[] = [];
  let onMessage: (e: { data: WorkerResponse }) => void = () => undefined;
  let terminated = false;
  const handle = createWorkerHandler({
    createBackend: () => {
      const b = mockBackend({ ready: false });
      if (fail) b.load = async () => Promise.reject(new ParserLoadError("network", "offline"));
      return b;
    },
    post: (m) => queueMicrotask(() => onMessage({ data: m })),
  });
  const port: WorkerPort = {
    postMessage: (m) => {
      sent.push(m);
      void handle(m);
    },
    addEventListener: ((type: "message" | "error", fn: (e: never) => void) => {
      if (type === "message") onMessage = fn as typeof onMessage;
    }) as WorkerPort["addEventListener"],
    terminate: () => {
      terminated = true;
    },
  };
  return {
    client: createParserClient(port),
    sent,
    isTerminated: () => terminated,
  };
}

describe("createParserClient", () => {
  it("rejects parse before ready without contacting the worker", async () => {
    const { client, sent } = connect();
    await expect(client.parse("Hi.")).rejects.toBeInstanceOf(ParserNotReadyError);
    expect(sent).toEqual([]);
  });

  it("loads, reports status changes, and parses", async () => {
    const { client } = connect();
    const seen: WorkerStatus["state"][] = [];
    const off = client.onStatus((s) => seen.push(s.state));
    await client.load(MODEL);
    expect(client.status()).toMatchObject({ state: "ready", modelId: "test-model" });
    const result = await client.parse("The dog barks.");
    expect(result.sentences[0]?.tokens.map((t) => t.text)).toEqual(["The", "dog", "barks", "."]);
    off();
    await client.unload();
    expect(seen).toEqual(["loading", "ready"]);
    expect(client.status().state).toBe("idle");
  });

  it("rethrows worker errors as typed errors", async () => {
    const { client } = connect(true);
    const err = await client.load(MODEL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParserLoadError);
    expect((err as ParserLoadError).reason).toBe("network");
    expect(client.status()).toMatchObject({ state: "failed", reason: "network" });
  });

  it("fails pending requests and reports a failed status when the worker script errors", async () => {
    // A worker whose script failed: it never answers, then reports an error event.
    let onError: (e: { message?: string }) => void = () => undefined;
    const silent: WorkerPort = {
      postMessage: () => undefined,
      addEventListener: ((type: "message" | "error", fn: (e: never) => void) => {
        if (type === "error") onError = fn as typeof onError;
      }) as WorkerPort["addEventListener"],
      terminate: () => undefined,
    };
    const client = createParserClient(silent);
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s.state));
    const load = client.load(MODEL);
    onError({ message: "SyntaxError: import failed" });
    await expect(load).rejects.toThrow(/parser worker error: SyntaxError: import failed/);
    expect(client.status()).toMatchObject({ state: "failed", reason: "unsupported" });
    expect(statuses).toEqual(["failed"]);
  });

  it("dispose terminates the worker and rejects later requests", async () => {
    const { client, isTerminated } = connect();
    client.dispose();
    expect(isTerminated()).toBe(true);
    await expect(client.load(MODEL)).rejects.toBeInstanceOf(ParserRuntimeError);
  });
});
