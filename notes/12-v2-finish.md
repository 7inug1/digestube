# v2 마무리 — 2026-09-10

사용자와 합의한 범위: Native 자막 등록, 문장 끝·길이 기반 문단 분할, 목차 생성,
전사문 읽기, 의미 검색. 물어보기·핵심 하이라이트·목차 모델 최종 선정은 보류.

## 변경

- 기준 코드 커밋: `d6fe0e5`. 환경변수·배포 인증 파일·로컬 DB는 제외했다.
- 기존 영상 재등록: 409와 기존 영상 링크, 교체를 별도로 확인한다.
- 전사 교체: 입력 검증 후 DB 트랜잭션으로 문단·목차·벡터를 교체한다. 실패하면 이전 데이터가 남는다.
- 동시 작업: 영상별 예약 토큰으로 중복 처리를 막고, 이전 revision에 대한 늦은 목차·벡터 저장을 거부한다.
- `video.mode`, `requested_lang`, 기존 `lang`, `transcribed_at`으로 최근 성공한 전사의 출처를 기록한다.
  과거 이력을 모두 보존하는 감사 로그는 아니며, 기존 영상 mode는 추정하지 않는다.
- 목차: 실패 시 한 번 재시도, 재실패 시 첫 문장(말줄임표 포함 25자 이내)으로 대체한다.
  fallback 여부·시도 수·실패 사유를 기록한다. 임시 문구를 검증된 생성 제목으로 세지 않는다.
- 목차와 임베딩을 제한된 묶음으로 처리하고, 클라이언트가 남은 작업을 이어 호출한다.
  목차 오류를 무시하던 처리를 없애고 화면에서 실패 및 재개를 안내한다.

## 운영 반영

DB migration: `web/supabase/migrations/20260910_finish_v2.sql`.
2026-09-10 사용자가 SQL Editor에서 적용한 뒤, 컬럼 및 RPC 7개 노출을 확인했다.
앱 커밋 `328200e`를 운영에 배포했다.
- 운영: https://digestube-v2.vercel.app
- 해당 배포: https://digestube-v2-4vh755eih-7inug1s-projects.vercel.app
- Vercel deployment ID: `Cr2mmeyy76mgvLPeUhU4x5h4V5XJ`

## 이력서

[Digestube 재작성안](13-digestube-resume.md). 구현·배포를 확인한 내용으로 정리했다.
모델 품질 검증이나 사용자 효과 측정까지 완료했다고 표현하지 않는다.

## 검증 기록

- `npm test`: 5개 통과. Node 20.19.5에서 검증. Node 23.3.0에서는 PGlite 실행이 한 차례 멈춰 종료하고 안정 버전에서 재확인했다.
- `npx playwright test`: 3개 통과. 교체 전 확인·취소, 처리 실패 후 재개, 실제 기존 영상 목록·상세 표시.
- `npm run lint`: 오류 없음. 기존 이미지 태그에 대한 최적화 권고 경고 2개가 남는다.
- TypeScript 검사 및 Next.js production build 통과.
- 실제 로컬 API: 목록·영상 상세·검색 200, 중복 등록 409 확인. 재현: `web/scripts/smoke-readonly.mjs`.
- 운영 DB migration 적용 및 신규 영상 `PlawByYfV8k`의 실제 native 전사 → DB 저장 → 목차 → 임베딩 준비까지 확인했다.
  mode=native, requested_lang=ko, lang=ko, status=완료. 문단 4개, 목차 4개, fallback 0개.
  이 영상은 작업 전 DB에 없음을 확인한 뒤 새로 추가했다. 기존 7개 영상은 교체하지 않았다.
- 운영 목록·기존 상세·검색 응답 및 중복 등록 차단은 `scripts/smoke-readonly.mjs https://digestube-v2.vercel.app`로 확인했다.
- 새 영상 처리 재현: `DIGESTUBE_BASE_URL=https://digestube-v2.vercel.app node scripts/fill.mjs <미등록 영상 ID>`.
  이미 등록된 ID를 넣으면 409로 중단한다. 외부 API 사용량이 발생한다.
- 실패 시 롤백 및 구버전 응답 방어는 PostgreSQL 테스트로 검증했다. 운영에서 의도적으로 기존 데이터를 교체하거나 실패를 유발하지 않았다.
