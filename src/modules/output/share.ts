/**
 * src/modules/output/share.ts — shared parse results: reduced form, link and file codecs (T99)
 *
 * Description:
 *   Lets a learner pass an already-parsed result to someone else, who then
 *   sees it without downloading or running a model. Nothing is uploaded: the
 *   result travels inside a link (after the "#", never sent to a server) or
 *   as a file the learner sends themselves (owner, 2026-11-24).
 *
 *   - Reduced form (SharedParse): the parsed text plus, per sentence, the
 *     main reading only (words, labels, heads, relations, flat chunks, nested
 *     phrases). Probabilities and other readings are dropped; a sentence that
 *     had other readings carries the `otherReadings` flag.
 *   - Link: only for one sentence whose text is shorter than
 *     SHARE_LINK_MAX_CHARS (both conditions; owner). The compact form is
 *     deflated and base64url-encoded.
 *   - File: everything else; the compact form as JSON text.
 *   - Decoding treats the data as untrusted: sizes are capped and every
 *     index, label, and offset is checked before the annotator sees it.
 *
 * Layer: modules/ (output)
 *
 * Dependencies:
 *   Internal: ./types.ts. External: none (CompressionStream is built into
 *   browsers and Node).
 *   Used by: services/parserService.ts (via ./index.ts).
 *
 * Status: implemented (T99). Tests: share.test.ts.
 */

import type { AnnotatorInput, CategoryKind, ChunkKind, InputPhrase, InputWord, RoleKind } from "./types";

/** A link is offered only for text shorter than this (and one sentence); owner, 2026-11-24. */
export const SHARE_LINK_MAX_CHARS = 128;
/** Longest text a shared result may carry (the input limit, modules/input MAX_INPUT_CHARS). */
export const SHARE_MAX_TEXT_CHARS = 5000;
/** Largest share file accepted (a 5,000-character result is far below this). */
export const SHARE_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Longest link payload accepted, and the most it may inflate to. */
export const SHARE_MAX_LINK_CHARS = 8192;
export const SHARE_MAX_LINK_BYTES = 256 * 1024;
/** Format marker and version of the compact form. */
export const SHARE_FORMAT = "enparse-share";
export const SHARE_VERSION = 1;

const MAX_NAME_CHARS = 64;
const MAX_DEPTH = 64;
/** Nested nodes allowed per word of a sentence (a real tree has fewer than two). */
const MAX_NODES_PER_WORD = 4;

const CHUNKS: readonly ChunkKind[] = ["NP", "VP", "PP", "ADJP", "ADVP"];
const CATEGORIES: readonly Exclude<CategoryKind, null>[] = [...CHUNKS, "S"];
const ROLES: readonly RoleKind[] = [
  "Subject",
  "Predicate",
  "Object",
  "Indirect Object",
  "Complement",
  "Modifier",
  "Passive subject",
  "Agent",
  "Relative clause",
  "Possessive",
  "Particle",
];
const UPOS = /^[A-Z]{1,5}$/;
const CHUNK_TAG = /^(?:O|[BI]-(?:NP|VP|PP|ADJP|ADVP))$/;
const RELATION = /^[a-z]{1,12}(?::[a-z]{1,12})?$/;
const FLAGS = {
  isHead: 1,
  coordinated: 2,
  splitPredicate: 4,
  badge: 8,
  uncertain: 16,
  contiguous: 32,
  unsure: 64,
} as const;
const ALL_FLAGS = 127;

/** What a share carries: the annotator's input (main readings only) and the text its offsets refer to. */
export type SharedParse = { input: AnnotatorInput; text: string };

/** How a result is shared: as a link, or as a file. */
export type ShareKind = "link" | "file";

/** Why shared data was refused. */
export type ShareErrorReason = "invalid" | "version" | "too-large" | "unsupported";

/** Thrown when a link or file is not a readable shared result. */
export class ShareFormatError extends Error {
  readonly reason: ShareErrorReason;
  constructor(reason: ShareErrorReason, message: string) {
    super(message);
    this.name = "ShareFormatError";
    this.reason = reason;
  }
}

type InputSentence = AnnotatorInput["sentences"][number];
type InputNode = InputPhrase | InputWord;

