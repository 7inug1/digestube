# 청킹 프롬프트 개발 — Sonnet 사용자 피드백

2026-09-13. 28번 모델 비교 이후 같은 영상 JRJd1ZrHmgg로 진행하는 개발 실험.
모델 선정 평가가 아니며, 이전 결과는 덮어쓰지 않는다. 운영 DB 변경 없음.

- 사용자: 첫째/둘째/셋째는 나누고, 긴 단계 설명은 2~3문단이면 좋겠다.
- 1차 수정: 설명/방법/예시/팁 전환마다 분리하도록 지시. 34문단으로 과도하게
  나뉘어 사용자가 개선 요청. 최초 출력 2000토큰 한도 실패 후 8000으로 재실행했다.
- 재조정: 같은 논점의 설명+직접 이어지는 예시를 기본적으로 묶는다.
  독립적인 나열 항목은 나누되, 긴 항목만 2~3개 세부 문단으로 나눈다.
  짧은 도입/연결/마무리는 관련 내용에 묶는다. 8000토큰 한도 유지.

실행: `node --env-file=.env.local --import tsx scripts/compare-topic-chunking.ts --sonnet-balanced`

결과: `web/data/evals/chunking/topic-balanced/` (프롬프트, 응답, 경계, 검사 결과).
이전 수정: `web/data/evals/chunking/topic-refined/`.
로컬 비교: `/local-chunking?mode=sonnet-balanced`.

출력 문단 수는 품질 점수가 아니다. 사용자 검토 후 기준을 고정하고 새로운 영상과
다른 후보에 적용해야 한다. 모델 표집 편차가 있어 전후 차이를 프롬프트 효과로만
단정할 수 없다. 코드 검사는 시각의 수치/순서 검사이며 실제 음성 정렬 검증이 아니다.

## 새 한국어 대담 적용

사용자가 21문단 재조정 결과를 선호한다고 평가한 뒤, 같은 프롬프트를
byVgbqzYJrs에 적용했다. `--sonnet-balanced --dialogue`로 재현한다.
저장된 Gemini 3.8 응답의 바깥 코드펜스만 제거해 204발화를 복구한
`web/data/evals/chunking/dialogue-source.json`을 사용했다. 재전사하지 않았다.
Sonnet 1회 47,963ms, 최종 12문단. 결과는 `topic-dialogue/`에 보존한다.
로컬 `/local-chunking/dialogue`에서 같은 입력의 현재 방식과 비교한다.
이번 결과에 대한 사용자 품질 평가는 아직 없다. 운영 DB 변경 없음.

## 맥락+권장 길이 적용

사용자 요청에 따라 280~360자를 강제 절단값이 아닌 권장 범위로 모델에 주었다.
전체 전사문을 다시 분할한 호출은 8,000 출력 토큰 한도와 120초 시간 제한에서 각각
실패했다. 실패 응답은 `topic-readable/`에 보존했다. 이후 기존 12개 주제 경계는
유지하고 360자를 넘는 8개 주제만 Sonnet에 보내 세부 경계를 선택하게 변경했다.

성공 결과는 48,364ms, 20문단, 길이 최소/중앙/최대 105/262/447자다. 원문 보존 검사를
통과했다. 700자 초과 시에만 코드 분할을 적용하는 안전장치는 이번 결과에서 작동하지
않았다. 따라서 20개 경계는 모델이 선택한 결과다. 사용자 품질 평가는 아직 없다.
재현: `node --env-file=.env.local --import tsx scripts/refine-long-topic-chunks.ts`.

## 후보 확인 — Haiku 4.5 · Gemini 3.8 Flash (2026-09-13)

Sonnet 과 **같은 전사문**(`dialogue-source.json`), **같은 큰 주제 12개**(`topic-dialogue/2026-09-13T08-16-39-394Z-byVgbqzYJrs/sonnet.json`),
**같은 프롬프트**로 360자를 넘는 주제 8개만 다시 나누게 했다. 모델별로 프롬프트를 다듬지 않았다.
**이번 한 편은 후보 확인이다. 최종 모델 선정이 아니다.**

### 실행 전에 고친 것 — 비교 조건 차이 3개

Codex 가 만든 `scripts/compare-readable-models.ts` 를 읽고 아래를 고친 뒤 돌렸다.

| 항목 | 고치기 전 | 고친 뒤 | 이유 |
|---|---|---|---|
| Haiku 모델 ID | `claude-haiku-4-5` | `claude-haiku-4-5-20251001` | `/v1/models` 목록에 없는 ID 였다 |
| 출력 한도 | 4,000 | 16,000 | Sonnet 이 4,748 토큰을 썼다. 4,000 이면 잘린다 |
| 제한 시간 | 120초 | 240초 | Sonnet 실행과 같게 맞췄다 |

`checks.problems` 가 늘 빈 배열이라 실제 검사를 넣었다: 번호 중복·순서 역전·첫 번호 1 여부·
큰 주제 경계 유실·빈 문단·700자 초과·원문 조각 누락.

**남은 조건 차이**: Sonnet 5 는 `temperature` 를 받지 않아 생략했고 Haiku·Gemini 는 0 을 주었다.
표집 설정을 완전히 같게 맞출 방법이 없다. 결과 파일 `config` 에 그대로 적었다.

### 결과

| 후보 | 모델 ID | 문단 | 길이 최소/중앙/최대 | 시간 | 토큰(입력/출력) | 원문 보존 | 검사 |
|---|---|---:|---|---:|---|---|---|
| Sonnet | `claude-sonnet-5` | 20 | 105 / 262 / 447자 | 48.4초 | 5,243 / 4,748 | O | 문제 0 |
| Haiku | `claude-haiku-4-5-20251001` | 25 | 92 / 201 / 325자 | **2.8초** | 5,231 / **235** | O | 문제 0 |
| Gemini | `gemini-3.8-flash` | — | — | — | — | — | **실패** |

Haiku 는 Sonnet 보다 17배 빠르고 출력 토큰이 1/20 이다. 대신 문단이 5개 더 잘게 나뉘고
중앙값이 262자에서 201자로 내려갔다. 권장 범위(280~360자)를 기준으로 보면 Sonnet 이 가깝고
Haiku 는 아래로 벗어난다. **어느 쪽이 읽기 좋은지는 사람이 보고 판단한다 — 아직 판정 없음.**

### 실패 기록

`gemini-3.8-flash` 는 두 번 모두 HTTP 503 `This model is currently experiencing high demand`.
모델 과부하로 구글 쪽에서 거절한 것이라 우리 입력·설정 문제가 아니다.
원인이 같아 세 번째 호출은 하지 않았다. 실패 응답도 파일로 남겼다.

- 1차: `topic-readable-candidates/2026-09-13T08-50-14.478Z-byVgbqzYJrs/gemini.json`
- 2차: `topic-readable-candidates/2026-09-13T08-53-*-byVgbqzYJrs/gemini.json`

### 보는 곳

`/local-chunking/dialogue` 에 탭을 추가했다 — **Sonnet 맥락+길이 · Haiku 맥락+길이 · Gemini 맥락+길이**.
탭마다 모델 ID·처리 시간·토큰·길이 분포·원문 보존 여부가 함께 뜬다. 실패한 후보는 실패 사유를 보여준다.

재현: `node --env-file=.env.local --import tsx scripts/compare-readable-models.ts [haiku|gemini]`.
운영 DB·전사문·배포는 건드리지 않았다.
