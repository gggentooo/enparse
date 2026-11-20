/**
 * src/modules/parser/ambiguity.ts — alternative parse builder
 *
 * Description:
 *   Builds ranked alternative parses per sentence from low-margin label
 *   probabilities and PP-attachment alternatives from head probabilities
 *   (biaffine models: the top-two calibrated arc probabilities of a word).
 *
 * Layer: modules/ (parser)
 *
 * Tasks:
 *   1. Mark words whose top-two label margin < margin from labels.json
 *      (proposed 0.2) as ambiguous.
 *   2. Enumerate alternative label sequences over ambiguous words; keep only
 *      valid BIO sequences; rank by joint probability.
 *   3. Attachment alternatives: for obl/nmod words with a case dependent
 *      (PP attachment), the top-two heads within ambiguity.attachment_margin
 *      (labels.json) give alternative trees via ./treeDecoder.ts (MST with
 *      the word's head fixed), labeled with grammatical roles and head markers via
 *      ./phraseLabeler.ts.
 *   4. Cap at MAX_ALTERNATIVES = 5 per sentence (exported constant; owner,
 *      2026-11-20, T09); bound enumeration cost.
 *   5. Unit tests in ambiguity.test.ts.
 *
 * Dependencies:
 *   Internal: ./types.ts, ./treeDecoder.ts (alternative trees),
 *             ./phraseLabeler.ts (role and head labeling on alternative trees).
 *   External: none.
 *   Data: margins from the loaded model's labels.json (passed in).
 *   Used by: ./parser.ts.
 *
 * Margins: labels.json → ambiguity (Phase 8, per model; calibrate.py). Labels
 *   and attachment alternatives share the cap.
 *
 * Open items (todo.md): how alternatives are displayed (T11).
 *
 * Status: MAX_ALTERNATIVES defined (T35); builder pending (T60).
 */

/** Most alternatives shown per sentence, label and attachment together (owner, 2026-11-20; T09). */
export const MAX_ALTERNATIVES = 5;
