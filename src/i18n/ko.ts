/**
 * src/i18n/ko.ts — Korean UI messages (default language; owner, T18)
 *
 * Description:
 *   Korean text for every key of ./en.ts (typed as Messages, so a missing key fails
 *   typecheck). Grammar labels give the Korean term with the English abbreviation or term,
 *   e.g. "명사구 (NP)", "주어 (Subject)" (T18).
 *
 * Layer: i18n (data). Status: implemented (T68).
 */

import type { Messages } from "./en";

export const ko: Messages = {
  "app.name": "Enparse",
  "app.tagline": "학습자를 위한 영어 문장 구조 분석",
  "app.errorTitle": "문제가 발생했습니다",
  "app.errorBody": "이 페이지를 표시할 수 없습니다. 입력 페이지로 돌아가 다시 시도해 주세요.",
  "app.errorLink": "입력 페이지로 이동",

  "layout.skip": "본문으로 건너뛰기",
  "nav.label": "페이지",
  "nav.input": "입력",
  "nav.output": "분석 결과",
  "nav.vocab": "단어장",
  "nav.dictionary": "사전",
  "nav.models": "모델",
  "nav.about": "정보 및 라이선스",

  "language.label": "언어",

  "update.available": "Enparse의 새 버전이 준비되었습니다.",
  "update.reload": "새로고침",
  "common.loading": "불러오는 중",
  "common.close": "닫기",
  "common.opensNewTab": "(새 탭에서 열림)",

  "page.input.title": "입력",
  "page.input.placeholder": "분석할 영어 문장을 여기에 붙여넣거나 입력하세요. 이 페이지는 T56에서 만듭니다.",
  "page.output.title": "분석 결과",
  "page.output.placeholder": "분석된 문장이 여기에 표시됩니다. 이 페이지는 T57에서 만듭니다.",
  "page.vocab.title": "단어장",
  "page.vocab.placeholder": "나의 단어장이 여기에 표시됩니다. 이 페이지는 T48에서 만듭니다.",
  "page.dictionary.title": "사전",
  "page.dictionary.placeholder": "영어 단어를 여기에서 찾아보세요. 이 페이지는 T53에서 만듭니다.",
  "page.models.title": "모델",
  "page.models.placeholder": "분석 모델을 선택하고, 내려받고, 삭제하는 곳입니다. 이 페이지는 T54에서 만듭니다.",

  "about.title": "정보 및 라이선스",
  "about.intro":
    "Enparse는 모든 처리를 브라우저 안에서 합니다. 아래의 분석 모델, 학습 데이터, 단어 목록, 라이브러리는 각각의 라이선스에 따라 사용됩니다.",
  "about.appTitle": "Enparse",
  "about.appLicense":
    "이 앱의 코드는 PolyForm Noncommercial License 1.0.0에 따라 제공됩니다. 비상업적 목적으로 사용·수정·배포할 수 있으며, 아래 고지를 유지해야 합니다.",
  "about.modelsTitle": "분석 모델",
  "about.dataTitle": "학습 데이터",
  "about.dataNote": "아래 출처 표시는 라이선스 요건에 따라 영어 원문으로 제공합니다.",
  "about.dataSource": "GitHub의 UD English EWT",
  "about.wordListTitle": "단어 목록",
  "about.librariesTitle": "라이브러리",
  "about.dictionaryTitle": "사전 자료 출처",
  "about.dictionaryNone": "아직 포함된 사전 자료가 없습니다.",
  "about.licenseLabel": "라이선스",
  "about.model.deberta":
    "microsoft/deberta-v3-xsmall(MIT)을 바탕으로 학습한 모델입니다. 학습된 모델 파일: CC BY-SA 4.0.",
  "about.model.modernbert":
    "answerdotai/ModernBERT-base(Apache 2.0)를 바탕으로 학습한 모델입니다. 학습된 모델 파일: CC BY-SA 4.0.",
  "about.license.mitTrained": "MIT(기반 모델) · CC BY-SA 4.0(학습된 모델)",
  "about.license.apacheTrained": "Apache 2.0(기반 모델) · CC BY-SA 4.0(학습된 모델)",
  "about.wordList.ngsl":
    "New General Service List by Browne, C., Culligan, B., and Phillips, J. 단어 구성 요소 분석의 기본 단어 목록으로 사용합니다(소문자 변환, 중복 제거).",
  "about.lib.transformers": "분석 모델을 실행합니다.",
  "about.lib.onnx": "모델 추론(WebGPU 및 WebAssembly).",
  "about.lib.wink": "문장·단어 나누기와 기본형(lemma).",
  "about.lib.react": "사용자 인터페이스.",
  "about.lib.router": "페이지 이동.",

  "grammar.NP": "명사구 (NP)",
  "grammar.VP": "동사구 (VP)",
  "grammar.PP": "전치사구 (PP)",
  "grammar.ADJP": "형용사구 (ADJP)",
  "grammar.ADVP": "부사구 (ADVP)",
  "grammar.S": "절 (S)",
  "role.Subject": "주어 (Subject)",
  "role.Predicate": "서술어 (Predicate)",
  "role.Object": "목적어 (Object)",
  "role.Indirect Object": "간접목적어 (Indirect Object)",
  "role.Complement": "보어 (Complement)",
  "role.Modifier": "수식어 (Modifier)",
  "role.Passive subject": "수동태 주어 (Passive subject)",
  "role.Agent": "행위자 (Agent, by-구)",
  "role.Relative clause": "관계절 (Relative clause)",
  "role.Possessive": "소유격 (Possessive)",
  "role.Particle": "불변화사 (Particle)",
};
