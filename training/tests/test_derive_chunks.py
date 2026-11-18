"""
training/tests/test_derive_chunks.py — unit tests for UD-to-chunk derivation

Description:
    Hand-written UD sentences with expected chunks, checking each rule in
    scripts/derive_chunks.py and its edge cases. Expected output is written
    in bracket form (`[NP the dog] [VP barked] .`) for readability.

Phase: 2 — Chunk derivation from UD trees (exit criterion: tests pass).

Coverage:
    NP (det, amod, nummod, compound, nmod:poss, flat, possessive 's;
    post-modifiers excluded), VP (aux, aux:pass, cop, not/n't, particle,
    infinitive to, interior adverb), PP (case, fixed, stacked), ADJP, ADVP, O;
    coordination, passives, questions, gap splits, punctuation, dates,
    quantities, multiword tokens, file annotation, BIO validation.

Dependencies:
    Python: pytest, conllu.
    Tests:  scripts/derive_chunks.py.
    Data:   inline fixtures only; no files from data/.

Status: implemented (Phase 2).
"""

from __future__ import annotations

from collections.abc import Callable

import conllu
import pytest

from derive_chunks import (
    annotate_conllu,
    bracketed,
    derive_chunk_tags,
    validate_bio,
    words_from_tokenlist,
)

