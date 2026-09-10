# Digestube v2 웹 데모

Next.js·TypeScript·Supabase pgvector. 자막 등록 → 문단 분할 → 목차 → 전사문 읽기·의미 검색.

## 실행

Node 22 이상 권장. Node 20에서는 Supabase 클라이언트 때문에 `--experimental-websocket`이 필요하다.

```sh
npm ci
cp .env.local.example .env.local
npm run dev
```

환경 파일에 실제 키를 입력한다. `.env.local`, `.vercel`, 로컬 `data/db.json`은 git에서 제외한다.
배포 및 로컬 기본 전사 방식은 `SUPADATA_MODE=native`, 요청 언어는 `SUPADATA_LANG=ko`다.
코퍼스를 별도로 받아쓸 때만 로컬에서 `SUPADATA_MODE=generate`를 명시한다.

## DB 준비 / 업데이트

- 새 DB: `supabase/schema.sql` 실행 후 아래 migration 실행.
- 기존 DB: `supabase/migrations/20260910_finish_v2.sql`을 Supabase SQL Editor에서 실행.
- 코드 배포보다 DB migration을 먼저 적용한다. SQL은 반복 적용할 수 있다.
- 기존 영상의 `mode`는 NULL로 남긴다. 확인되지 않은 출처를 추정해서 채우지 않는다.

신규 처리부터 실제 요청 mode, 요청 언어, 응답 lang, 처리 완료 시각을 기록한다.
이미 등록된 영상은 `/api/ingest`에서 409를 반환한다. 화면에서 교체를 선택해야 `replace:true`가 전송된다.
새 전사 결과를 검증한 뒤 트랜잭션에서 문단·목차를 교체한다. 실패 시 기존 내용은 유지한다.
진행 중인 작업에는 토큰을 붙이고, 늦게 도착한 이전 전사의 결과가 새 데이터에 쓰이지 않게 한다.

## 목차와 검색 준비

- 목차 생성·길이·인용 검사 실패 시 한 번 재시도한다.
- 재실패하면 첫 문장을 말줄임표 포함 25자 이내로 표시한다.
- 대체 항목은 `source=fallback`, `quote=''`, 시도 수와 실패 사유로 기록한다. 인용 검증 성공으로 세지 않는다.
- 목차는 요청당 4문단, 임베딩은 요청당 16문단을 처리한다. 응답의 `left`가 0이 될 때까지 클라이언트가 이어 호출한다.
- 일부 저장 후 실패해도 등록 화면에서 같은 URL → ‘처리 이어하기’로 재개할 수 있다.
- 목차와 임베딩이 모두 있는 경우에만 영상 상태가 ‘완료’가 된다.

## 검증

```sh
npm test
npm run lint
npm run build
npx playwright test
```

`npm test`: 인용 재시도, 대체 제목 길이, 부적합 자막 거부, PostgreSQL 트랜잭션·동시 등록 보호·구버전 결과 거부.
DB 테스트는 로컬 PGlite에서 실행한다. pgvector 거리 계산은 이 테스트 범위 밖이며 embedding은 텍스트 도메인으로 대체한다.
브라우저 테스트는 로컬 데모를 사용한다. 쓰기 API는 가짜 응답으로 대체하며 실제 서비스 DB에 영상을 쓰지 않는다.
라이브러리·상세 읽기는 현재 DB 데이터를 사용한다.

## 데모의 범위

- native에는 한국어 번역 자막이 올 수 있다. 응답 언어가 요청 언어와 다르면 저장하지 않고 안내한다.
- 사람이 만든 자막인지 자동 자막인지는 판별하지 않는다.
- 청킹은 자막 줄바꿈을 공백으로 정리하고 전체 텍스트의 문장 경계를 찾은 뒤 묶는다. 단일 문장이 700자를 넘거나 구두점이 없으면 공백을 우선해 길이로 나눈다.
- 문단 시각은 경계가 들어 있는 원본 자막의 시각이다. 한 자막 안에서 나뉜 문단은 시각이 같을 수 있다.
- 인용 원문 대조는 제목 의미의 정확성을 보장하지 않는다. 사람 목차 평가는 보류 중이다.
- 무관한 질문의 검색 임계치와 임베딩 품질은 아직 확정 평가 전이다.

## 기존 영상에 청킹 변경 적용

새 영상은 등록 시 현재 청킹 코드를 자동으로 사용한다. 기존 영상은 `scripts/rechunk-library.ts`로
전체 조회·적용할 수 있다. 실행 절차와 한계는 `../notes/16-library-rechunk.md` 참고.
