/**
 * src/modules/subword/subwordParser.ts — rule-based word segmenter
 *
 * Description:
 *   Splits a word (plus its wink lemma) into prefixes, base, suffixes, and
 *   inflection, e.g. unhappiness → un- + happy + -ness.
 *
 * Layer: modules/ (subword)
 *
 * Tasks:
 *   1. Inflection from lemma: running + run → run + -ing.
 *   2. Strip derivational affixes from ./affixes.ts, longest match first,
 *      with spelling rules (e.g., happi- → happy).
 *   3. Accept a split only if the remaining base is a known word or lemma
 *      (under ≠ un- + der). The known-word check is an injected predicate
 *      (isKnownWord), since this module cannot import modules/dictionary.
 *   4. Return SubwordSegmentation (ordered segments with type and gloss id).
 *   5. Unit tests in subwordParser.test.ts (false splits, stacked affixes).
 *
 * Dependencies:
 *   Internal: ./affixes.ts, ./types.ts. External: none.
 *   Used by: services/subwordService.ts (via ./index.ts).
 *
 * Open items (plan.md → Undecided): affix inventory; source of the
 *   known-word list used for base validation.
 *
 * Status: header only; not implemented.
 */
