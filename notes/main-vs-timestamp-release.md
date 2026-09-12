# main 에 생긴 변경과 fix/timestamp-release 병합 시 주의

2026-09-12 기준. Codex 가 `fix/timestamp-release` 워크트리에서 작업하는 동안
main 에서 일어난 일을 적는다.

## 1. 저장소가 공개됐다

- **https://github.com/7inug1/digestube** — PUBLIC
- v1 은 `7inug1/digestube-v1` 로 이름이 바뀌었다 (여전히 private)
- 로컬 `digestube-v2/` 의 remote 는 새 주소로 갱신돼 있다.
  워크트리는 `.git` 을 공유하므로 따로 손댈 것 없다

공개 전에 95커밋 전체에서 키 패턴(`sk-ant-` `gsk_` `hf_` JWT `sbp_`)을 훑었고
0건이었다. 실제 `.env.local` 과 `server/.env` 는 gitignore 에 있고
추적되는 건 `web/.env.local.example`(placeholder) 하나다.

`_old/`(103MB, v1 사본)와 `work_review/`(청크 검수 작업 파일)를 gitignore 에 넣었다.
공개 저장소에 올리지 않는다.

## 2. main 에 커밋 2개가 생겼다

### 97e5235 — 그때 커밋 안 돼 있던 것 전부

main 체크아웃의 작업 트리에 21개가 커밋되지 않은 채 있어서 한 번에 넣었다.
빌드는 통과한 상태로 넣었다.

- `chunker.ts`: 무음 기반 문장 경계 (`PAUSE_SEC = 0.3`)
- `store.*`: `video.raw` 에 원본 조각(시각 포함) 저장
- `/api/rechunk`: 재전사 없이 다시 자르는 경로
- `migrations/20260910_raw_pieces.sql`: `raw` 칼럼 + `rechunk` RPC (service_role 만 execute)
- 타임스탬프 정렬 스크립트 4개와 `tests/browser/timestamps.spec.ts` —
  **이건 `fix/timestamp-release` 에 있는 것과 내용이 같다.** 병합 때 그대로 지나간다

### f4189ec — 대표 주소 교체

`README.md` `AGENTS.md` `scripts/rechunk-library.ts` `scripts/repair-chunking.ts` 의
기본 주소를 바꿨다. `notes/` 는 그때의 기록이라 건드리지 않았다.

## 3. 배포 주소가 바뀌었다

| 주소 | 가리키는 것 |
|---|---|
| **https://digestube.vercel.app** | v2 (대표 주소) |
| https://digestube-v2.vercel.app | v2 (옛 주소, 계속 열린다) |
| https://digestube-v1.vercel.app | v1 |

Vercel 프로젝트 이름도 `digestube-v2` -> `digestube`, `web` -> `digestube-v1` 로 바꿨고
각 프로젝트에 도메인을 붙여놔서 앞으로 배포하면 자동으로 붙는다.

## 4. 병합하면 충돌하는 파일 3개

`git merge-tree main fix/timestamp-release` 로 미리 돌려본 결과다.

| 파일 | 왜 |
|---|---|
| `AGENTS.md` | 양쪽이 각자 섹션을 붙였다. 둘 다 살리면 된다 |
| `web/src/components/YouTube.tsx` | 양쪽이 플레이어를 각자 건드렸다 |
| **`web/src/lib/chunker.ts`** | **같은 문제에 서로 다른 해법이 붙었다 — 아래** |

나머지 8개(`ingest/route.ts`, `Reader.tsx`, 스크립트 4개, `transcript-source.ts`,
`timestamps.spec.ts`)는 자동 병합되거나 내용이 같다.

## 5. chunker.ts — 구두점 없는 전사에 해법이 둘

둘 다 "구두점이 없어 문장 끝을 못 찾고 MAXLEN 마다 잘린다"를 고치려는 것이다.
서로 배타적이지 않다.

**main (무음 기반)** — 조각의 시각 간격을 본다.
```ts
export const PAUSE_SEC = 0.3;
if (prevEnd !== null && t - prevEnd >= PAUSE_SEC) pauses.push(start);
```
실측: 3분 영상 204조각에서 간격 중앙값 -0.98초(조각끼리 겹침), 0.3초 초과는 9개.
드물어서 목표 길이를 넘겼을 때만 쓴다.

**fix/timestamp-release (어미 기반)** — 종결어미를 찾는다.
```ts
const endings = /[가-힣]+(?:니다|거든요|잖아요|는데요|어요|아요|해요|예요|에요|네요|군요|죠)(?=\s|$)/gu;
```
`sentence.segment.length > maxlen` 이고 구두점이 없을 때만 적용한다.

**병합 쪽 브랜치에서 main 의 `PAUSE_SEC` 블록이 통째로 지워져 있다.**
Codex 가 분기한 시점에 그 코드가 커밋되지 않은 상태였기 때문이지,
빼기로 판단한 게 아니다. 그냥 병합하면 무음 기반이 사라진다.

합칠 거면 순서는 이렇게 된다: 어미를 먼저 찾고, 그래도 maxlen 을 넘으면 무음으로 자른다.
어느 쪽을 쓸지 / 합칠지는 측정으로 정하는 게 맞다 — 같은 전사문에 셋(무음만 / 어미만 / 둘 다)을
돌려 문장 중간에서 끊긴 청크 수를 세면 된다.

## 6. 브랜치 상태

```
fix/timestamp-release 가 main 보다 앞선 커밋: 14
main 이 앞선 커밋: 2
```

Codex 쪽 14커밋에는 notes 3개(`17-timestamp-release`, `18-search-evaluation`,
`19-search-questions`)와 `notes/search-review.html` 이 있다.
main 의 notes 는 16번까지라 번호는 겹치지 않는다.
