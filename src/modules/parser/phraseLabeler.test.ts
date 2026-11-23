/**
 * src/modules/parser/phraseLabeler.test.ts — unit tests for role, clause, head, and attachment labeling (T34, T76)
 *
 * Covers: declarative SVO, copula, ditransitive, passive with agent, embedded clause,
 * imperative, coordination, question (split predicate), attachments (arrows), the owner's
 * "Mackerel" sentences with the quantifier rule, and gated (collapsed) brackets.
 */

import { describe, expect, it } from "vitest";
import { gateLabeled, labelPhrases, labeledView, roleOf } from "./phraseLabeler";
import { displayTree } from "./quantifiers";
import { buildPhrases } from "./treeDecoder";
import type { DecodedTree, LabeledPhrase, LabeledSentencePhrases, LabeledWord } from "./types";

type Sent = { words: string[]; heads: number[]; rels: string[]; upos: string[] };
type Labeled = LabeledPhrase | LabeledWord;

const base = (r: string): string => r.split(":")[0] as string;

/** Labeled phrases of the displayed tree (quantifier rule applied), not gated. */
const label = (s: Sent, gate?: Parameters<typeof labelPhrases>[4]): LabeledSentencePhrases => {
  const shown = displayTree(s.heads, s.rels, s.words);
  return labelPhrases(
    buildPhrases(shown.heads, s.upos, shown.relations.map(base)),
    shown.heads,
    shown.relations,
    s.upos,
    gate,
  );
};

/** Bracket string with labels: [S … ], [NP:Subject …], word:Role, ! = badge, * = split predicate, & = coordinated, ? = uncertain attachment, ~ = unsure pinned bracket. */
function show(items: LabeledSentencePhrases, words: string[]): string {
  const tag = (x: Labeled): string =>
    (x.role ? `:${x.role}` : "") +
    (x.badge ? "!" : "") +
    (x.splitPredicate ? "*" : "") +
    (x.coordinated ? "&" : "") +
    (x.uncertain ? "?" : "");
  const one = (x: Labeled): string =>
    "word" in x
      ? `${words[x.word]}${tag(x)}`
      : `[${x.category ?? "_"}${tag(x)}${x.unsure ? "~" : ""} ${x.children.map(one).join(" ")}]`;
  return items.map(one).join(" ");
}

