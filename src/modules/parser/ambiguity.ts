/**
 * src/modules/parser/ambiguity.ts — alternative parse builder
 *
 * Description:
 *   Builds ranked alternative parses per sentence from low-margin label
 *   probabilities and PP-attachment alternatives from head probabilities.
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Mark words whose top-two label margin < margin from labels.json
 *      (proposed 0.2) as ambiguous.
 *   2. Enumerate alternative label sequences over ambiguous words; keep only
 *      valid BIO sequences; rank by joint probability.
 *   3. Attachment alternatives: top-two head labels within
 *      ambiguity.attachment_margin (labels.json) give alternative trees via
 *      ./treeDecoder.ts.
 *   4. Cap at MAX_ALTERNATIVES = 5 per sentence (exported constant); bound
 *      enumeration cost.
 *   5. Unit tests in ambiguity.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./treeDecoder.ts (alternative trees). External: none.
 *   Data: margins from the loaded model's labels.json (passed in).
 *   Used by: ./parser.ts.
 *
 * Open items (plan.md → Undecided): ambiguity threshold and display;
 *   limit defaults (5 alternatives).
 *
 * Status: header only; not implemented.
 */
