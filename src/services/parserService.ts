/**
 * src/services/parserService.ts — parsing workflow service
 *
 * Description:
 *   Runs the model library and model readiness (pre-flight checks → user's
 *   model choice → download → load) and the parse chain for the UI:
 *   preprocess → parse in the Web Worker → build annotations. Holds parser
 *   state (model status, pre-flight report, library snapshot, last result)
 *   and exposes it via subscribe() / getSnapshot(). One service owns all of
 *   this because services may not import each other and the worker must
 *   have a single owner.
 *
 * Layer: services/
 *
 * Tasks:
 *   1. start() at app start (architecture.md → Model library, Model readiness);
 *      later calls return the same promise:
 *      a. status `checking`: modules/preflight runDeviceChecks(); verdict
 *         `blocked` → status `failed: unsupported` (nothing is downloaded).
 *      b. modules/modelLibrary loadCatalog() + getModelStates();
 *         preflight assessModels() → fitness per model; recommendModel()
 *         (the default model first, its backup when the default is blocked,
 *         too slow, or has failed to load on this device; recomputed after a
 *         failed or successful load; T43);
 *         cardBadges(). A catalog that cannot load → `failed: network`.
 *      c. If the saved choice is fully cached: load it (step 2b). Otherwise
 *         status `no-model` (waiting for the user; nothing downloaded).
 *   2. chooseModel(id): (also used when switching models)
 *      a. If not downloaded: status `downloading` with byte progress;
 *         modelLibrary downloadModel() (verified). The first download asks
 *         for persistent storage (T24).
 *      b. preflight runModelChecks() for this model; corrupt cached files are
 *         deleted and downloaded again once (MAX_INTEGRITY_RETRIES); still
 *         `blocked` → `failed: invalid-model` (retryLoad re-downloads).
 *      c. Worker load(ModelRef) (it unloads the previous model first) →
 *         `loading` → self-test → `ready`; saveChoice(id).
 *      A newer choice supersedes an older one (its download is cancelled; its
 *      results are ignored). Blocked or unknown models reject with
 *      ModelUnavailableError.
 *   3. downloadModel(id) without loading; cancelDownload(id) (the chosen
 *      model's cancelled download → back to the loaded model's `ready`, else
 *      `no-model`); deleteModel(id): unload first if active (status
 *      `no-model`, saved choice cleared), then modelLibrary deleteModel().
 *   4. parseText(raw): Promise<ParseOutcome> — rejects with ParserNotReadyError
 *      unless the model status is `ready` (no worker call); otherwise
 *      modules/input preprocess (InputTooLongError propagates; removal report
 *      kept) → worker parse. A parse started later supersedes it: the older
 *      call rejects with ParseSupersededError and its result is dropped.
 *      The result goes through modules/output annotate() (T57).
 *   4b. draft / setDraft(text): the input text, kept while the user moves
 *      between pages or waits for the model (InputPage; T56).
 *   5. Shared state: model status (idle | checking | no-model | downloading +
 *      progress | loading + progress | ready + model id | failed + reason),
 *      device and model pre-flight reports, library snapshot (catalog,
 *      states, fitness, badges, recommended, active id), last result, last
 *      removal notice. subscribe()/getSnapshot() with immutable snapshots;
 *      `library` keeps its identity while only the status changes.
 *      Download progress notifies at most every PROGRESS_NOTIFY_STEP.
 *   6. retryLoad(): rerun the failed step (start, or chooseModel for the
 *      failed model).
 *   7. Tests in parserService.test.ts with mocked modules and worker: blocked
 *      pre-flight never creates the worker; nothing is downloaded before a
 *      choice; parseText() rejects before `ready`; switching unloads first;
 *      deleting the active model unloads it.
 *
 * Dependencies:
 *   Internal: modules/input, modules/preflight, modules/modelLibrary,
 *             modules/parser (index.ts only); core/environment
 *             (requestPersistentStorage). Injected through ParserServiceDeps.
 *   No React imports; no other services.
 *   Used by: hooks/useParser.ts, hooks/useModelLibrary.ts.
 *
 * Status: implemented (T52; annotation and draft T56/T57). Tests: parserService.test.ts.
 */