/** Every attachment as "words → target word". */
function arrows(items: LabeledSentencePhrases, words: string[]): string[] {
  const out: string[] = [];
  const text = (x: Labeled): string => ("word" in x ? (words[x.word] as string) : x.children.map(text).join(" "));
  const walk = (x: Labeled): void => {
    if (x.attachTo !== null)
      out.push(`${text(x)} → ${words.slice(x.attachFrom ?? x.attachTo, x.attachTo + 1).join(" ")}`);
    if (!("word" in x)) x.children.forEach(walk);
  };
  items.forEach(walk);
  return out;
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
      "[NP:Subject The red:Modifier dog] [VP:Predicate rarely:Modifier barks loudly:Modifier] .",
    );
    // The main clause has no bracket of its own: subject and predicate are the outermost, pinned brackets.
    const [subj, pred] = out as LabeledPhrase[];
    expect([subj?.pinned, pred?.pinned]).toEqual([true, true]);
    expect([subj?.level, pred?.level]).toEqual(["phrase", "predicate"]);
    expect(pred?.children.map((c) => c.isHead)).toEqual([false, true, false]);
  });

  it("records what every dependent attaches to", () => {
    expect(arrows(label(SVO), SVO.words)).toEqual([
      "The red dog → barks",
      "The → red dog",
      "red → dog",
      "rarely → barks",
      "loudly → barks",
    ]);
  });

  it("keeps spans and order of the input phrases", () => {
    const phrases = buildPhrases(SVO.heads, SVO.upos, SVO.rels);
    const added = [
      "category",
      "role",
      "isHead",
      "coordinated",
      "splitPredicate",
      "badge",
      "attachTo",
      "attachFrom",
      "uncertain",
      "unsure",
    ];
    const strip = (xs: unknown): unknown =>
      JSON.parse(JSON.stringify(xs), (k, v) => (added.includes(k) ? undefined : v));
    expect(strip(labelPhrases(phrases, SVO.heads, SVO.rels, SVO.upos))).toEqual(strip(phrases));
  });

  it("labels a copula: [is [complement]]; the subject points to the copula, the complement to the subject", () => {
    const s: Sent = {
      words: ["The", "dog", "is", "very", "happy", "."],
      heads: [2, 5, 5, 5, 0, 5],
      rels: ["det", "nsubj", "cop", "advmod", "root", "punct"],
      upos: ["DET", "NOUN", "AUX", "ADV", "ADJ", "PUNCT"],
    };
    expect(show(label(s), s.words)).toBe(
      "[NP:Subject The dog] [VP:Predicate is [ADJP:Complement very:Modifier happy]] .",
    );
    expect(arrows(label(s), s.words)).toEqual([
      "The dog → is",
      "The → dog",
      "is → happy",
      "very happy → dog",
      "very → happy",
    ]);
  });

  it("labels a one-word complement on the word itself", () => {
    const s: Sent = {
      words: ["He", "is", "happy"],
      heads: [3, 3, 0],
      rels: ["nsubj", "cop", "root"],
      upos: ["PRON", "AUX", "ADJ"],
    };
    expect(show(label(s), s.words)).toBe("[NP:Subject He] [VP:Predicate is happy:Complement]");
    expect(arrows(label(s), s.words)).toEqual(["He → is", "is → happy", "happy → He"]);
  });

  it("labels a ditransitive: Indirect Object and Object", () => {
    const s: Sent = {
      words: ["She", "gave", "him", "a", "book"],
      heads: [2, 0, 2, 5, 2],
      rels: ["nsubj", "root", "iobj", "det", "obj"],
      upos: ["PRON", "VERB", "PRON", "DET", "NOUN"],
    };
    expect(show(label(s), s.words)).toBe("[NP:Subject She] [VP:Predicate gave him:Indirect Object [NP:Object a book]]");
  });

  it("labels a passive with its by-agent", () => {
    const s: Sent = {
      words: ["The", "cat", "was", "chased", "by", "the", "dog"],
      heads: [2, 4, 4, 0, 7, 7, 4],
      rels: ["det", "nsubj:pass", "aux:pass", "root", "case", "det", "obl:agent"],
      upos: ["DET", "NOUN", "AUX", "VERB", "ADP", "DET", "NOUN"],
    };
    expect(show(label(s), s.words)).toBe(
      "[NP:Passive subject The cat] [VP:Predicate was chased [PP:Agent by the dog]]",
    );
  });

  it("shows an embedded clause as S with its role; a one-word predicate carries the role itself", () => {
    const s: Sent = {
      words: ["I", "think", "he", "left"],
      heads: [2, 0, 4, 2],
      rels: ["nsubj", "root", "nsubj", "ccomp"],
      upos: ["PRON", "VERB", "PRON", "VERB"],
    };
    expect(show(label(s), s.words)).toBe(
      "[NP:Subject I] [VP:Predicate think [S:Complement he:Subject left:Predicate]]",
    );
  });

  it("labels a subjectless root clause (imperative) as the Predicate", () => {
    const s: Sent = {
      words: ["Close", "the", "door"],
      heads: [0, 3, 1],
      rels: ["root", "det", "obj"],
      upos: ["VERB", "DET", "NOUN"],
    };
    expect(show(label(s), s.words)).toBe("[VP:Predicate Close [NP:Object the door]]");
  });

  it("gives coordinated phrases one shared role and marks the conjuncts", () => {
    const s: Sent = {
      words: ["The", "dog", "and", "the", "cat", "sleep"],
      heads: [2, 6, 5, 5, 2, 0],
      rels: ["det", "nsubj", "cc", "det", "conj", "root"],
      upos: ["DET", "NOUN", "CCONJ", "DET", "NOUN", "VERB"],
    };
    expect(show(label(s), s.words)).toBe("[NP:Subject [NP& The dog&] and [NP& the cat]] [VP:Predicate sleep]");
  });

  it("keeps a coordinated clause outside the first clause's predicate", () => {
    const s: Sent = {
      words: ["He", "ran", "and", "she", "walked"],
      heads: [2, 0, 5, 5, 2],
      rels: ["nsubj", "root", "cc", "nsubj", "conj"],
      upos: ["PRON", "VERB", "CCONJ", "PRON", "VERB"],
    };
    expect(show(label(s), s.words)).toBe(
      "[NP:Subject He] [VP:Predicate ran&] and [NP:Subject she] [VP:Predicate walked]",
    );
  });

  it("brackets coordinated phrases side by side: [[A] and [B]], with the shared role outside (T82)", () => {
    const s: Sent = {
      words: "Mackerel typically have vertical stripes on their backs and deeply forked tails .".split(" "),
      heads: [3, 3, 0, 5, 3, 8, 8, 5, 12, 11, 12, 5, 3],
      rels: "nsubj advmod root amod obj case nmod:poss nmod cc advmod amod conj punct".split(" "),
      upos: "NOUN ADV VERB ADJ NOUN ADP PRON NOUN CCONJ ADV ADJ NOUN PUNCT".split(" "),
    };
    expect(show(label(s), s.words)).toBe(
      "[NP:Subject Mackerel] [VP:Predicate typically:Modifier have " +
        "[NP:Object [NP& vertical:Modifier stripes& [PP:Modifier on their:Possessive backs]] and " +
        "[NP& [ADJP:Modifier deeply:Modifier forked] tails]]] .",
    );
  });

  it("coordinates predicates and lists: every conjunct is a bracket, later words are shared (T92)", () => {
    const verbs: Sent = {
      words: "He often sings and dances well".split(" "),
      heads: [3, 3, 0, 5, 3, 3],
      rels: "nsubj advmod root cc conj advmod".split(" "),
      upos: "PRON ADV VERB CCONJ VERB ADV".split(" "),
    };
    expect(show(label(verbs), verbs.words)).toBe(
      "[NP:Subject He] [VP:Predicate [VP& often:Modifier sings&] and [VP& dances] well:Modifier]",
    );
    const list: Sent = {
      words: "She bought apples , pears and oranges".split(" "),
      heads: [2, 0, 2, 5, 3, 7, 3],
      rels: "nsubj root obj punct conj cc conj".split(" "),
      upos: "PRON VERB NOUN PUNCT NOUN CCONJ NOUN".split(" "),
    };
    expect(show(label(list), list.words)).toBe(
      "[NP:Subject She] [VP:Predicate bought [NP:Object [NP& apples&] , [NP& pears] and [NP& oranges]]]",
    );
  });

  it("marks a question's auxiliary and predicate as split pieces of one predicate", () => {
    const s: Sent = {
      words: ["Does", "the", "dog", "bark", "?"],
      heads: [4, 3, 4, 0, 4],
      rels: ["aux", "det", "nsubj", "root", "punct"],
      upos: ["AUX", "DET", "NOUN", "VERB", "PUNCT"],
    };
    expect(show(label(s), s.words)).toBe("Does:Predicate* [NP:Subject the dog] [VP:Predicate* bark] ?");
  });

  it("brackets the owner's example: subject, [is [complement]], [given [to …]], a number of as a quantifier", () => {
    const s: Sent = {
      words: "Mackerel is a common name given to a number of species of fish .".split(" "),
      heads: [5, 5, 5, 5, 0, 5, 9, 9, 6, 11, 9, 13, 11, 5],
      rels: "nsubj cop det amod root acl case det obl case nmod case nmod punct".split(" "),
      upos: "NOUN AUX DET ADJ NOUN VERB ADP DET NOUN ADP NOUN ADP NOUN PUNCT".split(" "),
    };
    const out = label(s);
    expect(show(out, s.words)).toBe(
      "[NP:Subject Mackerel] [VP:Predicate is [NP:Complement a common:Modifier name " +
        "[VP:Modifier given [PP:Modifier to [NP:Modifier a number of] species [PP:Modifier of fish]]]]] .",
    );
    expect(arrows(out, s.words)).toEqual([
      "Mackerel → is",
      "is → name",
      "a common name given to a number of species of fish → Mackerel",
      "a → common name",
      "common → name",
      "given to a number of species of fish → name",
      "to a number of species of fish → given",
      "to → species",
      "a number of → species",
      "a → number",
      "of → number",
      "of fish → species",
      "of → fish",
    ]);
  });

  it("brackets a prepositional complement: [are [from the Scombridae family]]", () => {
    const s: Sent = {
      words: "Most mackerel are from the Scombridae family .".split(" "),
      heads: [2, 7, 7, 7, 7, 7, 0, 7],
      rels: "amod nsubj cop case det compound root punct".split(" "),
      upos: "ADJ NOUN AUX ADP DET PROPN NOUN PUNCT".split(" "),
    };
    expect(show(label(s), s.words)).toBe(
      "[NP:Subject Most:Modifier mackerel] [VP:Predicate are [PP:Complement from the Scombridae family]] .",
    );
  });

  it("lets a modifier before its head modify everything up to the head, in noun and verb phrases (T81)", () => {
    const s: Sent = {
      words: "The big red dog has often quietly slept there".split(" "),
      heads: [4, 4, 4, 8, 8, 8, 8, 0, 8],
      rels: "det amod amod nsubj aux advmod advmod root advmod".split(" "),
      upos: "DET ADJ ADJ NOUN AUX ADV ADV VERB ADV".split(" "),
    };
    expect(arrows(label(s), s.words)).toEqual([
      "The big red dog → slept",
      "The → big red dog",
      "big → red dog",
      "red → dog",
      "has → slept",
      "often → quietly slept",
      "quietly → slept",
      "there → slept",
    ]);
  });

  it("keeps a one-word target for words outside their head's bracket and for modifiers with their own words", () => {
    // "Rarely" is before the subject (outside the predicate); "very" belongs to "big", so "big" still spans to "dog".
    const s: Sent = {
      words: "Rarely the very big old dog barks".split(" "),
      heads: [7, 6, 4, 6, 6, 7, 0],
      rels: "advmod det advmod amod amod nsubj root".split(" "),
      upos: "ADV DET ADV ADJ ADJ NOUN VERB".split(" "),
    };
    expect(arrows(label(s), s.words)).toEqual([
      "Rarely → barks",
      "the very big old dog → barks",
      "the → very big old dog",
      "very big → old dog",
      "very → big",
      "old → dog",
    ]);
  });

  it("hides roles whose head word is below the role threshold and marks the attachment uncertain", () => {
    const confidence = [1, 0.4, 0.4, 1, 1, 0.9, 1]; // red and dog uncertain
    const out = label(SVO, { confidence, threshold: 0.5 });
    expect(show(out, SVO.words)).toBe("[NP? The red? dog] [VP:Predicate rarely:Modifier barks loudly:Modifier] .");
  });

  it("returns nothing for an empty sentence", () => {
    expect(labelPhrases([], [], [], [])).toEqual([]);
  });
});

