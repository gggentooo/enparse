/**
 * src/modules/parser/index.ts — public API of the parser module
 *
 * Description:
 *   Sentence structure parsing (UPOS + NP/VP/PP/ADJP/ADVP chunks, dependency
 *   tree, labeled nested phrases, alternatives) running in a Web Worker.
 *   Other layers import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (parser)
 *
 * Public API:
 *   - createParserWorker(): starts ./parser.worker.ts as a module worker and
 *     returns a typed ParserClient: load(model), unload(), retry(),
 *     parse(text), status(), onStatus(fn), dispose(). parse() rejects with
 *     ParserNotReadyError unless the last status is `ready` (no message sent).
 *   - createParserClient(port): the same client over any WorkerPort (tests).
 *   - Types and errors from ./types.ts; MAX_ALTERNATIVES from ./ambiguity.ts.
 *   Backends are not exported (they run only inside the worker).
 *
 * Dependencies:
 *   Internal: ./parser.worker.ts (worker entry), ./types.ts, ./ambiguity.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: implemented (T35). Tests: index.test.ts.
 */

import {
  type ModelRef,
  type ParseResult,
  ParserNotReadyError,
  ParserRuntimeError,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerStatus,
  deserializeError,
} from "./types";

export { MAX_ALTERNATIVES } from "./ambiguity";
export type {
  Alternative,
  Chunk,
  ChunkType,
  ComputeBackend,
  LabeledPhrase,
  LabeledSentencePhrases,
  LabeledWord,
  LabelConfig,
  LoadFailureReason,
  ModelRef,
  ParseResult,
  PhraseCategory,
  PhraseRole,
  PhraseType,
  SentenceParse,
  Token,
  WorkerStatus,
} from "./types";
export { LABEL_SCHEMA_VERSION, ParserLoadError, ParserNotReadyError, ParserRuntimeError, TokenizerError } from "./types";

/** The part of a Worker the client uses. */
export type WorkerPort = {
  postMessage(msg: WorkerRequest): void;
  addEventListener(type: "message", fn: (e: { data: WorkerResponse }) => void): void;
  terminate(): void;
};

/** Typed client of the parser worker. */
export type ParserClient = {
  /** Load a model (unloads the current one first); rejects with ParserLoadError. */
  load(model: ModelRef): Promise<void>;
  unload(): Promise<void>;
  /** Reload the last model after a failure. */
  retry(): Promise<void>;
  /** Parse preprocessed text; rejects with ParserNotReadyError unless ready. */
  parse(text: string): Promise<ParseResult>;
  /** Last status seen from the worker. */
  status(): WorkerStatus;
  /** Subscribe to status changes; returns the unsubscribe function. */
  onStatus(fn: (s: WorkerStatus) => void): () => void;
  /** Terminate the worker; pending requests reject. */
  dispose(): void;
};

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void };
/** A request without its id (distributes over the union). */
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

/** Client over a worker port (see the header). */
export function createParserClient(port: WorkerPort): ParserClient {
  let current: WorkerStatus = { state: "idle" };
  let nextId = 1;
  let disposed = false;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(s: WorkerStatus) => void>();

  port.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "status") {
      current = msg.status;
      for (const fn of listeners) fn(current);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === "error") p.reject(deserializeError(msg.error));
    else p.resolve(msg.type === "result" ? msg.result : undefined);
  });

  const request = <T>(msg: RequestBody): Promise<T> => {
    if (disposed) return Promise.reject(new ParserRuntimeError("the parser worker was disposed"));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      port.postMessage({ ...msg, id } as WorkerRequest);
    });
  };

  return {
    load: (model) => request<void>({ type: "load", model }),
    unload: () => request<void>({ type: "unload" }),
    retry: () => request<void>({ type: "retry" }),
    parse: (text) =>
      current.state === "ready"
        ? request<ParseResult>({ type: "parse", text })
        : Promise.reject(new ParserNotReadyError()),
    status: () => current,
    onStatus: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose: () => {
      disposed = true;
      port.terminate();
      for (const p of pending.values()) p.reject(new ParserRuntimeError("the parser worker was disposed"));
      pending.clear();
      listeners.clear();
    },
  };
}

/** Start the parser worker (module worker; Vite bundles it). */
export function createParserWorker(): ParserClient {
  const worker = new Worker(new URL("./parser.worker.ts", import.meta.url), { type: "module" });
  return createParserClient(worker as unknown as WorkerPort);
}