// Compact form (arrays keep a link short). Offsets are relative to `t`.
type WireToken = [
  start: number,
  end: number,
  upos: string,
  chunkTag: string,
  head: number,
  relation: string,
  lemma: string | null,
];
type WireChunk = [type: number, start: number, end: number];
type WireWord = [word: number, role: number, flags: number, attachTo: number, attachFrom: number];
type WirePhrase = [
  category: number,
  head: number,
  start: number,
  end: number,
  role: number,
  flags: number,
  attachTo: number,
  attachFrom: number,
  children: WireNode[],
];
type WireNode = WireWord | WirePhrase;
type WireSentence = { a: number; e: number; k: WireToken[]; c: WireChunk[]; p: WireNode[] | null; o?: 1 };
type Wire = {
  f: typeof SHARE_FORMAT;
  v: number;
  m: string;
  mv: string;
  b: "webgpu" | "wasm";
  t: string;
  s: WireSentence[];
};

const isWord = (n: InputNode): n is InputWord => "word" in n;

/** The reduced form of a parse (or of an opened share): main readings only, with the other-readings flag. */
export function toShared(result: AnnotatorInput, text: string): SharedParse {
  const node = (n: InputNode): InputNode => {
    const labels = {
      role: n.role,
      isHead: n.isHead,
      coordinated: n.coordinated,
      splitPredicate: n.splitPredicate,
      badge: n.badge,
      attachTo: n.attachTo,
      attachFrom: n.attachFrom,
      uncertain: n.uncertain,
    };
    if (isWord(n)) return { word: n.word, ...labels };
    return {
      category: n.category,
      head: n.head,
      start: n.start,
      end: n.end,
      contiguous: n.contiguous,
      unsure: n.unsure,
      children: n.children.map(node),
      ...labels,
    };
  };
  const sentences = result.sentences.map((s): InputSentence => {
    const out: InputSentence = {
      start: s.start,
      end: s.end,
      tokens: s.tokens.map((t) => ({
        index: t.index,
        text: t.text,
        start: t.start,
        end: t.end,
        lemma: t.lemma,
        upos: t.upos,
        chunkTag: t.chunkTag,
        head: t.head,
        relation: t.relation,
      })),
      chunks: s.chunks.map((c) => ({ type: c.type, start: c.start, end: c.end })),
      phrases: s.phrases ? s.phrases.map(node) : null,
      alternatives: [],
    };
    return s.alternatives.length > 0 || s.otherReadings === true ? { ...out, otherReadings: true } : out;
  });
  return {
    input: { sentences, modelId: result.modelId, modelVersion: result.modelVersion, backend: result.backend },
    text,
  };
}

/** Whether this runtime can make and read links (deflate is built in; very old browsers lack it). */
export const linkSupported = (): boolean =>
  typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

/** Link only for one sentence shorter than SHARE_LINK_MAX_CHARS; everything else is a file (owner, 2026-11-24). */
export function shareKind(shared: SharedParse): ShareKind {
  const single = shared.input.sentences.length === 1;
  return single && shared.text.length < SHARE_LINK_MAX_CHARS && linkSupported() ? "link" : "file";
}

// -- encoding ----------------------------------------------------------------------------------

function flagsOf(n: InputNode): number {
  let f = 0;
  if (n.isHead) f |= FLAGS.isHead;
  if (n.coordinated) f |= FLAGS.coordinated;
  if (n.splitPredicate) f |= FLAGS.splitPredicate;
  if (n.badge) f |= FLAGS.badge;
  if (n.uncertain) f |= FLAGS.uncertain;
  if (!isWord(n) && n.contiguous) f |= FLAGS.contiguous;
  if (!isWord(n) && n.unsure) f |= FLAGS.unsure;
  return f;
}

function wireNode(n: InputNode): WireNode {
  const role = n.role === null ? -1 : ROLES.indexOf(n.role);
  const to = n.attachTo ?? -1;
  const from = n.attachFrom ?? -1;
  if (isWord(n)) return [n.word, role, flagsOf(n), to, from];
  const category = n.category === null ? -1 : CATEGORIES.indexOf(n.category);
  return [category, n.head, n.start, n.end, role, flagsOf(n), to, from, n.children.map(wireNode)];
}