import { requestPersistentStorage } from "../core/environment";
import { type Annotation, annotate } from "../modules/output";
import { type PreprocessResult, preprocess } from "../modules/input";
import {
  type CardBadge,
  type Catalog,
  type CatalogEntry,
  type DownloadProgress,
  ModelDownloadError,
  type ModelId,
  type ModelState,
  type VariantName,
  cancelDownload,
  cardBadges,
  clearChoice,
  clearLoading,
  deleteModel,
  downloadBytes,
  downloadModel,
  getModelStates,
  getSavedChoice,
  interruptedLoad,
  loadCatalog,
  markLoading,
  recommendModel,
  requirementsOf,
  saveChoice,
  variantFor,
} from "../modules/modelLibrary";
import {
  type ComputeBackend,
  type LoadFailureReason,
  type ModelRef,
  type ParseResult,
  type ParserClient,
  ParserLoadError,
  ParserNotReadyError,
  type WorkerStatus,
  createParserWorker,
} from "../modules/parser";
import {
  type DeviceAssessment,
  MAX_INTEGRITY_RETRIES,
  type ModelFitness,
  PARSE_BUDGET_SECONDS,
  type PreflightReport,
  assessModels,
  runDeviceChecks,
  runModelChecks,
} from "../modules/preflight";

export type { CardBadge, CatalogEntry, ModelFitness, ModelId, ModelState, ParseResult, PreflightReport };
export type {
  AnnotatedNode,
  AnnotatedPhraseNode,
  AnnotatedSentence,
  AnnotatedToken,
  AnnotatedWordNode,
  Annotation,
  CategoryKind,
  ChunkKind,
  FlatSegment,
  Fork,
  Reading,
  ReadingNote,
  RoleKind,
} from "../modules/output";
export type { CheckResult, CheckStatus } from "../modules/preflight";
export type { RemovalReport, PreprocessResult } from "../modules/input";
export { InputTooLongError, MAX_INPUT_CHARS } from "../modules/input";
export { ParserNotReadyError } from "../modules/parser";

/** Fraction of a download between progress notifications (keeps re-renders rare). */
export const PROGRESS_NOTIFY_STEP = 0.01;
/** Folder of the model files on the app's origin (functions/models; T12). */
const MODELS_BASE = "/models/";

/**
 * Why the parser is unavailable: the worker's load reasons plus `storage` (a download did not
 * fit in the browser's storage) and `crashed` (the page died while loading this model in the
 * previous visit, so it was not loaded again by itself; T96).
 */
export type FailureReason = LoadFailureReason | "storage" | "crashed";

/** Model status (architecture.md → Model readiness). */
export type ModelStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "no-model" }
  | { state: "downloading"; modelId: ModelId; bytesDone: number; bytesTotal: number }
  | { state: "loading"; modelId: ModelId; phase: "download" | "initialize"; progress: number | null }
  | { state: "ready"; modelId: ModelId; backend: ComputeBackend; modelVersion: string }
  | { state: "failed"; modelId: ModelId | null; reason: FailureReason; message: string };

/** The model library as shown on ModelsPage (null fields until the catalog has loaded). */
export type LibrarySnapshot = {
  catalog: Catalog | null;
  states: Readonly<Record<ModelId, ModelState>>;
  fitness: readonly ModelFitness[];
  badges: Readonly<Record<ModelId, CardBadge[]>>;
  recommendedId: ModelId | null;
  /** Download size per model for the variant this device would use (null if none fits). */
  downloadBytes: Readonly<Record<ModelId, number | null>>;
  /** Model loaded in the worker (ready), or null. */
  activeId: ModelId | null;
};

export type ParserSnapshot = {
  status: ModelStatus;
  /** Device stage report (null until checked). */
  preflight: PreflightReport | null;
  /** Model stage report of the last chosen model (null until a model is checked). */
  modelChecks: PreflightReport | null;
  library: LibrarySnapshot;
  /** Annotation of the last parse (modules/output). */
  annotation: Annotation | null;
  /** Input text being edited (kept across pages). */
  draft: string;
  /** What the preprocessor removed from the last parsed input (null if nothing). */
  notice: PreprocessResult | null;
};

export type ParseOutcome = { annotation: Annotation; input: PreprocessResult };

