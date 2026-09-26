/** 검색 응답(/api/search?stream=1)을 한 줄씩 읽어 화면 상태로 만든다.
 *
 *  서버는 먼저 벡터 결과(hits)를 보내고, 리랭커가 순서를 바꾸면 reranked, 끝나면 done 을 보낸다.
 *  검색 화면과 읽기 화면이 같은 응답을 읽으므로 읽는 법을 한곳에 둔다.
 */
import type { FoundHit } from "@/components/Found";

export type Line =
  | { t: "hits"; hits: FoundHit[] }
  | { t: "reranked"; hits: FoundHit[] }
  | { t: "done"; reranked: boolean; weak?: boolean | null }
  | { t: "error"; error: string };

export type SearchState = {
  /** null 은 아직 아무것도 못 받은 상태 — 자리표시를 보여 줄 때다 */
  hits: FoundHit[] | null;
  refining: boolean;
  /** 1위 리랭커 점수가 기준보다 낮았다. 판단하지 못했으면(null) 약하다고 하지 않는다 */
  weak: boolean;
  failed: string;
  /** 처리가 다 끝났다. 화면은 이때 한 번만 결과를 보여 준다 — 먼저 보여 줬다가 순서를 바꾸면
   *  사용자는 다듬기 같은 내부 사정을 신경 써야 한다(2026-09-26 사용자 지적). */
  done: boolean;
};

export const EMPTY: SearchState = { hits: null, refining: false, weak: false, failed: "", done: false };

export function step(s: SearchState, m: Line): SearchState {
  switch (m.t) {
    case "hits": return { ...s, hits: m.hits, refining: m.hits.length > 0 };
    case "reranked": return { ...s, hits: m.hits };
    case "done": return { ...s, refining: false, weak: m.weak === true, done: true };
    case "error": return { ...s, failed: m.error, hits: s.hits ?? [], refining: false, done: true };
  }
}

/** 받은 글을 줄로 자른다. 마지막 줄이 덜 왔으면 rest 로 남겨 다음 조각에 붙인다. */
export function splitLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map(l => l.trim()).filter(Boolean), rest };
}