describe("gateLabeled", () => {
  // I think the red dog barks loudly — an embedded clause, whose brackets can collapse.
  const EMBEDDED: Sent = {
    words: "I think the red dog barks loudly".split(" "),
    heads: [2, 0, 5, 5, 6, 2, 6],
    rels: "nsubj root det amod nsubj ccomp advmod".split(" "),
    upos: "PRON VERB DET ADJ NOUN VERB ADV".split(" "),
  };
  const collapse = (pick: (n: LabeledPhrase) => boolean): LabeledSentencePhrases =>
    gateLabeled(label(EMBEDDED), (n) => (pick(n) ? 0 : 1), 0.5);

  it("labels the embedded clause in full when nothing collapses", () => {
    expect(show(label(EMBEDDED), EMBEDDED.words)).toBe(
      "[NP:Subject I] [VP:Predicate think [S:Complement [NP:Subject the red:Modifier dog] [VP:Predicate barks loudly:Modifier]]]",
    );
  });

  it("puts a collapsed bracket's role and attachment on its head word as a badge (T59)", () => {
    const out = collapse((n) => n.head === 4);
    expect(show(out, EMBEDDED.words)).toBe(
      "[NP:Subject I] [VP:Predicate think [S:Complement the red:Modifier dog:Subject! [VP:Predicate barks loudly:Modifier]]]",
    );
    expect(arrows(out, EMBEDDED.words)).toContain("dog → barks");
  });

  it("badges the predicate on the clause's head word when the predicate bracket collapsed", () => {
    const out = collapse((n) => n.level === "predicate" && n.head === 5);
    expect(show(out, EMBEDDED.words)).toBe(
      "[NP:Subject I] [VP:Predicate think [S:Complement [NP:Subject the red:Modifier dog] barks:Predicate! loudly:Modifier]]",
    );
  });

  it("never collapses the main clause's subject and predicate: they are marked unsure (T82)", () => {
    expect(
      show(
        collapse(() => true),
        EMBEDDED.words,
      ),
    ).toBe("[NP:Subject I] [VP:Predicate~ think the red:Modifier dog:Subject! barks:Complement! loudly:Modifier]");
  });

  it("keeps brackets at or above the threshold", () => {
    expect(
      show(
        gateLabeled(label(EMBEDDED), () => 0.5, 0.5),
        EMBEDDED.words,
      ),
    ).toBe(show(label(EMBEDDED), EMBEDDED.words));
  });
});

