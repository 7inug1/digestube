/** 벡터로 넓게 찾은 후보를 "이 문단이 질문에 답하는가"로 다시 줄 세운다.
 *
 *  벡터 검색은 주제가 같은 문단을 모두 가깝게 본다. 한 주제로 된 영상에서는 요약·도입
 *  문단이 어떤 질문에든 끌려와 정답 문단을 밀어냈다(2026-09-19 개발 평가: 필수 근거 35%).
 *  질문과 문단을 짝지어 직접 보는 리랭커로 후보 10개를 다시 세우면 47%였다.
 *  같은 12문항으로 원인을 찾고 다시 잰 개발 반복이라 최종 검증은 아니다.
 *
 *  느리다(실제 문단 10개 약 2.6~2.9초, 콜드 스타트는 10초 이상). 그래서 화면은 벡터 결과를
 *  먼저 보여 주고 리랭크가 끝나면 순서를 다듬는다. 5초 안에 못 오면 벡터 순서를 그대로 둔다.
 *  처음엔 3초로 잡았는데 실제 문단으로 재니 자주 잘렸다. 결과가 먼저 보이므로 5초를 기다려도
 *  읽기는 막히지 않는다 — 결과 위 "정리하는 중" 표시가 조금 더 떠 있을 뿐이다. */

export const RERANK_MODEL = process.env.RERANK_MODEL ?? "Dongjin-kr/ko-reranker";
/** 다시 줄 세울 후보 수. 20개와 10개가 같은 근거 충족(8/17)이었고 10개가 빠르다. */
export const RERANK_POOL = 10;
export const RERANK_TIMEOUT_MS = 5000;

export type RerankOutcome = { scores: number[] } | { error: "timeout" | "error"; detail: string };

/** 입력마다 [{label, score}] 하나씩, 입력 순서 그대로 와야 한다(top_k: null 일 때).
 *  빠뜨리면 모든 점수가 한 배열에 묶여 온다 — 실제로 그랬다. 모양이 다르면 쓰지 않는다. */
export function readScores(body: unknown, n: number): number[] | null {
  if (!Array.isArray(body) || body.length !== n) return null;
  const out: number[] = [];
  for (const x of body) {
    if (!Array.isArray(x) || x.length !== 1 || typeof x[0]?.score !== "number") return null;
    out.push(x[0].score);
  }
  return out;
}

export async function rerank(q: string, texts: string[], timeoutMs = RERANK_TIMEOUT_MS,
  fetcher: typeof fetch = fetch): Promise<RerankOutcome> {
  const t = process.env.HF_TOKEN;
  if (!t) return { error: "error", detail: "HF_TOKEN 이 없다" };
  try {
    const r = await fetcher(`https://router.huggingface.co/hf-inference/models/${RERANK_MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: texts.map(p => ({ text: q, text_pair: p })),
        parameters: { function_to_apply: "none", top_k: null, truncation: true } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { error: "error", detail: `HTTP ${r.status}` };
    const scores = readScores(await r.json(), texts.length);
    return scores ? { scores } : { error: "error", detail: "응답 모양이 다름" };
  } catch (e) {
    const name = (e as Error).name;
    return name === "TimeoutError" || name === "AbortError"
      ? { error: "timeout", detail: `${timeoutMs}ms 초과` }
      : { error: "error", detail: (e as Error).message.slice(0, 120) };
  }
}

/** 점수 높은 순으로 k 개. 점수가 같으면 원래(벡터) 순서를 지킨다. */
export function reorder<T>(pool: T[], scores: number[], k: number): T[] {
  return pool.map((h, i) => ({ h, s: scores[i], i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, k).map(x => x.h);
}

/** 이 점수보다 1위가 낮으면 "질문과 딱 맞는 대목은 없을 수 있다"고 알린다.
 *
 *  벡터 점수로는 못 가른다 — 답 있는 질문 1위 0.545~0.667, 답 없는 질문 0.544·0.619 로 겹친다.
 *  리랭커 1위 점수는 갈린다(2026-09-19 개발 평가 12문항, 후보 10개):
 *    답 있음 9.86 · 4.52 · 1.85 · 0.71 · -1.61 · -3.13 · -3.20 · -6.99
 *    답 없음 -5.44 · -7.04 · -7.18 · -7.66
 *  -3.20 과 -5.44 사이에서 골랐고, 12개 중 11개를 가른다(-6.99 는 경고가 붙는다).
 *  개발에 쓴 질문으로 고른 값이라 독립 검증은 아니다. 그래서 결과를 숨기지 않고 알리기만 한다 —
 *  틀려도 답이 사라지지 않는다. */
export const WEAK_SCORE = -4;

/** 후보 전체의 리랭커 점수를 보고 판단한다. 점수가 없으면(리랭커 실패·시간 초과) 판단하지 않는다. */
export function weakMatch(scores: number[]): boolean | null {
  if (!scores.length) return null;
  return Math.max(...scores) < WEAK_SCORE;
}
