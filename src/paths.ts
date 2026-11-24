/**
 * src/paths.ts — page paths of the hash router
 *
 * Description:
 *   One list of page paths shared by routes.tsx and Layout/Sidebar.tsx (kept
 *   apart from routes.tsx so components can import it without a cycle).
 *
 * Dependencies: none. Used by: src/routes.tsx, components/Layout/Sidebar.tsx, and pages that link
 *   with query parameters (OutputPage, CreateWordList, VocabPage).
 *
 * Status: implemented (T39).
 */

/** Page paths (#/input, …). */
export const PATHS = {
  input: "/input",
  output: "/output",
  vocab: "/vocab",
  dictionary: "/dictionary",
  models: "/models",
  about: "/about",
} as const;

/** Query parameter of #/output that carries a shared result (modules/output share link; T99). */
export const SHARE_PARAM = "s";

/** Query parameter of #/vocab that selects a list (the link after creating one from a text; T106). */
export const VOCAB_LIST_PARAM = "list";
