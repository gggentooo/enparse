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
 *
 * Dependencies:
 *   Internal: ./annotator.ts, ./types.ts.
 *   Used by: services/parserService.ts.
 *
 * Status: implemented (T57).
 */

export { annotate } from "./annotator";
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
  Reading,
  RoleKind,
} from "./types";
