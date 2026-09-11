# 문단 경계와 원본 자막 시각 — 2026-09-11

## 변경

- 기존 문단을 원본 조각처럼 재사용하면 새 문단에 같은 시각이 붙는다. 기존 8편은 저장 전사문과 native 원본 자막의 일치 구절을 대조해 실제 자막 조각 시작 시각으로 보정했다.
- 시각 버튼은 소수점 초를 그대로 전달한다. 플레이어 준비 전 클릭도 준비 후 실행한다. 같은 자막 조각을 공유하는 문단은 클릭한 문단만 선택 표시한다.
- 앞으로 등록하는 영상은 전체 자막의 문장 경계를 찾고, 문단 시작을 포함하는 원본 자막 조각의 시각을 사용한다. 원본 응답은 비공개 Supabase Storage `transcript-sources`에 보관한 뒤 DB를 교체한다.
- 구두점 없는 긴 한국어 자막은 존댓말 종결 표현을 추가 경계 후보로 사용한다. 완전한 형태소 분석이 아닌 보수적인 규칙이다. 마침표가 있는 문장은 그대로 처리한다. 시간 간격만으로 문장 중간을 자르지 않는다.
- PlawByYfV8k는 원문을 바꾸지 않고 5→10문단으로 재분할했다. 새 목차·벡터를 먼저 생성한 뒤 교체했다. 나머지 7편은 문단 본문을 유지했다.

## 검증과 한계

- 단위·DB 테스트 15개, Python 시각 대조 테스트 3개 통과.
- 브라우저에서 준비 전 클릭을 보존하고 31.36초를 그대로 전달하는 테스트 통과.
- `scripts/verify-timestamps.ts`로 전체 원문 보존, 자막 시작 시각 대응, 목차 시각 일치, 벡터 존재, 상태 완료, 원본 보관을 확인한다.
- 원본 자막은 단어별 시간이 아니다. 한 조각 안에 여러 문장이 있으면 재생이 문장보다 조금 앞에서 시작할 수 있다. 실제 음성을 단어 단위로 정렬한 것은 아니다.
- 기존 전사 오류로 두 문단은 자동 판정 기준을 충족하지 못해 일치 구절을 읽고 수동 예외를 기록했다. `scripts/apply-timestamps.ts`의 reviewed 참조. 해당 원문 오류를 고쳤다는 뜻은 아니다.
- 종결 표현도 없거나 개별 문장이 700자를 넘으면 길이 제한에 의한 분할은 남는다. 모든 자막에서 문장 끊김 0%라고 주장하지 않는다.
- 원본 텍스트 자체의 심한 오인식(특히 PlawByYfV8k)은 이번 작업 범위의 교정 대상이 아니다.

## 재현

`web`에서 Node 20 사용:

```sh
npm test
python3 -m unittest discover -s scripts -p 'test_timing_alignment.py'
node --experimental-websocket --env-file=.env.local --import tsx scripts/verify-timestamps.ts <원본스냅샷폴더>
PLAYWRIGHT_BASE_URL=https://digestube-v2.vercel.app npx playwright test tests/browser/timestamps.spec.ts
```

원본과 백업은 `web/data/repairs/`에 있고 git·배포 업로드에서 제외한다. 기존 8편의 최초 시각 백업은 원래 작업 폴더의 `web/data/repairs/timing-20260910/`에 있다. 후속 문단 수정 백업은 이 배포 작업 폴더의 `web/data/repairs/boundaries-*/`에 있다.

## 작업 분리

원래 작업 폴더에 별도의 raw 컬럼·rechunk API·침묵 기반 분할 변경이 남아 있어, 이를 덮어쓰거나 미적용 DB 스키마에 의존하는 코드를 함께 배포하지 않도록 `fix/timestamp-release` 브랜치에서 검증·배포한다. main의 미커밋 작업은 유지한다. 다음 배포는 이 브랜치를 기준으로 합쳐야 이번 수정이 되돌아가지 않는다.

## 배포

- 앱 커밋 `d7c0b77`, 운영 배포 `https://digestube-v2-49uen1hsv-7inug1s-projects.vercel.app`.
- 별칭 `https://digestube-v2.vercel.app`에 적용 완료.
- 최종 DB 검증: 8편·89문단. 원문 보존, 원본 시각 대응, 목차·벡터·완료 상태, 비공개 원본 보관 확인.
- 신규 원본 저장 함수로 생성한 테스트 자료의 업로드·다운로드·시각 보존 확인 후 테스트 자료 삭제.