# (case id, rows "form UPOS head deprel [lemma]", expected bracketed output)
CASES: list[tuple[str, list[str], str]] = [
    (
        "np_det_amod",
        [
            "The DET 3 det",
            "big ADJ 3 amod",
            "dog NOUN 4 nsubj",
            "barked VERB 0 root",
            ". PUNCT 4 punct",
        ],
        "[NP The big dog] [VP barked] .",
    ),
    (
        "np_nummod_compound",
        [
            "I PRON 2 nsubj",
            "ate VERB 0 root",
            "three NUM 5 nummod",
            "apple NOUN 5 compound",
            "pies NOUN 2 obj",
        ],
        "[NP I] [VP ate] [NP three apple pies]",
    ),
    (
        "np_possessive_chain",
        [
            "My PRON 2 nmod:poss",
            "brother NOUN 4 nmod:poss",
            "'s PART 2 case",
            "friend NOUN 5 nsubj",
            "left VERB 0 root",
            ". PUNCT 5 punct",
        ],
        "[NP My brother 's friend] [VP left] .",
    ),
    (
        "np_flat_name",
        ["John PROPN 3 nsubj", "Smith PROPN 1 flat", "arrived VERB 0 root"],
        "[NP John Smith] [VP arrived]",
    ),
    (
        "np_postmodifier_pp_excluded",
        [
            "the DET 2 det",
            "man NOUN 6 nsubj",
            "in ADP 5 case",
            "the DET 5 det",
            "car NOUN 2 nmod",
            "smiled VERB 0 root",
        ],
        "[NP the man] [PP in] [NP the car] [VP smiled]",
    ),
    (
        "np_relative_clause_excluded",
        [
            "the DET 2 det",
            "book NOUN 0 root",
            "that PRON 5 obj",
            "I PRON 5 nsubj",
            "read VERB 2 acl:relcl",
        ],
        "[NP the book] [NP that] [NP I] [VP read]",
    ),
    (
        "vp_aux_chain",
        ["She PRON 4 nsubj", "has AUX 4 aux", "been AUX 4 aux", "working VERB 0 root"],
        "[NP She] [VP has been working]",
    ),
    (
        "vp_passive",
        [
            "The DET 2 det",
            "car NOUN 4 nsubj:pass",
            "was AUX 4 aux:pass",
            "stolen VERB 0 root",
            ". PUNCT 4 punct",
        ],
        "[NP The car] [VP was stolen] .",
    ),
    (
        "vp_negation_not",
        ["He PRON 4 nsubj", "did AUX 4 aux", "not PART 4 advmod not", "go VERB 0 root"],
        "[NP He] [VP did not go]",
    ),
    (
        "vp_negation_contracted",
        ["I PRON 4 nsubj", "ca AUX 4 aux can", "n't PART 4 advmod not", "swim VERB 0 root"],
        "[NP I] [VP ca n't swim]",
    ),
    (
        "copula_adjp",
        ["She PRON 4 nsubj", "is AUX 4 cop be", "very ADV 4 advmod", "happy ADJ 0 root"],
        "[NP She] [VP is] [ADJP very happy]",
    ),
    (
        "copula_np_with_negation",
        [
            "He PRON 5 nsubj",
            "is AUX 5 cop be",
            "not PART 5 advmod not",
            "a DET 5 det",
            "teacher NOUN 0 root",
        ],
        "[NP He] [VP is not] [NP a teacher]",
    ),
    (
        "phrasal_verb_contiguous",
        [
            "She PRON 2 nsubj",
            "picked VERB 0 root",
            "up ADP 2 compound:prt",
            "the DET 5 det",
            "box NOUN 2 obj",
        ],
        "[NP She] [VP picked up] [NP the box]",
    ),
    (
        "phrasal_verb_split_particle_advp",
        ["She PRON 2 nsubj", "picked VERB 0 root", "it PRON 2 obj", "up ADP 2 compound:prt"],
        "[NP She] [VP picked] [NP it] [ADVP up]",
    ),
    (
        "infinitive_to",
        [
            "I PRON 2 nsubj",
            "want VERB 0 root",
            "to PART 4 mark",
            "go VERB 2 xcomp",
            "home ADV 4 advmod",
        ],
        "[NP I] [VP want] [VP to go] [ADVP home]",
    ),
    (
        "vp_interior_adverb",
        [
            "He PRON 5 nsubj",
            "has AUX 5 aux",
            "always ADV 5 advmod",
            "been AUX 5 cop be",
            "late ADJ 0 root",
        ],
        "[NP He] [VP has always been] [ADJP late]",
    ),
    (
        "pp_multiword_fixed",
        [
            "We PRON 2 nsubj",
            "stayed VERB 0 root",
            "because ADP 6 case",
            "of ADP 3 fixed",
            "the DET 6 det",
            "rain NOUN 2 obl",
        ],
        "[NP We] [VP stayed] [PP because of] [NP the rain]",
    ),
    (
        "pp_stacked_case",
        [
            "He PRON 2 nsubj",
            "ran VERB 0 root",
            "out ADP 6 case",
            "of ADP 6 case",
            "the DET 6 det",
            "house NOUN 2 obl",
        ],
        "[NP He] [VP ran] [PP out of] [NP the house]",
    ),
    (
        "advp_left_advmod",
        ["She PRON 2 nsubj", "runs VERB 0 root", "very ADV 4 advmod", "quickly ADV 2 advmod"],
        "[NP She] [VP runs] [ADVP very quickly]",
    ),
    (
        "advp_sentence_initial",
        ["Suddenly ADV 3 advmod", "we PRON 3 nsubj", "left VERB 0 root"],
        "[ADVP Suddenly] [NP we] [VP left]",
    ),
    (
        "coordination_nouns_separate",
        [
            "I PRON 2 nsubj",
            "like VERB 0 root",
            "cats NOUN 2 obj",
            "and CCONJ 5 cc",
            "dogs NOUN 3 conj",
        ],
        "[NP I] [VP like] [NP cats] and [NP dogs]",
    ),
    (
        "coordination_premodifiers_one_np",
        [
            "I PRON 2 nsubj",
            "saw VERB 0 root",
            "red ADJ 6 amod",
            "and CCONJ 5 cc",
            "blue ADJ 3 conj",
            "cars NOUN 2 obj",
        ],
        "[NP I] [VP saw] [NP red and blue cars]",
    ),
    (
        "coordination_noun_compounds_one_np",
        ["apple NOUN 4 compound", "and CCONJ 3 cc", "orange NOUN 1 conj", "juice NOUN 0 root"],
        "[NP apple and orange juice]",
    ),
    (
        "coordination_verbs",
        ["They PRON 2 nsubj", "sang VERB 0 root", "and CCONJ 4 cc", "danced VERB 2 conj"],
        "[NP They] [VP sang] and [VP danced]",
    ),
    (
        "question_aux_split_at_gap",
        [
            "Did AUX 3 aux do",
            "you PRON 3 nsubj",
            "see VERB 0 root",
            "it PRON 3 obj",
            "? PUNCT 3 punct",
        ],
        "[VP Did] [NP you] [VP see] [NP it] ?",
    ),
    (
        "question_negation_stays_with_aux",
        [
            "Why ADV 5 advmod",
            "did AUX 5 aux do",
            "n't PART 5 advmod not",
            "you PRON 5 nsubj",
            "call VERB 0 root",
            "? PUNCT 5 punct",
        ],
        "[ADVP Why] [VP did n't] [NP you] [VP call] ?",
    ),
    (
        "negation_without_verb_group",
        ["Not PART 2 advmod not", "everyone PRON 3 nsubj", "agreed VERB 0 root"],
        "[ADVP Not] [NP everyone] [VP agreed]",
    ),
    (
        "hyphen_inside_np",
        [
            "a DET 5 det",
            "well ADV 4 advmod",
            "- PUNCT 4 punct",
            "known VERB 5 amod",
            "author NOUN 0 root",
        ],
        "[NP a well - known author]",
    ),
    (
        "brackets_split_np",
        [
            "the DET 5 det",
            "( PUNCT 3 punct",
            "new ADJ 5 amod",
            ") PUNCT 3 punct",
            "car NOUN 0 root",
        ],
        "[NP the] ( [NP new] ) [NP car]",
    ),
    (
        "non_contiguous_np_split_at_gap",
        ["the DET 4 det", ", PUNCT 3 punct", "um INTJ 4 discourse", "dog NOUN 0 root"],
        "[NP the] , um [NP dog]",
    ),
    (
        "date_nmod_unmarked",
        [
            "We PRON 2 nsubj",
            "met VERB 0 root",
            "on ADP 5 case",
            "October PROPN 5 nmod:unmarked",
            "4th NOUN 2 obl",
        ],
        "[NP We] [VP met] [PP on] [NP October 4th]",
    ),
    (
        "title_nmod_desc",
        ["President PROPN 2 nmod:desc", "Putin PROPN 3 nsubj", "spoke VERB 0 root"],
        "[NP President Putin] [VP spoke]",
    ),
    (
        "quantity_more_than",
        ["more ADJ 3 advmod", "than ADP 1 fixed", "200 NUM 4 nummod", "people NOUN 0 root"],
        "[NP more than 200 people]",
    ),
    (
        "at_least_advp",
        [
            "He PRON 2 nsubj",
            "ate VERB 0 root",
            "at ADP 4 case",
            "least ADJ 5 nmod",
            "five NUM 2 obj",
        ],
        "[NP He] [VP ate] [ADVP at least] [NP five]",
    ),
    (
        "nominal_adjective",
        ["She PRON 4 nsubj", "is AUX 4 cop be", "the DET 4 det", "best ADJ 0 root"],
        "[NP She] [VP is] [NP the best]",
    ),
    (
        "preposition_before_gerund",
        [
            "He PRON 2 nsubj",
            "helped VERB 0 root",
            "by SCONJ 4 mark",
            "giving VERB 2 advcl",
            "money NOUN 4 obj",
        ],
        "[NP He] [VP helped] [PP by] [VP giving] [NP money]",
    ),
    (
        "subordinator_outside",
        [
            "I PRON 2 nsubj",
            "left VERB 0 root",
            "because SCONJ 5 mark",
            "it PRON 5 nsubj",
            "rained VERB 2 advcl",
        ],
        "[NP I] [VP left] because [NP it] [VP rained]",
    ),
    (
        "multiword_conjunction_outside",
        [
            "I PRON 2 nsubj",
            "like VERB 0 root",
            "tea NOUN 2 obj",
            "as ADV 7 cc",
            "well ADV 4 fixed",
            "as ADP 4 fixed",
            "coffee NOUN 3 conj",
        ],
        "[NP I] [VP like] [NP tea] as well as [NP coffee]",
    ),
    (
        "currency_symbol_np",
        ["It PRON 2 nsubj", "costs VERB 0 root", "$ SYM 2 obj", "5 NUM 3 nummod"],
        "[NP It] [VP costs] [NP $ 5]",
    ),
]