/** A chosen model is not in the catalog or is blocked on this device. */
export class ModelUnavailableError extends Error {
  readonly modelId: ModelId;
  readonly reason: "unknown" | "blocked" | "not-started";
  constructor(modelId: ModelId, reason: "unknown" | "blocked" | "not-started") {
    super(`model ${modelId} cannot be chosen (${reason})`);
    this.name = "ModelUnavailableError";
    this.modelId = modelId;
    this.reason = reason;
  }
}

/** A newer parse (or model change) replaced this one; callers may ignore it. */
export class ParseSupersededError extends Error {
  constructor() {
    super("a newer parse replaced this one");
    this.name = "ParseSupersededError";
  }
}

/** A newer model choice replaced this one (internal control flow). */
class SupersededChoice extends Error {}

export type ParserService = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ParserSnapshot;
  start(): Promise<void>;
  chooseModel(id: ModelId): Promise<void>;
  downloadModel(id: ModelId): Promise<void>;
  cancelDownload(id: ModelId): Promise<void>;
  deleteModel(id: ModelId): Promise<void>;
  retryLoad(): Promise<void>;
  parseText(raw: string): Promise<ParseOutcome>;
  setDraft(text: string): void;
};

/** Everything the service calls (module functions; injectable for tests). */
export type ParserServiceDeps = {
  runDeviceChecks: () => Promise<DeviceAssessment>;
  runModelChecks: typeof runModelChecks;
  assessModels: typeof assessModels;
  loadCatalog: () => Promise<Catalog>;
  getModelStates: typeof getModelStates;
  downloadModel: typeof downloadModel;
  cancelDownload: typeof cancelDownload;
  deleteModel: typeof deleteModel;
  getSavedChoice: (catalog: Catalog) => Promise<ModelId | null>;
  saveChoice: (id: ModelId) => Promise<void>;
  clearChoice: () => Promise<void>;
  /** Crash guard (T96): the model being loaded, kept in storage until the load ends. */
  markLoading: (id: ModelId) => Promise<void>;
  clearLoading: () => Promise<void>;
  interruptedLoad: () => Promise<ModelId | null>;
  createWorker: () => ParserClient;
  requestPersistentStorage: () => Promise<boolean>;
  preprocess: (raw: string) => PreprocessResult;
};

