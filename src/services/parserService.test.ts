/**
 * src/services/parserService.test.ts — model readiness state machine, library actions, parse guard (T52)
 */

import { describe, expect, it, vi } from "vitest";
import type { EnvironmentProbe } from "../core/environment";
import type { PreprocessResult } from "../modules/input";
import {
  type Catalog,
  type CatalogEntry,
  ModelDownloadError,
  type ModelState,
  parseCatalog,
} from "../modules/modelLibrary";
import fixture from "../modules/modelLibrary/catalog.fixture.json";
import type { ModelRef, ParseResult, ParserClient, WorkerStatus } from "../modules/parser";
import { ParserLoadError, ParserNotReadyError } from "../modules/parser";
import type { DeviceAssessment, ModelFitness, PreflightReport } from "../modules/preflight";
import {
  type ModelStatus,
  ModelUnavailableError,
  ParseSupersededError,
  type ParserServiceDeps,
  createParserService,
} from "./parserService";

const catalog: Catalog = parseCatalog(fixture);
const [A, B] = catalog.models as [CatalogEntry, CatalogEntry];

const report = (verdict: PreflightReport["verdict"]): PreflightReport => ({
  verdict,
  checks: [],
  startedAt: 0,
  finishedAt: 0,
  backendHint: "wasm",
});
const device = (verdict: PreflightReport["verdict"] = "ok"): DeviceAssessment => ({
  report: report(verdict),
  probe: { persisted: false } as EnvironmentProbe,
});
const fit = (id: string, over: Partial<ModelFitness> = {}): ModelFitness => ({
  id,
  verdict: "ok",
  variant: "int8",
  reasons: [],
  expectedParseSeconds: 1,
  ...over,
});
const parseResult = (modelId: string): ParseResult => ({ sentences: [], modelId, modelVersion: "v", backend: "wasm" });
const prep = (raw: string, hasRemovals = false): PreprocessResult =>
  ({ text: raw.trim(), originalLength: raw.length, cleanLength: raw.trim().length, hasRemovals }) as PreprocessResult;

/** Fake worker client: load → loading → ready (or a scripted failure). */
function fakeWorker() {
  let status: WorkerStatus = { state: "idle" };
  const listeners = new Set<(s: WorkerStatus) => void>();
  const emit = (s: WorkerStatus): void => {
    status = s;
    for (const l of listeners) l(s);
  };
  const calls: string[] = [];
  const loadFailures: Error[] = [];
  let parseGate: Promise<void> = Promise.resolve();
  const client: ParserClient = {
    async load(model: ModelRef) {
      calls.push(`load:${model.id}:${model.variant}`);
      emit({ state: "loading", modelId: model.id, phase: "initialize", progress: 0.5 });
      const failure = loadFailures.shift();
      if (failure) {
        emit({ state: "failed", modelId: model.id, reason: "out-of-memory", message: failure.message });
        throw failure;
      }
      emit({ state: "ready", modelId: model.id, backend: "wasm", modelVersion: `${model.id}-v1` });
    },
    async unload() {
      calls.push("unload");
      emit({ state: "idle" });
    },
    async retry() {},
    async parse(text: string) {
      calls.push(`parse:${text}`);
      await parseGate;
      return parseResult(status.state === "ready" ? status.modelId : "?");
    },
    status: () => status,
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {},
  };
  return {
    client,
    calls,
    loadFailures,
    gateParse(p: Promise<void>) {
      parseGate = p;
    },
  };
}

