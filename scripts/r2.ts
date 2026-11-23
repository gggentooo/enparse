/**
 * scripts/r2.ts — the release files in R2: list, upload, verify (T66)
 *
 * Description:
 *   The deployed site serves model files, ONNX Runtime Web, and the dictionary
 *   from one R2 bucket bound to the Pages project as MODELS (architecture.md →
 *   Deployment). This script knows which local file goes to which R2 key:
 *     <folder>/<file>   ← public/models/ (catalog.json and every file it lists;
 *                         written by training/scripts/package_models.py)
 *                         served at /models/<key> by functions/models/[[path]].ts
 *     _ort/<file>       ← node_modules/onnxruntime-web/dist/ (the version
 *                         Transformers.js pins), served at /models/_ort/<file>
 *     dict/v<N>/<file>  ← training/data/dict/v<N>/ (training/dictionary/build.py),
 *                         served at /dict/v<N>/<file> by functions/dict/[[path]].ts
 *   The same list feeds the local preview of the deployed site
 *   (vite.release.ts, `npm run preview:release`).
 *
 * Usage (Node ≥ 23 runs TypeScript directly):
 *   node scripts/r2.ts list
 *   node scripts/r2.ts upload <bucket> [--only models|ort|dict] [--force] [--dry-run]
 *       Uploads with Wrangler (`npx wrangler r2 object put --remote`; log in
 *       first with `npx wrangler login`). Files already uploaded from this
 *       machine with the same SHA-256 are skipped (record:
 *       training/data/release/r2-uploaded.json, git-ignored); --force uploads all.
 *       catalog.json is uploaded last, so the app never lists a model whose
 *       files are not there yet.
 *   node scripts/r2.ts verify <site URL>
 *       Checks every file on the deployed site: size from HEAD, and SHA-256 of
 *       the JSON files. Behind Cloudflare Access, set CF_ACCESS_CLIENT_ID and
 *       CF_ACCESS_CLIENT_SECRET (a service token) or run it before enabling Access.
 *
 * Layer: build tooling (never part of the app bundle).
 * Dependencies: Node only; Wrangler is fetched by npx when uploading (not a
 *   project dependency; agents.md → Dependency policy).
 *
 * Status: implemented (T66).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
export const MODELS_DIR = join(REPO, "public", "models");
export const ORT_DIR = join(REPO, "node_modules", "onnxruntime-web", "dist");
export const DICT_DIR = join(REPO, "training", "data", "dict");
const STATE = join(REPO, "training", "data", "release", "r2-uploaded.json");
/** Same names as src/modules/parser/transformerBackend.ts (ORT_FOLDER, ORT_WASM_FILE). */
const ORT_FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: "application/json",
  mjs: "text/javascript",
  wasm: "application/wasm",
};

export type Group = "models" | "ort" | "dict";
/** One R2 object: its key, the local file, and the URL path it is served at. */
export type ReleaseObject = { key: string; path: string; url: string; group: Group };

type FileRef = { file: string };
type CatalogEntry = { folder: string; labels: FileRef; variants: Record<string, FileRef>; shared_files: FileRef[] };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : d.isFile() ? [join(dir, d.name)] : [],
  );
}

/** Every object of the release; missing inputs are reported in `missing`. */
export function releaseObjects(): { objects: ReleaseObject[]; missing: string[] } {
  const objects: ReleaseObject[] = [];
  const missing: string[] = [];
  const model = (key: string, path: string): void => {
    objects.push({ key, path, url: `/models/${key}`, group: key.startsWith("_ort/") ? "ort" : "models" });
  };
  const catalogPath = join(MODELS_DIR, "catalog.json");
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { models: CatalogEntry[] };
    for (const m of catalog.models) {
      for (const f of [m.labels, ...Object.values(m.variants), ...m.shared_files]) {
        model(`${m.folder}/${f.file}`, join(MODELS_DIR, m.folder, f.file));
      }
    }
    model("catalog.json", catalogPath); // last: uploaded after the files it lists
  } else missing.push(`${relative(REPO, catalogPath)} (run training/scripts/package_models.py)`);
  for (const f of ORT_FILES) model(`_ort/${f}`, join(ORT_DIR, f));
  const versions = existsSync(DICT_DIR) ? readdirSync(DICT_DIR).filter((d) => /^v\d+$/.test(d)) : [];
  if (versions.length === 0) missing.push(`${relative(REPO, DICT_DIR)}/v<N>/ (run training/dictionary/build.py)`);
  for (const v of versions) {
    // manifest.json last (it points at the other files).
    const files = walk(join(DICT_DIR, v)).sort(
      (a, b) => Number(a.endsWith("manifest.json")) - Number(b.endsWith("manifest.json")),
    );
    for (const path of files) {
      const rel = relative(DICT_DIR, path).split("\\").join("/");
      objects.push({ key: `dict/${rel}`, path, url: `/dict/${rel}`, group: "dict" });
    }
  }
  for (const o of objects) if (!existsSync(o.path)) missing.push(relative(REPO, o.path));
  // catalog.json after the model files, ORT, and the dictionary.
  objects.sort((a, b) => Number(a.key === "catalog.json") - Number(b.key === "catalog.json"));
  return { objects, missing };
}

