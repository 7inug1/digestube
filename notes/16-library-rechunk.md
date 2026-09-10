# 기존 라이브러리 전체에 새 청킹 적용 — 2026-09-10

한 영상만 복구했던 범위를 기존 라이브러리 전체로 확장한다.
새 등록은 이미 POST /api/ingest → prepareTranscript → chunk를 통해 같은 청킹 로직을 사용한다.
이번에는 이 연결을 실제 native fixture로 확인하는 회귀 테스트도 추가했다.

## 일괄 처리

`web/scripts/rechunk-library.ts`:

- 저장된 모든 영상의 원문을 합쳐 현재 청킹 함수를 적용한다.
- 결과가 같은 영상은 문단을 다시 쓰지 않는다. 미완료 목차·임베딩은 이어서 처리한다.
- 변경할 영상은 video/chunk/outline/bookmark를 `data/repairs/`에 백업한다.
- 작업 예약과 revision 확인 후 교체하고, 원래 전사 방식·언어·날짜를 유지한다.
- 문단이 바뀌면 목차·임베딩을 다시 생성한다.
- 원문 보존, 모든 문단의 목차·임베딩 존재, 완료 상태, 메타데이터 보존을 검증한다.
- 북마크가 있으면 대상 재연결 작업 없이 삭제하지 않도록 중단한다.

```sh
# web/에서 조회만
node --experimental-websocket --env-file=.env.local --import tsx scripts/rechunk-library.ts
# 운영에 적용
node --experimental-websocket --env-file=.env.local --import tsx scripts/rechunk-library.ts --apply
```

목차 조회는 시각 대신 seq 순서로 정렬한다. 같은 자막 구간에서 나뉜 문단들도 순서가 유지된다.

## 한계

원본 자막 조각이 저장되지 않은 기존 영상은 원래 문단의 시간 범위를 사용한다.
마침표가 없는 텍스트나 700자를 넘는 단일 문장은 길이 기반 분할이 남는다.
전체 영상에 같은 알고리즘을 적용했다는 것과 모든 경계를 의미적으로 검증했다는 것은 구분한다.

## 검증

전체 테스트 13개, production build 통과. 변경 파일 lint 확인.
