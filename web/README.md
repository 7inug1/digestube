# Digestube 웹 실행 안내

서비스와 기능 소개는 [루트 README](../README.md)를 참고하세요.

## 실행

Node.js 22 이상 권장.

```sh
npm ci
cp .env.local.example .env.local
npm run dev
```

`.env.local`에 다음 값을 설정합니다.

- `GEMINI_API_KEY`: 전사·주제 청킹·목차 생성
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: 서버의 DB·Storage 접근
- `HF_TOKEN`: KURE-v1 임베딩
- 선택: `SUPADATA_API_KEY`는 플레이리스트 조회와 Supadata 전사 경로, `ANTHROPIC_API_KEY`는 Anthropic 목차 경로에 사용

기본 전사 공급자는 Gemini입니다. `TRANSCRIPT_PROVIDER`, `GEMINI_TRANSCRIBE_MODEL`, `TOPIC_CHUNK_MODEL`, `OUTLINE_MODEL`로 변경할 수 있습니다. 서비스 역할 키는 클라이언트 환경변수로 노출하지 않습니다.

## Supabase 준비

1. [schema.sql](supabase/schema.sql)을 실행합니다.
2. [migrations/](supabase/migrations/)의 SQL을 파일명 순서로 적용합니다.
3. 비공개 Storage 버킷 `transcript-sources`를 생성하고 서버의 서비스 역할 키 접근을 확인합니다.

원본 발화는 재청킹에 사용합니다. 재등록은 사용자 확인 후 새 전사를 검증하고 교체하며, 기존 영상은 등록만으로 자동 재청킹되지 않습니다.

## 검증

```sh
npm test
npm run lint
npm run build
npx playwright test
```

단위·DB 테스트는 외부 모델 호출 없이 실행합니다. 브라우저 테스트 중 라이브러리·상세 화면은 설정된 DB의 저장 영상을 사용합니다. 실험 자료와 현재 DB가 달라지면 관련 테스트의 전제도 확인해야 합니다.
