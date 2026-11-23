/**
 * src/modules/modelLibrary/catalog.ts — load and validate the model catalog
 *
 * Description:
 *   Fetches public/models/catalog.json from the app's own static host and
 *   checks it before anything is shown or downloaded. Only models listed in
 *   the catalog can be chosen; training lists only models that meet the
 *   acceptance thresholds (plan-training.md → Phase 11).
 *
 * Layer: modules/ (modelLibrary)
 *
 * Tasks:
 *   1. loadCatalog(): Promise<Catalog> — core/environment fetchStaticJson
 *      (CATALOG_URL); narrow unknown → Catalog; reject unknown
 *      schema_version, duplicate ids, missing files or sizes
 *      (CatalogLoadError).
 *   2. variantFor(entry, backend: "webgpu" | "wasm"): which ONNX file to use
 *      (fp16 for WebGPU, int8 for WASM).
 *   3. modelFiles(entry, variant): Array<{ url, bytes, sha256 }> — every file
 *      the model needs (shared files + the variant's ONNX file + labels.json);
 *      sizes and hashes come from the model's labels.json → files and the
 *      catalog.
 *   4. Constants: CATALOG_URL ("models/catalog.json", relative to the app
 *      base), CATALOG_SCHEMA_VERSION = 1.
 *   5. Unit tests in catalog.test.ts (valid, unknown version, bad entries).
 *
 * Dependencies:
 *   Internal: ./types.ts; core/environment.ts (fetchStaticJson).
 *   Used by: ./index.ts, ./downloads.ts, ./selection.ts.
 *
 * Network: static assets from the app's own host only.
 *
 * Status: implemented (T37). Tests: catalog.test.ts.
 */

import { fetchStaticJson } from "../../core/environment";
import { type Catalog, type CatalogEntry, CatalogLoadError, type FileRef, type VariantName } from "./types";

/** The catalog on the app's own origin (served from R2 by functions/models; T12). */
export const CATALOG_URL = "/models/catalog.json";
export const CATALOG_SCHEMA_VERSION = 1;
const MODELS_BASE = "/models/";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isFile = (v: unknown): v is FileRef =>
  isObj(v) && isStr(v.file) && isNum(v.bytes) && v.bytes > 0 && isStr(v.sha256) && /^[0-9a-f]{64}$/i.test(v.sha256);

/** Problems with one catalog entry (empty = valid). */
export function entryProblems(e: unknown): string[] {
  if (!isObj(e)) return ["not an object"];
  const p: string[] = [];
  for (const k of ["id", "display_name", "description", "base_model", "license", "model_version", "folder"]) {
    if (!isStr(e[k])) p.push(`${k} missing`);
  }
  if (isStr(e.folder) && (e.folder.includes("..") || e.folder.startsWith("/")))
    p.push("folder must be a relative path");
  if (!isFile(e.labels)) p.push("labels file missing or invalid");
  const v = e.variants;
  if (!isObj(v) || (v.int8 === undefined && v.fp16 === undefined)) p.push("no variant");
  else
    for (const name of ["int8", "fp16"])
      if (v[name] !== undefined && !isFile(v[name])) p.push(`variants.${name} invalid`);
  if (!Array.isArray(e.shared_files) || !e.shared_files.every(isFile)) p.push("shared_files invalid");
  const m = e.metrics;
  if (!isObj(m) || !["upos", "chunk_f1", "uas", "las"].every((k) => isNum(m[k]))) p.push("metrics invalid");
  if (typeof e.nested_view !== "boolean") p.push("nested_view missing");
  if (e.description_ko !== undefined && !isStr(e.description_ko)) p.push("description_ko invalid");
  if (e.base_model_license !== undefined && !isStr(e.base_model_license)) p.push("base_model_license invalid");
  // Rendered as a link on the About page: https only (T66).
  if (e.base_model_url !== undefined && !(isStr(e.base_model_url) && /^https:\/\//.test(e.base_model_url)))
    p.push("base_model_url invalid");
  return p;
}

/** Validate unknown JSON as a catalog (CatalogLoadError lists every problem). */
export function parseCatalog(json: unknown): Catalog {
  if (!isObj(json)) throw new CatalogLoadError("catalog.json is not an object");
  if (json.schema_version !== CATALOG_SCHEMA_VERSION) {
    throw new CatalogLoadError(`unsupported catalog schema_version ${String(json.schema_version)}`);
  }
  if (!Array.isArray(json.models)) throw new CatalogLoadError("catalog.json has no models");
  const problems: string[] = [];
  const ids = new Set<string>();
  json.models.forEach((e, i) => {
    for (const p of entryProblems(e)) problems.push(`models[${i}]: ${p}`);
    const id = isObj(e) ? e.id : undefined;
    if (isStr(id)) {
      if (ids.has(id)) problems.push(`models[${i}]: duplicate id ${id}`);
      ids.add(id);
    }
  });
  if (problems.length) throw new CatalogLoadError(`invalid catalog.json: ${problems.join("; ")}`);
  return json as unknown as Catalog;
}

/** Fetch and validate the catalog. */
export async function loadCatalog(fetchJson: (url: string) => Promise<unknown> = fetchStaticJson): Promise<Catalog> {
  let json: unknown;
  try {
    json = await fetchJson(CATALOG_URL);
  } catch (e) {
    throw new CatalogLoadError(`catalog.json could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseCatalog(json);
}

/** Variant for a backend: fp16 on WebGPU, int8 on WASM; falls back to the other if only one ships. */
export function variantFor(entry: CatalogEntry, backend: "webgpu" | "wasm"): VariantName | null {
  const preferred: VariantName = backend === "webgpu" ? "fp16" : "int8";
  if (entry.variants[preferred]) return preferred;
  // fp16 needs WebGPU; int8 runs anywhere.
  if (preferred === "fp16" && entry.variants.int8) return "int8";
  return null;
}

/** Every file of a model for a variant, with absolute same-origin URLs. */
export function modelFiles(entry: CatalogEntry, variant: VariantName): Array<FileRef & { url: string }> {
  const v = entry.variants[variant];
  if (!v) throw new CatalogLoadError(`${entry.id} has no ${variant} variant`);
  const base = `${MODELS_BASE}${entry.folder}/`;
  return [entry.labels, ...entry.shared_files, v].map((f) => ({ ...f, url: base + f.file }));
}

/** Download size of a model for a variant (all its files). */
export function downloadBytes(entry: CatalogEntry, variant: VariantName): number {
  return modelFiles(entry, variant).reduce((s, f) => s + f.bytes, 0);
}

/**
 * Pre-flight input for a catalog entry (structurally preflight's ModelRequirements; built here
 * so the service passes plain data between the modules).
 */
export function requirementsOf(entry: CatalogEntry): {
  id: string;
  variants: { int8?: { bytes: number }; fp16?: { bytes: number } };
  parseSeconds?: { wasm?: number; wasm_2core?: number; wasm_1thread?: number; webgpu?: number };
} {
  const variants: { int8?: { bytes: number }; fp16?: { bytes: number } } = {};
  for (const v of ["int8", "fp16"] as const) if (entry.variants[v]) variants[v] = { bytes: downloadBytes(entry, v) };
  const out: ReturnType<typeof requirementsOf> = { id: entry.id, variants };
  const parse = entry.performance?.parse_5000_chars_s;
  if (parse) out.parseSeconds = parse;
  return out;
}
