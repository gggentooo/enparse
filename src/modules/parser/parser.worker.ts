/**
 * src/modules/parser/parser.worker.ts — Web Worker entry for parsing
 *
 * Description:
 *   All parsing runs here, never on the main thread (agents.md → Parser and
 *   worker code). Loads the model once, reports load status, and answers
 *   parse requests via postMessage only when the model is ready. There is no
 *   fallback parser (architecture.md → Model readiness).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Typed message protocol (in ./types.ts): load(model: ModelRef), unload,
 *      retry, parse, status (each with an id);
 *      responses status (idle | loading + progress | ready | failed + reason;
 *      broadcast), result, done, error. (done)
 *   2. On load: load wink-nlp (tokenizer) and transformerBackend, with progress
 *      messages for download and initialization; status becomes `ready` only
 *      after the self-test parse passes.
 *   3. Reject parse messages unless status is `ready` (ParserNotReadyError).
 *      On ParserLoadError, status `failed` with the reason; `retry` reloads.
 *      One model in memory at a time: load(model) while another is loaded
 *      unloads it first; `unload` returns to `idle`.
 *   4. Route parse requests to ./parser.ts with the loaded backend.
 *   5. Serialize errors as typed messages; no silent failures.
 *   6. Register new backends here (agents.md → Adding a parser backend).
 *
 * Dependencies:
 *   Internal: ./parser.ts, ./transformerBackend.ts, ./winkBackend.ts (tokenizer), ./types.ts.
 *   Browser APIs: Worker global scope (self.postMessage / onmessage).
 *   Created by: services/parserService.ts (new Worker(new URL(...), { type: 'module' })).
 *
 * Design: createWorkerHandler() holds the state and is tested without a
 *   Worker (parser.worker.test.ts); the module registers it on `self` only
 *   inside a dedicated worker. Requests are handled one at a time in arrival
 *   order, so a parse sent after load waits for the load to finish.
 *
 * Status: implemented (T35). The transformer backend is a placeholder until T63.
 */

import { Parser } from "./parser";
import { createTransformerBackend } from "./transformerBackend";
import {
  type ModelRef,
  ParserLoadError,
  ParserNotReadyError,
  type ParserBackend,
  type SentenceSpan,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerStatus,
  serializeError,
} from "./types";

/** Dependencies of the handler (injected in tests). */
export type WorkerDeps = {
  createBackend: () => ParserBackend;
  post: (msg: WorkerResponse) => void;
  tokenize?: (text: string) => SentenceSpan[];
};

/** Message handler with the worker's state (status, loaded backend, last model for retry). */
export function createWorkerHandler(deps: WorkerDeps): (msg: WorkerRequest) => Promise<void> {
  let status: WorkerStatus = { state: "idle" };
  let backend: ParserBackend | null = null;
  let parser: Parser | null = null;
  let lastModel: ModelRef | null = null;
  let queue: Promise<void> = Promise.resolve();

  const setStatus = (s: WorkerStatus): void => {
    status = s;
    deps.post({ type: "status", status });
  };

  const unload = async (): Promise<void> => {
    parser = null;
    const b = backend;
    backend = null;
    if (b) await b.unload();
  };

  const load = async (model: ModelRef): Promise<void> => {
    await unload(); // one model in memory at a time
    lastModel = model;
    setStatus({ state: "loading", modelId: model.id, phase: "initialize", progress: null });
    const b = deps.createBackend();
    try {
      await b.load(model, (p) => setStatus({ state: "loading", modelId: model.id, phase: p.phase, progress: p.progress }));
      if (!b.isReady()) throw new ParserLoadError("invalid-model", "backend not ready after load");
      const { labels, backend: compute } = b.info();
      backend = b;
      parser = new Parser(b, model, deps.tokenize);
      setStatus({ state: "ready", modelId: model.id, backend: compute, modelVersion: labels.model_version ?? "" });
    } catch (err) {
      await b.unload().catch(() => undefined);
      const reason = err instanceof ParserLoadError ? err.reason : "invalid-model";
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ state: "failed", modelId: model.id, reason, message });
      throw err instanceof ParserLoadError ? err : new ParserLoadError(reason, message);
    }
  };

  const handle = async (msg: WorkerRequest): Promise<void> => {
    try {
      switch (msg.type) {
        case "load":
          await load(msg.model);
          break;
        case "unload":
          await unload();
          lastModel = null;
          setStatus({ state: "idle" });
          break;
        case "retry":
          if (!lastModel) throw new ParserLoadError("invalid-model", "nothing to retry");
          await load(lastModel);
          break;
        case "parse":
          if (status.state !== "ready" || !parser) throw new ParserNotReadyError();
          deps.post({ type: "result", id: msg.id, result: await parser.parse(msg.text) });
          return;
        case "status":
          deps.post({ type: "status", status });
          break;
      }
      deps.post({ type: "done", id: msg.id });
    } catch (err) {
      deps.post({ type: "error", id: msg.id, error: serializeError(err) });
    }
  };

  return (msg) => {
    queue = queue.then(() => handle(msg));
    return queue;
  };
}

// Register only inside a dedicated worker (not when imported by tests or tools).
if (typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope) {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  const handler = createWorkerHandler({
    createBackend: createTransformerBackend,
    post: (msg) => scope.postMessage(msg),
  });
  scope.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
    void handler(e.data);
  });
}
