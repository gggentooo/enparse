/**
 * src/modules/output/index.ts — public API of the output module
 *
 * Description:
 *   Builds the render-ready annotation model from parse results. Other
 *   layers import only from this file (agents.md → Module public API).
 *
 * Layer: modules/ (output)
 *
 * Tasks:
 *   1. Re-export annotate() from ./annotator.ts.
 *   2. Re-export public types from ./types.ts.
 *   3. Re-export the shared-result codecs from ./share.ts (T99).
 *
 * Dependencies:
 *   Internal: ./annotator.ts, ./share.ts, ./types.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: implemented (T57; sharing T99).
 */

export { annotate } from "./annotator";
export {
  SHARE_LINK_MAX_CHARS,
  SHARE_MAX_FILE_BYTES,
  SHARE_MAX_TEXT_CHARS,
  ShareFormatError,
  decodeShareFile,
  decodeShareLink,
  encodeShareFile,
  encodeShareLink,
  shareKind,
  toShared,
} from "./share";
export type { ShareErrorReason, ShareKind, SharedParse } from "./share";
export { NEAR_TIE_SHARE } from "./types";
export type {
  AnnotatedNode,
  AnnotatedPhraseNode,
  AnnotatedSentence,
  AnnotatedToken,
  AnnotatedWordNode,
  Annotation,
  AnnotatorInput,
  CategoryKind,
  ChunkKind,
  FlatSegment,
  Fork,
  Reading,
  ReadingNote,
  RoleKind,
} from "./types";
