/** 전사 재생 시각 밀림 확인.
 *
 *  3.8 Flash 가 가끔 앞부분은 맞다가 뒤로 갈수록 시각을 늘려 적는다(notes/38: 10.9분 영상에서
 *  4번 중 2번, 마지막 시각이 영상 끝보다 49~74초 뒤). 이때 마지막 조각이 요청한 구간 끝을 넘는다.
 *  넘으면 한 번 다시 받아쓰고, 그래도 넘으면 덜 밀린 쪽을 쓴다.
 *  비율로 줄여 맞추지 않는다 — 밀림은 중간부터 시작돼, 전체를 줄이면 맞던 앞부분이 틀어진다. */
export type TimedPiece = { offset: number; duration: number };

/** 넘침 허용치. 정상 전사는 마지막 시각이 영상 끝보다 앞이었다(notes/38 에서 -2~-11초). */
export const DRIFT_TOLERANCE_SEC = 10;

/** 마지막 조각이 끝난 시각이 기대한 끝을 몇 초 넘었는지. 음수면 넘지 않았다. */
export function overshoot(pieces: TimedPiece[], expectedEndSec: number): number {
  if (!pieces.length) return 0;
  const last = Math.max(...pieces.map(p => p.offset + p.duration)) / 1000;
  return Math.round((last - expectedEndSec) * 10) / 10;
}

type Attempt = { result: { content?: unknown } };
const piecesOf = (a: Attempt): TimedPiece[] => (Array.isArray(a.result.content) ? (a.result.content as TimedPiece[]) : []);

/** 받아쓰고, 밀렸으면 시간이 남을 때 한 번 더 받아쓴다. drift 는 쓰기로 한 결과의 넘침(초). */
export async function withDriftRetry<T extends Attempt>(
  attempt: () => Promise<T>,
  expectedEndSec: number | undefined,
  canRetry: (firstElapsedMs: number) => boolean,
): Promise<{ value: T; drift: number | null; retried: boolean }> {
  const started = Date.now();
  const first = await attempt();
  if (expectedEndSec === undefined) return { value: first, drift: null, retried: false };
  const d1 = overshoot(piecesOf(first), expectedEndSec);
  if (d1 <= DRIFT_TOLERANCE_SEC || !canRetry(Date.now() - started)) return { value: first, drift: d1, retried: false };
  let second: T;
  try {
    second = await attempt();
  } catch {
    return { value: first, drift: d1, retried: true };
  }
  const d2 = overshoot(piecesOf(second), expectedEndSec);
  return d2 < d1 ? { value: second, drift: d2, retried: true } : { value: first, drift: d1, retried: true };
}
