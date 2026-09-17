/** 질문과 가까운 문단을 찾는다.
 *
 *  글자가 같은지가 아니라 뜻이 가까운지를 본다. 말로 한 걸 받아쓴 글이라
 *  표현이 제각각이어서 글자 검색으로는 못 찾는다.
 *    찾는 것   "잠 부족하면 안 좋다"
 *    영상엔    "수면이 부족하면 기억력이 떨어져요"
 *
 *  비교는 DB 가 한다(schema.sql 의 search_chunks). 벡터를 정규화해 저장했으므로
 *  코사인 거리로 정렬하면 된다.
 *
 *  아직 정하지 않은 것: 유사도가 얼마 미만이면 "없다"고 할 것인가.
 *  지금은 자르지 않고 전부 돌려준다 — 점수를 눈으로 보고 정하려는 것이다.
 */
import { embed, embedOne } from "./embed";
import { search as searchStore, type Hit } from "./store";

export type Found = Hit & { hl?: string; hl_score?: number };

const SPLIT = /(?<=[.!?。？！])\s+/;

/** 짚어줄 후보가 되는 문장.
 *
 *  짧은 문장은 뺀다. "근데 그게 싫더라고", "안 만나면 돼" 같은 것이 뽑히면
 *  그 자체로는 아무 뜻이 없어서 왜 걸렸는지 알려주지 못한다. 게다가 짧을수록
 *  벡터가 불안정해 아무 질문에나 중간 점수가 나온다.
 *  20자로 잡았다 — 재서 정한 값이 아니라 위 결과를 보고 고른 값이다. */
const MIN_LEN = 20;

export function sentences(text: string): string[] {
  const all = text.split(SPLIT).map((s) => s.trim());
  const long = all.filter((s) => s.length >= MIN_LEN);
  // 다 짧으면 어쩔 수 없이 그중 제일 긴 것을 쓴다
  return long.length ? long : all.sort((a, b) => b.length - a.length).slice(0, 3);
}

/** 문단 안에서 질문과 제일 가까운 문장을 짚어준다.
 *
 *  뜻으로 찾은 것이라 글자가 겹치지 않을 수 있다. 그래서 어디를 보고 걸렸는지
 *  사람이 알 수 없다. 문단을 문장으로 쪼개 각각을 질문과 대보고 제일 가까운
 *  문장을 표시한다.
 *
 *  상위 몇 개만 본다 — 전부 하면 문장이 수십 개가 되어 느려진다.
 *  문장을 한 번에 묶어 보낸다. 문단마다 따로 부르면 왕복이 그만큼 늘어난다.
 */
async function highlight(qv: number[], hits: Found[], topN = 3, perChunk = 10) {
  const targets = hits.slice(0, topN);
  const flat: string[] = [];
  const owner: number[] = [];
  targets.forEach((h, i) => {
    for (const s of sentences(h.text).slice(0, perChunk)) { flat.push(s); owner.push(i); }
  });
  if (!flat.length) return;

  let vs: number[][];
  try {
    vs = await embed(flat);
  } catch {
    return;   // 짚어주기는 덤이다. 실패해도 검색 결과는 그대로 낸다
  }

  const best = new Map<number, { s: string; score: number }>();
  vs.forEach((v, k) => {
    const score = v.reduce((a, x, j) => a + x * qv[j], 0);
    const i = owner[k];
    if (score > (best.get(i)?.score ?? -2)) best.set(i, { s: flat[k], score });
  });
  for (const [i, { s, score }] of best) {
    targets[i].hl = s;
    targets[i].hl_score = Math.round(score * 10000) / 10000;
  }
}

/** 가까운 문단 k개. 기본은 판단하기 쉬운 세 대목만 보여준다. */
/** ids 를 주면 그 영상 안에서만 찾는다 — 내 라이브러리로 좁히는 데 쓴다.
 *  빈 배열은 "찾을 곳이 없다"는 뜻이라 바로 빈 결과다(전체 검색이 아니다). */
export async function find(q: string, vid?: string, k = 3, ids?: string[]): Promise<Found[]> {
  const query = (q ?? "").trim();
  if (!query) return [];
  if (ids && !ids.length) return [];
  const qv = await embedOne(query);
  const hits = (await searchStore(qv, k, vid, ids)) as Found[];
  await highlight(qv, hits);
  return hits;
}
