# 실험·판단 기록

무엇을 고를지 정하기 전에 **재는 기준을 먼저 적고**, 잰 뒤에 정한 것을 남긴 기록입니다. 실패하거나 보류한 것도 그대로 둡니다.

먼저 읽으면 좋은 것: [기술 선정 프레임워크](00-methodology.md) · [청사진 7자리 현황](blueprint-status.md)

## 전사

| 기록 | 내용 |
|---|---|
| [01-yt-dlp](01-yt-dlp.md) | 오디오 추출 경로 확인 |
| [02-stt](02-stt.md) | 음성 전사 후보 비교, 자막 존재 여부가 영상 단위로 갈림 |
| [03-cer-videos](03-cer-videos.md) | CER 측정용 정답 영상 선정 |
| [22-transcription-gemini](22-transcription-gemini.md) | Supadata native 대 Gemini |
| [25-screen-text](25-screen-text.md) | 화면 글자 동시 수집 측정과 보류 결정 |
| [26-transcription-model-compare](26-transcription-model-compare.md) | 3.5 / 3.6 / 3.8 flash 재비교 설계 |

## 문단 나누기

| 기록 | 내용 |
|---|---|
| [04-chunking-embedding](04-chunking-embedding.md) | 청킹용 임베딩 모델 |
| [15-sentence-boundary-fix](15-sentence-boundary-fix.md) | 문장 중간 절단 수정 |
| [16-library-rechunk](16-library-rechunk.md) | 기존 라이브러리 전체 재청킹 |
| [17-timestamp-release](17-timestamp-release.md) | 문단 경계와 원본 자막 시각 |
| [24-chunking-rerun](24-chunking-rerun.md) | 전제가 바뀌어 비교를 다시 짬 |
| [27-topic-chunking-plan](27-topic-chunking-plan.md) | 주제 기반 청킹 후보 조사 |
| [28-topic-chunking-run1](28-topic-chunking-run1.md) | 주제 기반 청킹 준비 실험 |
| [29-topic-chunking-prompt-refinement](29-topic-chunking-prompt-refinement.md) | 청킹 프롬프트 개발 |

## 목차

| 기록 | 내용 |
|---|---|
| [08-outline](08-outline.md) | 목차 생성 배관 |
| [09-outline-model-evaluation](09-outline-model-evaluation.md) | 목차 모델 평가 설계 |
| [11-outline-human-pilot](11-outline-human-pilot.md) | 작은 사람 평가부터 |
| [23-outline-rerun](23-outline-rerun.md) | 통과 기준을 먼저 적고 재실행 |

## 검색

| 기록 | 내용 |
|---|---|
| [10-search-threshold](10-search-threshold.md) | 얼마 미만이면 "없다"고 할 것인가 |
| [18-search-evaluation](18-search-evaluation.md) | 검색 평가 기록 |
| [19-search-questions](19-search-questions.md) | 검색 질문 검토표 |
| [21-embedding-shortlist](21-embedding-shortlist.md) | 임베딩 재선정 실험 카드 |
| [29-goldenset-and-db-cleanup](29-goldenset-and-db-cleanup.md) | 정답지 v2와 DB 정리 |

리랭커 평가는 [`web/evals/search/`](../web/evals/search/)에 실행 기록과 함께 있습니다.

## 배포·구조

| 기록 | 내용 |
|---|---|
| [06-cloud-ingest](06-cloud-ingest.md) | 클라우드에서 새 영상 추가 |
| [07-frontend](07-frontend.md) | v1에서 가져온 프론트엔드 |
| [12-v2-finish](12-v2-finish.md) | v2 마무리 |
| [main-vs-timestamp-release](main-vs-timestamp-release.md) | 브랜치 병합 시 주의 |
| [05-pending](05-pending.md) | 아직 안 건드린 것 |

## 기준 문서

| 기록 | 내용 |
|---|---|
| [00-methodology](00-methodology.md) | 기술 선정 프레임워크 |
| [20-development-evidence-framework](20-development-evidence-framework.md) | 개발·평가 공통 기준 |
| [blueprint-status](blueprint-status.md) | 청사진 7자리 현황 |