const defaultDeps: ParserServiceDeps = {
  runDeviceChecks: () => runDeviceChecks(),
  runModelChecks,
  assessModels,
  loadCatalog: () => loadCatalog(),
  getModelStates,
  downloadModel,
  cancelDownload,
  deleteModel,
  getSavedChoice: (catalog) => getSavedChoice(catalog),
  saveChoice: (id) => saveChoice(id),
  clearChoice: () => clearChoice(),
  markLoading: (id) => markLoading(id),
  clearLoading: () => clearLoading(),
  interruptedLoad: () => interruptedLoad(),
  createWorker: createParserWorker,
  requestPersistentStorage,
  preprocess: (raw) => preprocess(raw),
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const EMPTY_LIBRARY: LibrarySnapshot = {
  catalog: null,
  states: {},
  fitness: [],
  badges: {},
  recommendedId: null,
  downloadBytes: {},
  activeId: null,
};

/** Create the service (tests pass mocked modules and worker). */
export function createParserService(overrides: Partial<ParserServiceDeps> = {}): ParserService {
  const deps: ParserServiceDeps = { ...defaultDeps, ...overrides };
  let snapshot: ParserSnapshot = {
    status: { state: "idle" },
    preflight: null,
    modelChecks: null,
    library: EMPTY_LIBRARY,
    annotation: null,
    notice: null,
    draft: "",
  };
  const listeners = new Set<() => void>();
  let starting: Promise<void> | null = null;
  let device: DeviceAssessment | null = null;
  let worker: ParserClient | null = null;
  /** Model whose load the service is driving (worker loading statuses map to it). */
  let target: ModelId | null = null;
  /** Incremented by every choice; older choices stop at their next step. */
  let choiceSeq = 0;
  let parseSeq = 0;
  let persistAsked = false;

  const set = (patch: Partial<ParserSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const l of listeners) l();
  };
  const setLibrary = (patch: Partial<LibrarySnapshot>): void => set({ library: { ...snapshot.library, ...patch } });
  /** Models that failed to load on this device (not for network reasons): the recommendation skips them (T43). */
  const failedHere = new Set<ModelId>();
  const setStatus = (status: ModelStatus): void => {
    if (status.state === "failed" && status.modelId && status.reason !== "network") failedHere.add(status.modelId);
    if (status.state === "ready") failedHere.delete(status.modelId);
    set({ status });
    const catalog = snapshot.library.catalog;
    if (catalog && (status.state === "failed" || status.state === "ready")) {
      const recommendedId = recommendModel(catalog, snapshot.library.fitness, PARSE_BUDGET_SECONDS, failedHere);
      if (recommendedId !== snapshot.library.recommendedId) setLibrary({ recommendedId });
    }
  };

  const catalogEntry = (id: ModelId): CatalogEntry | undefined =>
    snapshot.library.catalog?.models.find((m) => m.id === id);
  const preferredVariant = (): VariantName => (device?.report.backendHint === "webgpu" ? "fp16" : "int8");
  const variantOf = (entry: CatalogEntry): VariantName | null =>
    snapshot.library.fitness.find((f) => f.id === entry.id)?.variant ??
    variantFor(entry, device?.report.backendHint ?? "wasm");

  async function refreshStates(): Promise<void> {
    const catalog = snapshot.library.catalog;
    if (catalog) setLibrary({ states: await deps.getModelStates(catalog, preferredVariant()) });
  }

  /** Status after the chosen model's work stopped: the still-loaded model, else no-model. */
  function settledStatus(): ModelStatus {
    const ws = worker?.status();
    if (ws?.state === "ready")
      return { state: "ready", modelId: ws.modelId, backend: ws.backend, modelVersion: ws.modelVersion };
    return { state: "no-model" };
  }

  function onWorkerStatus(ws: WorkerStatus): void {
    if (ws.state === "loading" && ws.modelId === target) {
      setStatus({ state: "loading", modelId: ws.modelId, phase: ws.phase, progress: ws.progress });
    } else if (ws.state === "failed" && snapshot.status.state === "ready" && ws.modelId === snapshot.status.modelId) {
      // The worker died after loading (crash, lost device): the model is gone.
      setLibrary({ activeId: null });
      setStatus({ state: "failed", modelId: ws.modelId, reason: ws.reason, message: ws.message });
    }
  }

  function ensureWorker(): ParserClient {
    if (!worker) {
      worker = deps.createWorker();
      worker.onStatus(onWorkerStatus);
    }
    return worker;
  }

  /** Download progress → library state (and the status if it is the chosen model), throttled. */
  function progressFor(entry: CatalogEntry, variant: VariantName, seq: number | null): DownloadProgress {
    let last = -1;
    return (bytesDone, bytesTotal) => {
      const fraction = bytesTotal > 0 ? bytesDone / bytesTotal : 1;
      if (fraction < 1 && fraction - last < PROGRESS_NOTIFY_STEP) return;
      last = fraction;
      const states = {
        ...snapshot.library.states,
        [entry.id]: { state: "downloading", bytesDone, bytesTotal, variant },
      };
      const patch: Partial<ParserSnapshot> = { library: { ...snapshot.library, states } as LibrarySnapshot };
      if (seq !== null && seq === choiceSeq && target === entry.id) {
        patch.status = { state: "downloading", modelId: entry.id, bytesDone, bytesTotal };
      }
      set(patch);
    };
  }

  /** Download one variant (verified), then refresh states and ask for persistent storage once. */
  async function fetchModel(entry: CatalogEntry, variant: VariantName, seq: number | null): Promise<void> {
    try {
      await deps.downloadModel(entry, variant, progressFor(entry, variant, seq));
    } finally {
      await refreshStates();
    }
    if (!persistAsked && device?.probe.persisted !== true) {
      persistAsked = true;
      await deps.requestPersistentStorage();
    }
  }

  const assertCurrent = (seq: number): void => {
    if (seq !== choiceSeq) throw new SupersededChoice();
  };

  /** Steps 2a–2c for one model (see the header). */
  async function activate(entry: CatalogEntry, seq: number): Promise<void> {
    if (!device) throw new ModelUnavailableError(entry.id, "not-started");
    const variant = variantOf(entry);
    if (!variant) throw new ModelUnavailableError(entry.id, "blocked");
    const state = snapshot.library.states[entry.id];
    if (state?.state !== "downloaded" || state.variant !== variant) {
      setStatus({ state: "downloading", modelId: entry.id, bytesDone: 0, bytesTotal: 0 });
      await fetchModel(entry, variant, seq);
      assertCurrent(seq);
    }
    const base = `${MODELS_BASE}${entry.folder}/`;
    for (let attempt = 0; ; attempt++) {
      setStatus({ state: "loading", modelId: entry.id, phase: "initialize", progress: null });
      const checked = await deps.runModelChecks(base, device);
      assertCurrent(seq);
      set({ modelChecks: checked.report });
      if (checked.report.verdict !== "blocked") break;
      if (checked.corrupt.length === 0 || attempt >= MAX_INTEGRITY_RETRIES) {
        await refreshStates();
        throw new ParserLoadError("invalid-model", `${entry.id} failed the model checks`);
      }
      // Corrupt files were deleted by the checks: fetch them once more (T24).
      setStatus({ state: "downloading", modelId: entry.id, bytesDone: 0, bytesTotal: 0 });
      await fetchModel(entry, variant, seq);
      assertCurrent(seq);
    }
    const ref: ModelRef = { id: entry.id, folder: entry.folder, variant, nestedView: entry.nested_view };
    const client = ensureWorker();
    setLibrary({ activeId: null });
    // Crash guard (T96): if the page dies inside this load (a phone killing the tab for memory),
    // the mark survives and the next start does not load the model again by itself.
    await deps.markLoading(entry.id).catch(() => undefined);
    try {
      await client.load(ref);
    } finally {
      await deps.clearLoading().catch(() => undefined);
    }
    assertCurrent(seq);
    const ws = client.status();
    const backend = ws.state === "ready" ? ws.backend : "wasm";
    const modelVersion = ws.state === "ready" ? ws.modelVersion : entry.model_version;
    setLibrary({ activeId: entry.id });
    setStatus({ state: "ready", modelId: entry.id, backend, modelVersion });
    await deps.saveChoice(entry.id);
  }

  function failureOf(e: unknown): FailureReason {
    if (e instanceof ParserLoadError) return e.reason;
    if (e instanceof ModelDownloadError) {
      if (e.reason === "integrity") return "invalid-model";
      if (e.reason === "quota") return "storage";
      return "network";
    }
    return "invalid-model";
  }

  /** chooseModel after start() (start itself calls this for the saved choice). */
  async function chooseNow(id: ModelId): Promise<void> {
    const entry = catalogEntry(id);
    if (!entry) throw new ModelUnavailableError(id, "unknown");
    if (snapshot.library.fitness.find((f) => f.id === id)?.verdict === "blocked") {
      throw new ModelUnavailableError(id, "blocked");
    }
    const previous = target;
    const seq = ++choiceSeq;
    target = id;
    if (previous && previous !== id && snapshot.status.state === "downloading") {
      await deps.cancelDownload(previous);
    }
    try {
      await activate(entry, seq);
    } catch (e) {
      if (e instanceof SupersededChoice) return;
      if (seq !== choiceSeq) return;
      if (e instanceof ModelDownloadError && e.reason === "cancelled") {
        setStatus(settledStatus());
        return;
      }
      if (e instanceof ModelUnavailableError) throw e;
      setStatus({ state: "failed", modelId: id, reason: failureOf(e), message: messageOf(e) });
      throw e;
    }
  }

  async function choose(id: ModelId): Promise<void> {
    await start();
    return chooseNow(id);
  }

  function start(): Promise<void> {
    starting ??= (async () => {
      setStatus({ state: "checking" });
      device = await deps.runDeviceChecks();
      set({ preflight: device.report });
      if (device.report.verdict === "blocked") {
        setStatus({ state: "failed", modelId: null, reason: "unsupported", message: "device checks failed" });
        return;
      }
      let catalog: Catalog;
      try {
        catalog = await deps.loadCatalog();
      } catch (e) {
        setStatus({ state: "failed", modelId: null, reason: "network", message: messageOf(e) });
        return;
      }
      const fitness = deps.assessModels(catalog.models.map(requirementsOf), device);
      const states = await deps.getModelStates(catalog, preferredVariant());
      setLibrary({
        catalog,
        states,
        fitness,
        badges: cardBadges(catalog, fitness),
        recommendedId: recommendModel(catalog, fitness, PARSE_BUDGET_SECONDS),
        downloadBytes: Object.fromEntries(
          catalog.models.map((m) => {
            const v =
              fitness.find((f) => f.id === m.id)?.variant ?? variantFor(m, device?.report.backendHint ?? "wasm");
            return [m.id, v ? downloadBytes(m, v) : null];
          }),
        ),
      });
      const saved = await deps.getSavedChoice(catalog);
      const crashed = await deps.interruptedLoad().catch(() => null);
      if (crashed) {
        // The previous visit ended while this model was loading: do not repeat it automatically.
        await deps.clearLoading().catch(() => undefined);
        if (catalogEntry(crashed)) {
          target = crashed;
          setStatus({
            state: "failed",
            modelId: crashed,
            reason: "crashed",
            message: "the page closed while this model was loading",
          });
          return;
        }
      }
      const savedEntry = saved ? catalogEntry(saved) : undefined;
      const fit = fitness.find((f) => f.id === saved);
      const savedState = saved ? states[saved] : undefined;
      if (savedEntry && fit?.verdict !== "blocked" && savedState?.state === "downloaded") {
        // A failed automatic load leaves the failed status for retryLoad; start() itself resolves.
        await chooseNow(savedEntry.id).catch(() => undefined);
      } else {
        setStatus({ state: "no-model" });
      }
    })();
    return starting;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start,
    chooseModel: choose,

    async downloadModel(id) {
      await start();
      const entry = catalogEntry(id);
      if (!entry) throw new ModelUnavailableError(id, "unknown");
      const variant = variantOf(entry);
      if (!variant || snapshot.library.fitness.find((f) => f.id === id)?.verdict === "blocked") {
        throw new ModelUnavailableError(id, "blocked");
      }
      try {
        await fetchModel(entry, variant, null);
      } catch (e) {
        if (e instanceof ModelDownloadError && e.reason === "cancelled") return;
        throw e;
      }
    },

    async cancelDownload(id) {
      await deps.cancelDownload(id);
      await refreshStates();
    },

    async deleteModel(id) {
      const entry = catalogEntry(id);
      if (!entry) throw new ModelUnavailableError(id, "unknown");
      if (target === id) {
        // Stop any work for this model; the next choice starts fresh.
        choiceSeq++;
        target = null;
      }
      const ws = worker?.status();
      const loaded = ws && ws.state !== "idle" && ws.modelId === id;
      if (loaded && worker) {
        await worker.unload();
        setLibrary({ activeId: null });
        setStatus({ state: "no-model" });
      } else if (snapshot.status.state !== "ready" && "modelId" in snapshot.status && snapshot.status.modelId === id) {
        setStatus(settledStatus());
      }
      if ((await deps.getSavedChoice(snapshot.library.catalog as Catalog)) === id) await deps.clearChoice();
      await deps.deleteModel(entry);
      await refreshStates();
    },

    async retryLoad() {
      const s = snapshot.status;
      if (s.state !== "failed") return;
      if (s.modelId === null) {
        starting = null;
        return start();
      }
      return choose(s.modelId);
    },

    setDraft(text) {
      if (text !== snapshot.draft) set({ draft: text });
    },

    async parseText(raw) {
      const ws = worker?.status();
      if (snapshot.status.state !== "ready" || !worker || ws?.state !== "ready") throw new ParserNotReadyError();
      const seq = ++parseSeq;
      const input = deps.preprocess(raw);
      const result = await worker.parse(input.text);
      if (seq !== parseSeq) throw new ParseSupersededError();
      const annotation = annotate(result, input.text);
      set({ annotation, notice: input.hasRemovals ? input : null });
      return { annotation, input };
    },
  };
}

/** The app's parser service (created on first use). */
let shared: ParserService | null = null;
export function parserService(): ParserService {
  shared ??= createParserService();
  return shared;
}