/** Mocked modules with an in-memory model cache and saved choice. */
function setup(opts: { device?: DeviceAssessment; saved?: string; cached?: string[] } = {}) {
  const worker = fakeWorker();
  const cached = new Set(opts.cached ?? []);
  let saved: string | null = opts.saved ?? null;
  const downloadFailures: Error[] = [];
  let downloadGate: Promise<void> = Promise.resolve();
  const modelChecks: Array<{ verdict: PreflightReport["verdict"]; corrupt: string[] }> = [];
  const deps = {
    runDeviceChecks: vi.fn<ParserServiceDeps["runDeviceChecks"]>(async () => opts.device ?? device()),
    loadCatalog: vi.fn<ParserServiceDeps["loadCatalog"]>(async () => catalog),
    assessModels: vi.fn<ParserServiceDeps["assessModels"]>(() => catalog.models.map((m) => fit(m.id))),
    getModelStates: vi.fn<ParserServiceDeps["getModelStates"]>(async (c: Catalog) => {
      const out: Record<string, ModelState> = {};
      for (const m of c.models) {
        out[m.id] = cached.has(m.id)
          ? { state: "downloaded", bytesOnDisk: 1, variant: "int8" }
          : { state: "not-downloaded" };
      }
      return out;
    }),
    downloadModel: vi.fn<ParserServiceDeps["downloadModel"]>(
      async (entry: CatalogEntry, _v: string, onProgress?: (d: number, t: number) => void) => {
        onProgress?.(0, 100);
        onProgress?.(50, 100);
        await downloadGate;
        const failure = downloadFailures.shift();
        if (failure) throw failure;
        onProgress?.(100, 100);
        cached.add(entry.id);
      },
    ),
    cancelDownload: vi.fn<ParserServiceDeps["cancelDownload"]>(async () => undefined),
    deleteModel: vi.fn<ParserServiceDeps["deleteModel"]>(async (entry: CatalogEntry) => void cached.delete(entry.id)),
    runModelChecks: vi.fn<ParserServiceDeps["runModelChecks"]>(async () => {
      const next = modelChecks.shift() ?? { verdict: "ok" as const, corrupt: [] };
      return { report: report(next.verdict), manifest: null, corrupt: next.corrupt };
    }),
    getSavedChoice: vi.fn<ParserServiceDeps["getSavedChoice"]>(async () => saved),
    saveChoice: vi.fn<ParserServiceDeps["saveChoice"]>(async (id: string) => void (saved = id)),
    clearChoice: vi.fn<ParserServiceDeps["clearChoice"]>(async () => void (saved = null)),
    createWorker: vi.fn<ParserServiceDeps["createWorker"]>(() => worker.client),
    requestPersistentStorage: vi.fn<ParserServiceDeps["requestPersistentStorage"]>(async () => true),
    preprocess: vi.fn<ParserServiceDeps["preprocess"]>((raw: string) => prep(raw, raw.includes("한"))),
  } satisfies ParserServiceDeps;
  const service = createParserService(deps);
  const statuses: ModelStatus["state"][] = [];
  service.subscribe(() => {
    const s = service.getSnapshot().status.state;
    if (statuses.at(-1) !== s) statuses.push(s);
  });
  return {
    service,
    deps,
    worker,
    statuses,
    cached,
    downloadFailures,
    modelChecks,
    gateDownload(p: Promise<void>) {
      downloadGate = p;
    },
    saved: () => saved,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("start", () => {
  it("a blocked device fails as unsupported without loading the catalog or creating the worker", async () => {
    const t = setup({ device: device("blocked") });
    await t.service.start();
    expect(t.service.getSnapshot().status).toMatchObject({ state: "failed", reason: "unsupported", modelId: null });
    expect(t.service.getSnapshot().preflight?.verdict).toBe("blocked");
    expect(t.deps.loadCatalog).not.toHaveBeenCalled();
    expect(t.deps.createWorker).not.toHaveBeenCalled();
  });

  it("waits for a choice: no download, library filled, parse refused without a worker call", async () => {
    const t = setup();
    await Promise.all([t.service.start(), t.service.start()]);
    const snap = t.service.getSnapshot();
    expect(t.statuses).toEqual(["checking", "no-model"]);
    expect(t.deps.runDeviceChecks).toHaveBeenCalledTimes(1);
    expect(t.deps.downloadModel).not.toHaveBeenCalled();
    expect(snap.library.catalog).toBe(catalog);
    expect(snap.library.recommendedId).toBe(A.id);
    expect(snap.library.badges[A.id]).toBeDefined();
    await expect(t.service.parseText("Hello.")).rejects.toBeInstanceOf(ParserNotReadyError);
    expect(t.deps.createWorker).not.toHaveBeenCalled();
    expect(t.deps.preprocess).not.toHaveBeenCalled();
  });

  it("loads a fully cached saved choice without downloading", async () => {
    const t = setup({ saved: B.id, cached: [B.id] });
    await t.service.start();
    expect(t.service.getSnapshot().status).toMatchObject({ state: "ready", modelId: B.id, modelVersion: `${B.id}-v1` });
    expect(t.deps.downloadModel).not.toHaveBeenCalled();
    expect(t.worker.calls).toEqual([`load:${B.id}:int8`]);
    expect(t.service.getSnapshot().library.activeId).toBe(B.id);
  });

  it("does not auto-download a saved choice that is not cached", async () => {
    const t = setup({ saved: B.id });
    await t.service.start();
    expect(t.service.getSnapshot().status.state).toBe("no-model");
    expect(t.deps.downloadModel).not.toHaveBeenCalled();
  });

  it("a catalog that cannot load fails as network; retryLoad starts again", async () => {
    const t = setup();
    t.deps.loadCatalog.mockRejectedValueOnce(new Error("offline"));
    await t.service.start();
    expect(t.service.getSnapshot().status).toMatchObject({ state: "failed", reason: "network", modelId: null });
    await t.service.retryLoad();
    expect(t.service.getSnapshot().status.state).toBe("no-model");
  });
});

describe("chooseModel", () => {
  it("downloads with progress, checks, loads, saves the choice, and asks for persistent storage once", async () => {
    const t = setup();
    await t.service.start();
    await t.service.chooseModel(A.id);
    expect(t.statuses).toEqual(["checking", "no-model", "downloading", "loading", "ready"]);
    expect(t.service.getSnapshot().status).toMatchObject({ state: "ready", modelId: A.id });
    expect(t.service.getSnapshot().library.states[A.id]).toMatchObject({ state: "downloaded" });
    expect(t.saved()).toBe(A.id);
    expect(t.deps.runModelChecks).toHaveBeenCalledWith(`/models/${A.folder}/`, expect.anything());
    await t.service.chooseModel(B.id);
    expect(t.deps.requestPersistentStorage).toHaveBeenCalledTimes(1);
  });

  it("switching loads the new model through the worker (which unloads the old one) and updates the active id", async () => {
    const t = setup({ cached: [A.id, B.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    await t.service.chooseModel(B.id);
    expect(t.worker.calls).toEqual([`load:${A.id}:int8`, `load:${B.id}:int8`]);
    expect(t.service.getSnapshot().library.activeId).toBe(B.id);
    expect(t.deps.createWorker).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown and blocked models without changing the status", async () => {
    const t = setup();
    t.deps.assessModels.mockReturnValue([fit(A.id), fit(B.id, { verdict: "blocked", variant: null })]);
    await t.service.start();
    await expect(t.service.chooseModel("nope")).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(t.service.chooseModel(B.id)).rejects.toMatchObject({ reason: "blocked" });
    expect(t.service.getSnapshot().status.state).toBe("no-model");
  });

  it("re-downloads once after corrupt cached files, then fails as invalid-model", async () => {
    const t = setup({ cached: [A.id] });
    await t.service.start();
    t.modelChecks.push({ verdict: "blocked", corrupt: ["onnx/model.onnx"] }, { verdict: "ok", corrupt: [] });
    await t.service.chooseModel(A.id);
    expect(t.deps.downloadModel).toHaveBeenCalledTimes(1);
    expect(t.service.getSnapshot().status.state).toBe("ready");

    t.modelChecks.push({ verdict: "blocked", corrupt: ["x"] }, { verdict: "blocked", corrupt: ["x"] });
    await expect(t.service.chooseModel(A.id)).rejects.toBeInstanceOf(ParserLoadError);
    expect(t.service.getSnapshot().status).toMatchObject({ state: "failed", reason: "invalid-model", modelId: A.id });
    expect(t.deps.downloadModel).toHaveBeenCalledTimes(2);
  });

  it("maps download and load failures to failed reasons; retryLoad retries the model", async () => {
    const t = setup();
    await t.service.start();
    t.downloadFailures.push(new ModelDownloadError("quota", "full"));
    await expect(t.service.chooseModel(A.id)).rejects.toBeInstanceOf(ModelDownloadError);
    expect(t.service.getSnapshot().status).toMatchObject({ state: "failed", reason: "storage" });

    t.worker.loadFailures.push(new ParserLoadError("out-of-memory", "oom"));
    await expect(t.service.retryLoad()).rejects.toBeInstanceOf(ParserLoadError);
    expect(t.service.getSnapshot().status).toMatchObject({ state: "failed", reason: "out-of-memory", modelId: A.id });

    await t.service.retryLoad();
    expect(t.service.getSnapshot().status).toMatchObject({ state: "ready", modelId: A.id });
  });

  it("cancelling the chosen model's download returns to the loaded model", async () => {
    const t = setup({ cached: [A.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    const gate = deferred();
    t.gateDownload(gate.promise);
    t.downloadFailures.push(new ModelDownloadError("cancelled", "cancelled"));
    const choosing = t.service.chooseModel(B.id);
    await tick();
    expect(t.service.getSnapshot().status).toMatchObject({ state: "downloading", modelId: B.id, bytesDone: 50 });
    expect(t.service.getSnapshot().library.states[B.id]).toMatchObject({ state: "downloading" });
    const cancelling = t.service.cancelDownload(B.id);
    gate.resolve();
    await Promise.all([choosing, cancelling]);
    expect(t.deps.cancelDownload).toHaveBeenCalledWith(B.id);
    expect(t.service.getSnapshot().status).toMatchObject({ state: "ready", modelId: A.id });
  });

  it("a newer choice cancels the older choice's download and wins", async () => {
    const t = setup({ cached: [B.id] });
    await t.service.start();
    const gate = deferred();
    t.gateDownload(gate.promise);
    const first = t.service.chooseModel(A.id);
    await tick();
    const second = t.service.chooseModel(B.id);
    await tick();
    gate.resolve();
    await Promise.all([first, second]);
    expect(t.deps.cancelDownload).toHaveBeenCalledWith(A.id);
    expect(t.worker.calls).toEqual([`load:${B.id}:int8`]);
    expect(t.service.getSnapshot().status).toMatchObject({ state: "ready", modelId: B.id });
  });
});

describe("library actions", () => {
  it("downloadModel downloads without loading or changing the status", async () => {
    const t = setup();
    await t.service.start();
    await t.service.downloadModel(B.id);
    expect(t.service.getSnapshot().library.states[B.id]).toMatchObject({ state: "downloaded" });
    expect(t.service.getSnapshot().status.state).toBe("no-model");
    expect(t.deps.createWorker).not.toHaveBeenCalled();
  });

  it("deleting the active model unloads it first and clears the saved choice", async () => {
    const t = setup({ cached: [A.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    await t.service.deleteModel(A.id);
    expect(t.worker.calls.at(-1)).toBe("unload");
    expect(t.deps.deleteModel.mock.invocationCallOrder[0]).toBeGreaterThan(
      t.deps.clearChoice.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(t.service.getSnapshot().status.state).toBe("no-model");
    expect(t.service.getSnapshot().library.activeId).toBeNull();
    expect(t.service.getSnapshot().library.states[A.id]).toEqual({ state: "not-downloaded" });
    expect(t.saved()).toBeNull();
    await expect(t.service.parseText("Hi.")).rejects.toBeInstanceOf(ParserNotReadyError);
  });

  it("deleting another model keeps the active one ready", async () => {
    const t = setup({ cached: [A.id, B.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    await t.service.deleteModel(B.id);
    expect(t.worker.calls).not.toContain("unload");
    expect(t.service.getSnapshot().status).toMatchObject({ state: "ready", modelId: A.id });
  });
});

describe("parseText", () => {
  it("preprocesses, parses in the worker, and keeps the result and removal notice", async () => {
    const t = setup({ cached: [A.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    const out = await t.service.parseText("  The cat sat. 한 ");
    expect(t.worker.calls.at(-1)).toBe("parse:The cat sat. 한");
    expect(out.annotation.modelId).toBe(A.id);
    expect(t.service.getSnapshot().annotation).toBe(out.annotation);
    expect(t.service.getSnapshot().notice).toBe(out.input);
    await t.service.parseText("Plain.");
    expect(t.service.getSnapshot().notice).toBeNull();
  });

  it("drops a parse superseded by a newer one", async () => {
    const t = setup({ cached: [A.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    const gate = deferred();
    t.worker.gateParse(gate.promise);
    const older = t.service.parseText("one");
    const newer = t.service.parseText("two");
    gate.resolve();
    await expect(older).rejects.toBeInstanceOf(ParseSupersededError);
    await expect(newer).resolves.toBeDefined();
  });

  it("keeps the input draft across pages", () => {
    const t = setup();
    const seen = vi.fn<() => void>();
    t.service.subscribe(seen);
    t.service.setDraft("Hello there.");
    t.service.setDraft("Hello there.");
    expect(t.service.getSnapshot().draft).toBe("Hello there.");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("propagates preprocessing errors (input too long)", async () => {
    const t = setup({ cached: [A.id] });
    await t.service.start();
    await t.service.chooseModel(A.id);
    t.deps.preprocess.mockImplementationOnce(() => {
      throw new RangeError("too long");
    });
    await expect(t.service.parseText("x")).rejects.toThrow("too long");
  });
});