describe("labeledView", () => {
  it("gates by span confidence: an unsure attachment inside a phrase does not collapse the phrases around it", () => {
    const n = SVO.heads.length;
    // Every word is sure of its head, except "red": 0.6 dog, 0.4 The (both inside [The red dog]).
    const headDist = SVO.heads.map((h, w) => {
      const row = new Array<number>(n + 1).fill(0);
      row[h] = 1;
      if (w === 1) {
        row[3] = 0.6;
        row[1] = 0.4;
      }
      return row;
    });
    const tree: DecodedTree = {
      heads: SVO.heads,
      relations: SVO.rels,
      repaired: false,
      repairedWords: [],
      headProbs: headDist.map((row, w) => row[SVO.heads[w] as number] as number),
      relationProbs: SVO.heads.map(() => 1),
      headDist,
    };
    const out = labeledView(tree, SVO.upos, SVO.words, { bracket: 0.9, role: 0.5 });
    expect(show(out, SVO.words)).toBe(
      "[NP:Subject The red:Modifier dog] [VP:Predicate rarely:Modifier barks loudly:Modifier] .",
    );
    // If "red" may attach outside the subject (to "barks"), the subject and predicate brackets are unsure.
    (headDist[1] as number[])[1] = 0;
    (headDist[1] as number[])[5] = 0.4;
    const moved = labeledView(tree, SVO.upos, SVO.words, { bracket: 0.9, role: 0.5 });
    expect(show(moved, SVO.words)).toBe(
      "[NP:Subject~ The red:Modifier dog] [VP:Predicate~ rarely:Modifier barks loudly:Modifier] .",
    );
  });
});
