/** 서버 한 번 실행 안에서 남은 시간.
 *
 *  라우트는 maxDuration 에서 끊긴다. 그 안에서 부르는 모델 호출이 더 오래 기다리면
 *  라우트가 먼저 죽고, 호출 쪽의 catch(= 폴백)에 닿지 못한다. 설계해 둔 폴백이
 *  정작 느린 날에 안 도는 것이다. 그래서 안쪽 타임아웃을 바깥 한도 안으로 줄인다.
 *
 *  until 은 "이 시각까지 끝내야 한다"(epoch ms). 없으면 원래 상한을 그대로 쓴다 —
 *  스크립트처럼 한도가 없는 곳에서는 예전과 같게 돈다. */

/** 이만큼도 안 남았으면 부르지 않는다. 불러 봐야 중간에 끊기고 값만 나간다. */
export const MIN_CALL_MS = 2000;

export class OutOfTime extends Error {
  constructor(what: string) { super(`${what}: 남은 시간이 부족합니다`); this.name = "OutOfTime"; }
}

/** 이번 호출에 줄 타임아웃. 상한(cap)과 남은 시간 중 짧은 쪽. 너무 짧으면 부르지 않고 던진다. */
export function timeoutFor(what: string, capMs: number, until?: number, now = Date.now()): number {
  if (until === undefined) return capMs;
  const ms = Math.min(capMs, until - now);
  if (ms < MIN_CALL_MS) throw new OutOfTime(what);
  return ms;
}
