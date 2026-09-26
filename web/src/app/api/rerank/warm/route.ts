import { rerank } from "@/lib/rerank";

export const maxDuration = 60;

/** 리랭커를 깨운다. 짧은 입력 하나를 넉넉한 시간으로 보내 서버가 뜨게 한다.
 *  결과는 쓰지 않는다 — 다음 검색이 5초 안에 답을 받게 하는 것이 목적이다. */
export async function POST() {
  const r = await rerank("깨우기", ["깨우기"], 45000);
  return new Response(null, { status: "error" in r ? 503 : 204 });
}
