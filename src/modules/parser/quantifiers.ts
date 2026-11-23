/**
 * src/modules/parser/quantifiers.ts — display rule for quantity expressions ("a number of")
 *
 * Description:
 *   The models follow UD: in "a number of species", "number" is the head and
 *   "of species" modifies it. Learners are taught "a number of" as a
 *   quantifier of the noun (the verb agrees with "species"). This rule turns
 *   the model's tree into the displayed tree for a closed list of quantity
 *   words; the only hand-written grammar rule in the nested view (owner,
 *   2026-11-23; T73, T77; plan-training.md → Nested phrase structure →
 *   Quantity expressions). The model's tree and Token.head are not changed.
 *
 * Layer: modules/ (parser). Pure; also applied to gold trees by training/js.
 *
 * Rule: a quantity word Q from QUANTITY_WORDS, directly followed by "of",
 *   where "of" is the `case` of a noun N and N is `nmod` of Q:
 *     - N takes Q's head and relation (N heads the phrase);
 *     - Q attaches to N with relation QUANTIFIER_RELATION (role Modifier);
 *     - "of" attaches to Q (relation "fixed");
 *     - Q keeps its article a/an, adjectives, and adverbs; every other
 *       dependent of Q (prepositions, punctuation, clauses) moves to N.
 *   Not applied when Q has a determiner other than a/an or a possessive
 *   ("the number of students"), or for "deal" without "great"/"good".
 *   Result: [to [a number of] species [of fish]].
 *
 * Dependencies: none. Used by: ./phraseLabeler.ts (labeledView);
 *   training/js (nested_eval.mjs, gating_eval.mjs, error_analysis.mjs).
 *
 * Status: implemented (T77). Tests: quantifiers.test.ts.
 */

/** Quantity words (lower case) shown as quantifiers in "<Q> of <noun>" (owner, 2026-11-23). */
export const QUANTITY_WORDS: ReadonlySet<string> = new Set([
  "number",
  "lot",
  "lots",
  "couple",
  "plenty",
  "deal",
  "bit",
  "amount",
  "some",
]);

/** Display relation of a quantity word attached to its noun. */
export const QUANTIFIER_RELATION = "quant";

const ARTICLES = new Set(["a", "an"]);
const DEAL_ADJECTIVES = new Set(["great", "good"]);
/** Dependents that stay inside the quantifier ("a", "great", "quite"). */
const INNER_RELATIONS = new Set(["det", "amod", "advmod"]);

const base = (relation: string): string => relation.split(":")[0] ?? relation;

/** The tree as displayed. */
export type DisplayTree = {
  /** 1-based heads (0 = root). */
  heads: number[];
  /** Full relations (kept subtypes), with QUANTIFIER_RELATION and "fixed" where the rule applied. */
  relations: string[];
  /**
   * Per word, the word whose model attachment its displayed attachment stands for (itself
   * unless the rule swapped it): the noun shows the quantity word's attachment and vice versa.
   */
  source: number[];
};

/**
 * Apply the quantifier rule (see the header).
 * @param heads 1-based heads (0 = root) of the model's (or gold) tree
 * @param relations relation per word (base or with subtypes)
 * @param words word texts
 */
export function displayTree(
  heads: readonly number[],
  relations: readonly string[],
  words: readonly string[],
): DisplayTree {
  const out: DisplayTree = { heads: [...heads], relations: [...relations], source: heads.map((_, i) => i) };
  const lower = words.map((w) => w.toLowerCase());
  const depsOf = (h: number): number[] => out.heads.flatMap((x, d) => (x === h + 1 ? [d] : []));
  for (let q = 0; q < heads.length; q++) {
    if (!QUANTITY_WORDS.has(lower[q] ?? "") || lower[q + 1] !== "of") continue;
    const of = q + 1;
    const noun = (out.heads[of] as number) - 1;
    if (noun <= of || base(out.relations[of] ?? "") !== "case") continue;
    if (out.heads[noun] !== q + 1 || base(out.relations[noun] ?? "") !== "nmod") continue;
    const deps = depsOf(q).filter((d) => d !== noun);
    const inner = (d: number): boolean => {
      const rel = out.relations[d] ?? "";
      if (d > q || !INNER_RELATIONS.has(base(rel)) || rel === "nmod:poss") return false;
      return base(rel) !== "det" || rel === "det:predet" || ARTICLES.has(lower[d] ?? "");
    };
    // Another determiner or a possessive: "the number of …" is a noun, not a quantifier.
    const blocked = deps.some(
      (d) => (base(out.relations[d] ?? "") === "det" && !inner(d)) || out.relations[d] === "nmod:poss",
    );
    if (blocked) continue;
    if (lower[q] === "deal" && !deps.some((d) => DEAL_ADJECTIVES.has(lower[d] ?? ""))) continue;
    out.heads[noun] = out.heads[q] as number;
    out.relations[noun] = out.relations[q] as string;
    out.heads[q] = noun + 1;
    out.relations[q] = QUANTIFIER_RELATION;
    out.heads[of] = q + 1;
    out.relations[of] = "fixed";
    for (const d of deps) if (!inner(d)) out.heads[d] = noun + 1;
    out.source[noun] = q;
    out.source[q] = noun;
  }
  return out;
}
