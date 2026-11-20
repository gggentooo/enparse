/**
 * src/modules/parser/phraseLabeler.ts — nested phrase role and head labeler
 *
 * Description:
 *   Deterministic post-processor that enriches the nested phrase tree built by
 *   ./treeDecoder.ts with learner-facing grammatical roles (Subject, Predicate,
 *   Object, Indirect Object, Complement, Modifier, etc.), clause vs. predicate
 *   categories (S vs. VP), and explicit head-of-parent markers (isHead). Uses
 *   only the model's predicted dependency tree (heads, relations, UPOS) and
 *   never overrides attachments with hand-written grammar rules.
 *
 * Layer: modules/ (parser). Internal submodule; runs inside parser.worker.ts.
 *
 * Conventions (owner, 2026-11-20; T10):
 *   - Roles: Subject, Predicate, Object, Indirect Object, Complement,
 *     Modifier (adjective/adverb type), plus roles from the kept UD
 *     subtypes: Passive subject (nsubj:pass), Agent (obl:agent, the
 *     "by" phrase), Relative clause (acl:relcl), Possessive (nmod:poss),
 *     Particle (compound:prt).
 *   - Clause: subject + predicate are promoted to S (Clause); the inner
 *     predicate projection is VP(Predicate). Embedded clauses are shown too.
 *   - Single-word head wrappers ([dog] inside [red dog]) are collapsed for
 *     display; treeDecoder.ts spans and the metrics are unchanged.
 *   - Discontinuous predicates (contiguous: false; questions, inversion,
 *     fronted adjuncts): the pieces get the same role label and a "split
 *     predicate" flag; no contiguous bracket is invented.
 *   - Copula: cop + the predicative word form VP(Predicate); the adjective
 *     or noun is labeled Complement (sentence pattern 2).
 *   - Coordination: the outer bracket of the conjoined phrases takes the
 *     shared role; each conjunct is marked as coordinated (never a
 *     modifier of the first conjunct).
 *
 * Tasks:
 *   1. labelPhrases(phrases, tree, upos): SentencePhrases — pure pass over the
 *      nested phrase tree from ./treeDecoder.ts that attaches grammatical role,
 *      clause/predicate category, and head-constituent metadata without
 *      altering dependency attachments.
 *   2. Head-of-parent marking (isHead): for each PhraseNode, mark the child
 *      carrying parent.head (child.head === parent.head or { word: parent.head })
 *      as the head constituent of its parent phrase (e.g., [red dog] marked as
 *      NP and head of [The red dog]).
 *   3. Grammatical role mapping: assign role on each dependent's maximal
 *      (outermost) projection from tree.relations[node.head] (nsubj/csubj →
 *      Subject, obj → Object, iobj → Indirect Object, ccomp/xcomp → Complement,
 *      obl/advmod/advcl/amod/nmod/acl → Modifier, etc.). Inner projections of
 *      the same head keep their phrase type and isHead: true without repeating
 *      the outer role.
 *   4. Clause (S) vs. Predicate (VP(Predicate)): when a clause head attaches
 *      its nsubj/csubj dependent, mark the inner head projection as
 *      VP(Predicate) (e.g., [rarely barks loudly]) and promote the outer node
 *      to S (Clause).
 *   5. Copula predicates: when a nominal, adjectival, or adverbial clause head
 *      has a `cop` dependent (e.g., "The red dog is happy"), label the
 *      projection combining `cop` + head as VP(Predicate) and mark the inner
 *      complement accordingly.
 *   6. Coordination (conj + cc): handle UD head-initial coordination so
 *      coordinated phrases (e.g., [The red dog and the black cat]) share one
 *      outer grammatical role instead of labeling the second conjunct as a
 *      modifier of the first.
 *   7. Discontinuous predicates and confidence-gated brackets: preserve
 *      contiguous: false on split predicates (questions, subject-auxiliary
 *      inversion, fronted adjuncts) without forcing invalid contiguous spans;
 *      respect brackets collapsed by confidence gating (do not invent roles
 *      for collapsed spans).
 *   8. Single-word head wrappers: mark innermost single-word head wrappers
 *      ([dog] inside [red dog]) so the output layer collapses them for display.
 *   9. Unit tests in phraseLabeler.test.ts: declarative SVO ("The red dog
 *      rarely barks loudly"), copula, ditransitive, embedded clauses,
 *      coordination, questions/inversion (non-contiguous), and collapsed
 *      low-confidence brackets.
 *
 * Dependencies:
 *   Internal: ./types.ts (SentencePhrases, PhraseNode, PhraseType, PhraseRole,
 *             DecodedTree). External: none.
 *   Input produced by: ./treeDecoder.ts (buildPhrases, decodeArcTree, gatePhrases).
 *   Used by: ./parser.ts, ./ambiguity.ts (alternative trees).
 *
 * Caveats:
 *   - Accuracy is strictly bounded by the neural model's UAS/LAS; wrong
 *     attachments or misclassified relations propagate into wrong roles.
 *   - Biaffine models (labels.json schema v2) predict ten subtypes (owner, 2026-11-19):
 *     nsubj:pass, aux:pass, obl:agent, acl:relcl, nmod:poss, compound:prt,
 *     obl:unmarked, det:predet, advcl:relcl, cc:preconj (plan-training.md →
 *     Nested phrase structure → Head encoding). Rare ones (cc:preconj,
 *     advcl:relcl, det:predet) are less reliable.
 *
 * Open items (todo.md): roles on confidence-gated brackets (T59); grammar
 *   label language (T18).
 *
 * Status: header only; not implemented.
 */