def _chunk(rows_to_conllu: Callable[..., str], rows: list[str]) -> str:
    sentence = conllu.parse(rows_to_conllu(rows))[0]
    words = words_from_tokenlist(sentence)
    tags = derive_chunk_tags(words)
    validate_bio(tags)
    return bracketed(words, tags)


@pytest.mark.parametrize(("rows", "expected"), [c[1:] for c in CASES], ids=[c[0] for c in CASES])
def test_chunk_rules(rows_to_conllu: Callable[..., str], rows: list[str], expected: str) -> None:
    assert _chunk(rows_to_conllu, rows) == expected


def test_empty_sentence() -> None:
    assert derive_chunk_tags([]) == []


MWT_SENTENCE = """\
# newdoc id = doc-1
# sent_id = mwt-1
# text = I don't know.
1\tI\tI\tPRON\tPRP\t_\t4\tnsubj\t_\t_
2-3\tdon't\t_\t_\t_\t_\t_\t_\t_\t_
2\tdo\tdo\tAUX\tVBP\t_\t4\taux\t_\t_
3\tn't\tnot\tPART\tRB\t_\t4\tadvmod\t_\t_
4\tknow\tknow\tVERB\tVB\t_\t0\troot\t_\tSpaceAfter=No
5\t.\t.\tPUNCT\t.\t_\t4\tpunct\t_\t_

"""


def test_multiword_token_lines_skipped() -> None:
    sentence = conllu.parse(MWT_SENTENCE)[0]
    words = words_from_tokenlist(sentence)
    assert [w.form for w in words] == ["I", "do", "n't", "know", "."]
    assert derive_chunk_tags(words) == ["B-NP", "B-VP", "I-VP", "I-VP", "O"]


def test_annotate_conllu_adds_misc_and_keeps_other_lines() -> None:
    text, tags = annotate_conllu(MWT_SENTENCE)
    assert tags == [["B-NP", "B-VP", "I-VP", "I-VP", "O"]]
    lines = text.strip("\n").split("\n")
    assert lines[:3] == MWT_SENTENCE.split("\n")[:3]  # comments unchanged
    assert lines[4] == MWT_SENTENCE.split("\n")[4]  # multiword-token range line unchanged
    assert lines[3].endswith("\tChunk=B-NP")
    assert lines[7].endswith("\tSpaceAfter=No|Chunk=I-VP")
    assert text.endswith("\n\n")


@pytest.mark.parametrize(
    "tags",
    [["I-NP"], ["B-NP", "I-VP"], ["O", "I-PP"], ["B-XP"], ["NP"]],
)
def test_validate_bio_rejects_invalid(tags: list[str]) -> None:
    with pytest.raises(ValueError):
        validate_bio(tags)


def test_validate_bio_accepts_valid() -> None:
    validate_bio(["B-NP", "I-NP", "B-VP", "O", "B-PP", "B-NP", "B-ADJP", "B-ADVP"])
