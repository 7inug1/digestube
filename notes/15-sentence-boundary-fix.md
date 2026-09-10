# 문장 중간에서 잘리는 청킹 수정 — 2026-09-10

사용자 화면의 `-Z11mZaJU0w`에서 `progress your / career`와 `make sure that / that content`가 문단 경계에 걸렸다.
기존 코드는 자막 조각 마지막 글자만 확인하고, 길이가 700자를 넘으면 문장 중간에서도 출력했다.

## 변경

- 조각을 합친 전체 전사문에서 Intl.Segmenter로 문장 경계를 찾는다.
- 자막 내부 줄바꿈은 문장 끝이 아니므로 공백으로 정규화한다. 실제 native fixture에서 줄바꿈으로 잘리던 현상을 재현했다.
- 완성된 문장끼리 목표 340자에 맞춰 묶는다. 한 문장이 340자를 넘으면 700자까지 온전히 유지한다.
- 단일 문장이 700자를 넘거나 구두점이 없으면 공백을 우선해 나눈다. 이 경우까지 문장 중간 끊김이 없다고 주장하지 않는다.
- 문단 시각은 원본 자막의 범위를 사용한다. 문장별·단어별 정확한 시각을 추정해서 만들지 않는다.

## 기존 영상 복구

새 native/en 자막을 조회했으나 마지막 `day.`가 없는 등 기존 전사문과 달랐다.
그래서 영상의 기존 전사문을 보존하고 문단 경계만 다시 나누기로 했다.
원본의 더 잘게 나뉜 자막은 저장돼 있지 않아, 이 복구에서는 기존 문단의 시각 범위를 유지한다.
같은 원래 문단에서 나뉜 새 문단들은 시작 시각이 같을 수 있다. 이 한계는 사용자에게 안내했다.

`web/scripts/repair-chunking.ts`는 적용 전 video/chunk/outline/bookmark를 무시된 `data/repairs/`에 백업하고,
기존 revision이 바뀌지 않았는지 확인한다. 원래 수집 방식·언어·전사 날짜는 보존한다.
문단 변경 후 목차와 임베딩을 다시 생성한다. 북마크가 있으면 자동 복구를 중단한다.
이 스크립트는 이 영상의 고정된 원본에만 적용하며, 두 번째 적용은 revision 검사에서 차단한다.

## 재현과 검증

`web/`에서:

```sh
node --experimental-websocket --env-file=.env.local --import tsx scripts/repair-chunking.ts
node --import tsx --test tests/*.test.ts
```

- 수정 대상 고정 원본: `tests/fixtures/chunking-existing.json`.
- 별도 native 줄바꿈 재현 원본: `tests/fixtures/chunking-native.json`.
- 기존 전사문 내용 보존, `progress your career`가 같은 문단에 있음, 모든 수정 문단이 문장 끝으로 끝남을 검증했다.
- 이 영상은 기존 5문단에서 11문단이 된다. 11개 모두 종결 구두점으로 끝난다. 이는 이 사례의 경계 검사이며 일반적인 청킹 품질 점수가 아니다.
- 전체 테스트 12개 및 production build 통과. lint 오류 없음, 기존 이미지 최적화 경고 2개.
