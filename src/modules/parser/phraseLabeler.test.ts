/**
 * src/modules/parser/phraseLabeler.test.ts — unit tests for role, clause, and head labeling (T34)
 *
 * Covers: declarative SVO, copula, ditransitive, passive with agent, embedded clause,
 * imperative, coordination, question (split predicate), and gated (collapsed) brackets.
 */

import { describe, expect, it } from "vitest";
import { labelPhrases, roleOf } from "./phraseLabeler";
import { buildPhrases, gatePhrases } from "./treeDecoder";
import type { LabeledPhrase, LabeledSentencePhrases, LabeledWord } from "./types";

type Sent = { words: string[]; heads: number[]; rels: string[]; upos: string[] };

const label = (s: Sent): LabeledSentencePhrases =>
  labelPhrases(
    buildPhrases(
      s.heads,
      s.upos,
      s.rels.map((r) => r.split(":")[0] as string),
    ),
    s.heads,
    s.rels,
    s.upos,
  );

/** Bracket string with labels: [S … ], [NP:Subject …], word:Role, * = split predicate, & = coordinated, ~ = wrapper, ! = badge. */
function show(items: LabeledSentencePhrases, words: string[]): string {
  const tag = (x: LabeledPhrase | LabeledWord): string =>
    (x.role ? `:${x.role}` : "") + (x.badge ? "!" : "") + (x.splitPredicate ? "*" : "") + (x.coordinated ? "&" : "");
  const one = (x: LabeledPhrase | LabeledWord): string =>
    "word" in x
      ? `${words[x.word]}${tag(x)}`
      : `[${x.category ?? "_"}${tag(x)}${x.wrapper ? "~" : ""} ${x.children.map(one).join(" ")}]`;
  return items.map(one).join(" ");
}

const SVO: Sent = {
  words: ["The", "red", "dog", "rarely", "barks", "loudly", "."],
  heads: [3, 3, 5, 5, 0, 5, 5],
  rels: ["det", "amod", "nsubj", "advmod", "root", "advmod", "punct"],
  upos: ["DET", "ADJ", "NOUN", "ADV", "VERB", "ADV", "PUNCT"],
};

describe("roleOf", () => {
  it("maps subtypes before base relations and gives no role to function words", () => {
    expect(roleOf("nsubj")).toBe("Subject");
    expect(roleOf("nsubj:pass")).toBe("Passive subject");
    expect(roleOf("obl:agent")).toBe("Agent");
    expect(roleOf("obl:unmarked")).toBe("Modifier");
    expect(roleOf("det")).toBeNull();
    expect(roleOf("conj")).toBeNull();
  });
});

