# 프론트엔드 — v1에서 가져온 것

상태: 뼈대 이식 완료 (`web/app`)

## 왜 이것만 가져왔나

v2는 v1의 **결과를 안 보고 다시 판단하는 것**이 목적이다. 그래서 v1 코드는
원칙적으로 가져오지 않는다. 프론트만 예외로 둔 이유는 화면이 기술 선정
일곱 자리 어디에도 없기 때문이다 — 고를 것이 없는 자리라 다시 판단할 것도 없다.

## 선을 어디에 그었나

| 가져온 것 | 왜 안전한가 |
|---|---|
| `index.css` | 색·활자 토큰과 CSS 규칙. 판단이 아니라 표현 |
| `theme.tsx` | 라이트/다크/시스템 세 상태. 도메인과 무관 |
| `components/ui/icons.tsx` | SVG 도형 |
| `components/ui/primitives.tsx` | Btn·Input·Sec·Stamp·ConfirmModal·StatusScreen |
| `mm()` · `firstSentence()` | 초 → 0:00 같은 순수 함수 |

| 안 가져온 것 | 왜 |
|---|---|
| `App.tsx`(1,292줄) · `screens/*` · `Found.tsx` · `Karaoke.tsx` | v1의 검색·목차 설계가 박혀 있다. 임계치·하이라이트 방식은 v2에서 다시 정한다 |
| `constants.ts` | v1이 고른 영상 목록. 데이터다 |
| `server.ts` · `route.ts` · `data.ts` | v1 백엔드 계약과 데이터 모양 |
| `golden_search.json` · `scripts/evaluate.py` | **정답지와 평가 방식은 판단물이다.** 가져오면 v2 판정이 v1 판정에 묶인다 |

`data/원본(supadata)/` 전사 6편은 판단물이 아니라 남의 API 출력이라 성격이
다르다. 가져올지는 아직 정하지 않았다 — 가져온다면 "v1이 고른 영상 세트"라는
사실을 함께 적어야 한다.

## 가져오면서 지킨 규칙 하나

`index.css`에 이렇게 적혀 있다.

> 검색은 우리가 고른 게 아니라 사용자가 그때그때 찾은 것이다.
> 형광펜(노랑)은 우리가 남긴 것에만 쓴다는 규칙을 지키려면
> 검색 일치는 색이 아니라 굵기 + 밑줄로 구분한다.

v2 검색 결과의 하이라이트 문장도 이 규칙을 따른다(`.searchmark`).

## 새로 쓴 것

- `src/api.ts` — `server.py`의 네 라우트를 타입으로 고정
- `src/App.tsx` — 넣기 · 영상 목록 · 검색. **점수를 그대로 노출한다**
  (임계치를 아직 안 정했다. 눈으로 보고 정하려는 것이라 자르지 않는다 —
  `web/lib/search.py` 참고)

## 띄우는 법

```
python3 web/server.py          # API · 8030
cd web/app && npm run dev      # 화면 · 5288 (v1 프론트가 5188을 쓰고 있다)
```

Vite가 `/api`를 8030으로 넘긴다. 브라우저에서 직접 8030을 부르면 포트가 달라
막히고, `server.py`도 루프백에서 온 것만 받는다.