async function sha256(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

const mb = (n: number): string => `${(n / 1e6).toFixed(1)} MB`;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", fail);
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

function list(objects: ReleaseObject[]): void {
  let total = 0;
  for (const o of objects) {
    const size = existsSync(o.path) ? statSync(o.path).size : 0;
    total += size;
    console.log(`${o.key.padEnd(56)} ${mb(size).padStart(10)}  ← ${relative(REPO, o.path)}`);
  }
  console.log(`${objects.length} objects, ${mb(total)}`);
}

async function upload(objects: ReleaseObject[], bucket: string, force: boolean, dryRun: boolean): Promise<void> {
  const state = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as Record<string, string>) : {};
  let skipped = 0;
  for (const o of objects) {
    const id = `${bucket}/${o.key}`;
    const hash = await sha256(o.path);
    if (!force && state[id] === hash) {
      skipped++;
      continue;
    }
    const size = statSync(o.path).size;
    const type = CONTENT_TYPES[o.key.split(".").pop() ?? ""] ?? "application/octet-stream";
    const args = [
      "--yes",
      "wrangler@4",
      "r2",
      "object",
      "put",
      id,
      "--file",
      o.path,
      "--content-type",
      type,
      "--remote",
    ];
    console.log(`${dryRun ? "[dry run] " : ""}${o.key} (${mb(size)})`);
    if (dryRun) continue;
    await run("npx", args);
    state[id] = hash;
    mkdirSync(dirname(STATE), { recursive: true });
    writeFileSync(STATE, `${JSON.stringify(state, null, 1)}\n`);
  }
  if (skipped) console.log(`${skipped} unchanged objects skipped (--force uploads them again)`);
}

async function verify(objects: ReleaseObject[], site: string): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  let ok = true;
  const fail = (o: ReleaseObject, why: string): void => {
    ok = false;
    console.log(`FAIL ${o.url}: ${why}`);
  };
  for (const o of objects) {
    const url = new URL(o.url, site);
    const size = statSync(o.path).size;
    if (o.path.endsWith(".json")) {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        fail(o, `HTTP ${res.status}`);
        continue;
      }
      const body = Buffer.from(await res.arrayBuffer());
      const want = await sha256(o.path);
      if (createHash("sha256").update(body).digest("hex") !== want) fail(o, "SHA-256 differs from the local file");
      continue;
    }
    const res = await fetch(url, { method: "HEAD", headers });
    if (!res.ok) fail(o, `HTTP ${res.status}`);
    else if (Number(res.headers.get("content-length")) !== size)
      fail(o, `size ${res.headers.get("content-length")} ≠ ${size}`);
  }
  console.log(ok ? `ok: ${objects.length} files match on ${site}` : "verification failed");
  return ok;
}

async function main(argv: string[]): Promise<number> {
  const [command, target] = argv;
  const flag = (name: string): boolean => argv.includes(name);
  const only = argv[argv.indexOf("--only") + 1] as Group | undefined;
  const { objects: all, missing } = releaseObjects();
  const objects = argv.includes("--only") ? all.filter((o) => o.group === only) : all;
  if (command === "list") {
    list(objects);
  } else if (command === "upload" && target) {
    if (missing.length) {
      for (const m of missing) console.error(`missing: ${m}`);
      return 1;
    }
    await upload(objects, target, flag("--force"), flag("--dry-run"));
  } else if (command === "verify" && target) {
    return (await verify(objects, target)) ? 0 : 1;
  } else {
    console.error(
      "usage: node scripts/r2.ts list | upload <bucket> [--only models|ort|dict] [--force] [--dry-run] | verify <site URL>",
    );
    return 2;
  }
  for (const m of missing) console.error(`missing: ${m}`);
  return missing.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = await main(process.argv.slice(2));
}