function toWire({ input, text }: SharedParse): Wire {
  return {
    f: SHARE_FORMAT,
    v: SHARE_VERSION,
    m: input.modelId,
    mv: input.modelVersion,
    b: input.backend,
    t: text,
    s: input.sentences.map((s): WireSentence => {
      const w: WireSentence = {
        a: s.start,
        e: s.end,
        k: s.tokens.map((t): WireToken => [t.start, t.end, t.upos, t.chunkTag, t.head, t.relation, t.lemma]),
        c: s.chunks.map((c): WireChunk => [CHUNKS.indexOf(c.type), c.start, c.end]),
        p: s.phrases ? s.phrases.map(wireNode) : null,
      };
      if (s.otherReadings) w.o = 1;
      return w;
    }),
  };
}

// -- decoding (untrusted data) -----------------------------------------------------------------

const bad = (what: string): never => {
  throw new ShareFormatError("invalid", `shared result: ${what}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** An integer in [min, max]. */
function int(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return bad(what);
  return v;
}
function str(v: unknown, max: number, what: string, pattern?: RegExp): string {
  if (typeof v !== "string" || v.length > max || (pattern && !pattern.test(v))) return bad(what);
  return v;
}
function list(v: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) return bad(what);
  return v;
}

function readNodes(v: unknown, words: number, depth: number, budget: { left: number }): InputNode[] {
  if (depth > MAX_DEPTH) return bad("nesting too deep");
  const last = words - 1;
  return list(v, words * MAX_NODES_PER_WORD, "nodes").map((raw): InputNode => {
    if (--budget.left < 0) return bad("too many nodes");
    const n = list(raw, 9, "node");
    const phrase = n.length === 9;
    if (!phrase && n.length !== 5) return bad("node shape");
    const at = phrase ? 4 : 1;
    const role = int(n[at], -1, ROLES.length - 1, "role");
    const flags = int(n[at + 1], 0, ALL_FLAGS, "flags");
    const to = int(n[at + 2], -1, last, "attachTo");
    const from = int(n[at + 3], -1, last, "attachFrom");
    const labels = {
      role: role < 0 ? null : (ROLES[role] as RoleKind),
      isHead: (flags & FLAGS.isHead) !== 0,
      coordinated: (flags & FLAGS.coordinated) !== 0,
      splitPredicate: (flags & FLAGS.splitPredicate) !== 0,
      badge: (flags & FLAGS.badge) !== 0,
      attachTo: to < 0 ? null : to,
      attachFrom: to < 0 || from < 0 ? null : from,
      uncertain: (flags & FLAGS.uncertain) !== 0,
    };
    if (!phrase) return { word: int(n[0], 0, last, "word"), ...labels };
    const category = int(n[0], -1, CATEGORIES.length - 1, "category");
    const start = int(n[2], 0, last, "phrase start");
    return {
      category: category < 0 ? null : (CATEGORIES[category] as Exclude<CategoryKind, null>),
      head: int(n[1], 0, last, "phrase head"),
      start,
      end: int(n[3], start, last, "phrase end"),
      contiguous: (flags & FLAGS.contiguous) !== 0,
      unsure: (flags & FLAGS.unsure) !== 0,
      children: readNodes(n[8], words, depth + 1, budget),
      ...labels,
    };
  });
}

function readSentence(raw: unknown, text: string, from: number): InputSentence {
  if (!isRecord(raw)) return bad("sentence");
  const start = int(raw.a, from, text.length, "sentence start");
  const end = int(raw.e, start, text.length, "sentence end");
  const rawTokens = list(raw.k, end - start, "words");
  if (rawTokens.length === 0) return bad("sentence without words");
  const count = rawTokens.length;
  let pos = start;
  const tokens = rawTokens.map((rt, index) => {
    const t = list(rt, 7, "word");
    if (t.length !== 7) return bad("word shape");
    const s = int(t[0], pos, end - 1, "word start");
    const e = int(t[1], s + 1, end, "word end");
    pos = e;
    const head = int(t[4], -1, count - 1, "head");
    if (head === index) return bad("word is its own head");
    return {
      index,
      text: text.slice(s, e),
      start: s,
      end: e,
      lemma: t[6] === null ? null : str(t[6], MAX_NAME_CHARS, "lemma"),
      upos: str(t[2], 5, "part of speech", UPOS),
      chunkTag: str(t[3], 6, "chunk tag", CHUNK_TAG),
      head,
      relation: str(t[5], 25, "relation", RELATION),
    };
  });
  const chunks = list(raw.c, count, "chunks").map((rc) => {
    const c = list(rc, 3, "chunk");
    if (c.length !== 3) return bad("chunk shape");
    const s = int(c[1], 0, count - 1, "chunk start");
    return {
      type: CHUNKS[int(c[0], 0, CHUNKS.length - 1, "chunk type")] as ChunkKind,
      start: s,
      end: int(c[2], s, count - 1, "chunk end"),
    };
  });
  const phrases = raw.p === null ? null : readNodes(raw.p, count, 0, { left: count * MAX_NODES_PER_WORD });
  if (raw.o !== undefined && raw.o !== 1) return bad("other-readings flag");
  const sentence: InputSentence = { start, end, tokens, chunks, phrases, alternatives: [] };
  return raw.o === 1 ? { ...sentence, otherReadings: true } : sentence;
}

function fromWire(raw: unknown): SharedParse {
  if (!isRecord(raw) || raw.f !== SHARE_FORMAT) return bad("not an Enparse shared result");
  if (raw.v !== SHARE_VERSION) {
    throw new ShareFormatError("version", `shared result: version ${String(raw.v)} is not supported`);
  }
  const text = str(raw.t, SHARE_MAX_TEXT_CHARS, "text");
  if (raw.b !== "webgpu" && raw.b !== "wasm") return bad("backend");
  let from = 0;
  const sentences = list(raw.s, text.length, "sentences").map((rs) => {
    const s = readSentence(rs, text, from);
    from = s.end;
    return s;
  });
  if (sentences.length === 0) return bad("no sentences");
  return {
    input: {
      sentences,
      modelId: str(raw.m, MAX_NAME_CHARS, "model id"),
      modelVersion: str(raw.mv, MAX_NAME_CHARS, "model version"),
      backend: raw.b,
    },
    text,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return bad("not valid JSON");
  }
}

// -- file --------------------------------------------------------------------------------------

/** The share file's content (JSON text). */
export const encodeShareFile = (shared: SharedParse): string => JSON.stringify(toWire(shared));

/** Read a share file's content; throws ShareFormatError. */
export function decodeShareFile(content: string): SharedParse {
  if (content.length > SHARE_MAX_FILE_BYTES) throw new ShareFormatError("too-large", "shared result: file too large");
  return fromWire(parseJson(content));
}

// -- link --------------------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(data: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(data)) return bad("link data");
  let s: string;
  try {
    s = atob(data.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return bad("link data");
  }
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/** Run bytes through a (de)compression stream, refusing more than `limit` bytes of output. */
async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array> {
  // Failures (damaged data) surface on the reader; the writer's own rejections are the same error.
  const writer = stream.writable.getWriter();
  void writer.write(bytes).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = (stream.readable as ReadableStream<Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ShareFormatError("too-large", "shared result: link data too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The data part of a share link (deflated compact form, base64url). */
export async function encodeShareLink(shared: SharedParse): Promise<string> {
  if (!linkSupported()) throw new ShareFormatError("unsupported", "this browser cannot make share links");
  const json = new TextEncoder().encode(JSON.stringify(toWire(shared)));
  return toBase64Url(await pipe(json, new CompressionStream("deflate-raw"), SHARE_MAX_LINK_BYTES));
}

/** Read the data part of a share link; throws ShareFormatError. */
export async function decodeShareLink(data: string): Promise<SharedParse> {
  if (!linkSupported()) throw new ShareFormatError("unsupported", "this browser cannot read share links");
  if (data.length > SHARE_MAX_LINK_CHARS) throw new ShareFormatError("too-large", "shared result: link too long");
  let json: Uint8Array;
  try {
    json = await pipe(fromBase64Url(data), new DecompressionStream("deflate-raw"), SHARE_MAX_LINK_BYTES);
  } catch (e) {
    if (e instanceof ShareFormatError) throw e;
    return bad("link data is damaged");
  }
  return fromWire(parseJson(new TextDecoder().decode(json)));
}