describe("labelPhrases", () => {
  it("labels a declarative clause: S, Subject, Predicate, modifiers, heads", () => {
    const out = label(SVO);
    expect(show(out, SVO.words)).toBe(
      "[S [NP:Subject The [NP red:Modifier [NP~ dog]]] [VP:Predicate rarely:Modifier [VP [VP~ barks] loudly:Modifier]]] .",
    );
    const s = out[0] as LabeledPhrase;
    const [subj, pred] = s.children as LabeledPhrase[];
    expect(subj?.isHead).toBe(false);
    expect(pred?.isHead).toBe(true);
    expect(s.role).toBeNull(); // root clause with a subject
  });

  it("keeps spans and order of the input phrases", () => {
    const phrases = buildPhrases(SVO.heads, SVO.upos, SVO.rels);
    const strip = (xs: unknown): unknown =>
      JSON.parse(JSON.stringify(xs), (k, v) =>
        ["category", "role", "isHead", "coordinated", "splitPredicate", "badge", "wrapper"].includes(k) ? undefined : v,
      );
    expect(strip(labelPhrases(phrases, SVO.heads, SVO.rels, SVO.upos))).toEqual(strip(phrases));
  });

  it("labels a copula: cop + predicative word is VP(Predicate), the adjective the Complement", () => {
    const s: Sent = {
      words: ["The", "dog", "is", "very", "happy", "."],
      heads: [2, 5, 5, 5, 0, 5],
      rels: ["det", "nsubj", "cop", "advmod", "root", "punct"],
      upos: ["DET", "NOUN", "AUX", "ADV", "ADJ", "PUNCT"],
    };
    expect(show(label(s), s.words)).toBe(
      "[S [NP:Subject The [NP~ dog]] [VP:Predicate is [ADJP:Complement very:Modifier [ADJP~ happy]]]] .",
    );
  });

  it("labels a ditransitive: Indirect Object and Object", () => {
    const s: Sent = {
      words: ["She", "gave", "him", "a", "book"],
      heads: [2, 0, 2, 5, 2],
      rels: ["nsubj", "root", "iobj", "det", "obj"],
      upos: ["PRON", "VERB", "PRON", "DET", "NOUN"],
    };
    expect(show(label(s), s.words)).toBe(
      "[S She:Subject [VP:Predicate [VP [VP~ gave] him:Indirect Object] [NP:Object a [NP~ book]]]]",
    );
  });

  it("labels a passive with its by-agent", () => {
    const s: Sent = {
      words: ["The", "cat", "was", "chased", "by", "the", "dog"],
      heads: [2, 4, 4, 0, 7, 7, 4],
      rels: ["det", "nsubj:pass", "aux:pass", "root", "case", "det", "obl:agent"],
      upos: ["DET", "NOUN", "AUX", "VERB", "ADP", "DET", "NOUN"],
    };
    expect(show(label(s), s.words)).toBe(
      "[S [NP:Passive subject The [NP~ cat]] [VP:Predicate was [VP [VP~ chased] [PP:Agent by [NP the [NP~ dog]]]]]]",
    );
  });

  it("shows an embedded clause as S with its role", () => {
    const s: Sent = {
      words: ["I", "think", "he", "left"],
      heads: [2, 0, 4, 2],
      rels: ["nsubj", "root", "nsubj", "ccomp"],
      upos: ["PRON", "VERB", "PRON", "VERB"],
    };
    expect(show(label(s), s.words)).toBe(
      "[S I:Subject [VP:Predicate [VP~ think] [S:Complement he:Subject [VP:Predicate~ left]]]]",
    );
  });

  it("labels a subjectless root clause (imperative) as the Predicate", () => {
    const s: Sent = {
      words: ["Close", "the", "door"],
      heads: [0, 3, 1],
      rels: ["root", "det", "obj"],
      upos: ["VERB", "DET", "NOUN"],
    };
    expect(show(label(s), s.words)).toBe("[VP:Predicate [VP~ Close] [NP:Object the [NP~ door]]]");
  });

  it("gives coordinated phrases one shared role and marks the conjuncts", () => {
    const s: Sent = {
      words: ["The", "dog", "and", "the", "cat", "sleep"],
      heads: [2, 6, 5, 5, 2, 0],
      rels: ["det", "nsubj", "cc", "det", "conj", "root"],
      upos: ["DET", "NOUN", "CCONJ", "DET", "NOUN", "VERB"],
    };
    expect(show(label(s), s.words)).toBe(
      "[S [NP:Subject The [NP [NP&~ dog] [NP& and [NP the [NP~ cat]]]]] [VP:Predicate~ sleep]]",
    );
  });

  it("marks a question's auxiliary and predicate as split pieces of one predicate", () => {
    const s: Sent = {
      words: ["Does", "the", "dog", "bark", "?"],
      heads: [4, 3, 4, 0, 4],
      rels: ["aux", "det", "nsubj", "root", "punct"],
      upos: ["AUX", "DET", "NOUN", "VERB", "PUNCT"],
    };
    expect(show(label(s), s.words)).toBe("[S Does:Predicate* [S [NP:Subject the [NP~ dog]] [VP:Predicate*~ bark]]] ?");
  });

  it("puts a collapsed bracket's role on its head word as a badge, never on an inner bracket (T59)", () => {
    const phrases = buildPhrases(SVO.heads, SVO.upos, SVO.rels);
    // "The" has an uncertain head: [The red dog], [red dog] (outer dependent), and the clause collapse.
    const gated = gatePhrases(phrases, { heads: SVO.heads, headProbs: [0.3, 1, 1, 1, 1, 1, 1] }, 0.5);
    expect(show(labelPhrases(gated, SVO.heads, SVO.rels, SVO.upos), SVO.words)).toBe(
      "The red:Modifier [NP dog:Subject!] [VP:Predicate rarely:Modifier [VP [VP~ barks] loudly:Modifier]] .",
    );
  });

  it("badges the predicate on the clause head when the VP(Predicate) bracket collapsed", () => {
    const phrases = buildPhrases(SVO.heads, SVO.upos, SVO.rels);
    // "rarely" uncertain: the clause, [rarely barks loudly] (the predicate), and [barks loudly] (outer dependent) collapse.
    const gated = gatePhrases(phrases, { heads: SVO.heads, headProbs: [1, 1, 1, 0.3, 1, 1, 1] }, 0.5);
    expect(show(labelPhrases(gated, SVO.heads, SVO.rels, SVO.upos), SVO.words)).toBe(
      "[NP:Subject The [NP red:Modifier [NP~ dog]]] rarely:Modifier [VP barks:Predicate!] loudly:Modifier .",
    );
  });

  it("hides roles whose head word is below the role threshold", () => {
    const phrases = buildPhrases(SVO.heads, SVO.upos, SVO.rels);
    const confidence = [1, 0.4, 0.4, 1, 1, 0.9, 1]; // red and dog uncertain
    const out = labelPhrases(phrases, SVO.heads, SVO.rels, SVO.upos, { confidence, threshold: 0.5 });
    expect(show(out, SVO.words)).toBe(
      "[S [NP The [NP red [NP~ dog]]] [VP:Predicate rarely:Modifier [VP [VP~ barks] loudly:Modifier]]] .",
    );
  });

  it("returns nothing for an empty sentence", () => {
    expect(labelPhrases([], [], [], [])).toEqual([]);
  });
});
