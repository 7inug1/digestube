/** 전사 재생 시각 밀림 확인.
 *
 *  3.8 Flash 가 가끔 앞부분은 맞다가 뒤로 갈수록 시각을 늘려 적는다(notes/38: 10.9분 영상에서
 *  4번 중 2번, 마지막 시각이 영상 끝보다 49~74초 뒤). 이때 마지막 조각이 요청한 구간 끝을 넘는다.
 *  끝을 넘지 않고 중간에서 시각이 튀는 경우도 있다(notes/38: 85분 영상 20분 구간에서 3분이 비고,
 *  구간 끝에 약 5분 치 말이 한 조각에 몰림). 그래서 끝 넘침·빈틈·몰린 조각을 함께 본다.
 *  어긋났으면 한 번 다시 받아쓰고, 그래도 어긋나면 덜 어긋난 쪽을 쓴다.
 *  비율로 줄여 맞추지 않는다 — 밀림은 중간부터 시작돼, 전체를 줄이면 맞던 앞부분이 틀어진다. */
export type TimedPiece = { offset: number; duration: number; text?: string };

/** 넘침 허용치. 정상 전사는 마지막 시각이 영상 끝보다 앞이었다(notes/38 에서 -2~-11초). */
export const DRIFT_TOLERANCE_SEC = 10;
/** 조각 사이 빈틈 허용치. 정상 전사 70건에서 가장 긴 빈틈은 33초(영상 앞 음악), 어긋난 구간은 187초.
 *  음악·침묵이 90초를 넘는 영상은 한 번 더 받아쓰는 비용을 치른다. */
export const GAP_TOLERANCE_SEC = 90;
/** 한 조각 글자 수 허용치. 정상 전사 70건에서 가장 긴 조각은 244자, 몰린 조각은 2,858자. */
export const PIECE_CHAR_LIMIT = 1000;

/** 마지막 조각이 끝난 시각이 기대한 끝을 몇 초 넘었는지. 음수면 넘지 않았다. */
export function overshoot(pieces: TimedPiece[], expectedEndSec: number): number {
  if (!pieces.length) return 0;
  const last = Math.max(...pieces.map(p => p.offset + p.duration)) / 1000;
  return Math.round((last - expectedEndSec) * 10) / 10;
}

/** 끝 넘침, 조각 시작 사이 가장 긴 빈틈(마지막 조각 뒤 구간 끝까지 포함), 가장 긴 조각 글자 수. */
export function timing(pieces: TimedPiece[], expectedEndSec: number) {
  const starts = pieces.map(p => p.offset / 1000).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < starts.length; i++) maxGap = Math.max(maxGap, starts[i] - starts[i - 1]);
  if (starts.length) maxGap = Math.max(maxGap, expectedEndSec - starts[starts.length - 1]);
  maxGap = Math.round(maxGap * 10) / 10;
  const maxChars = pieces.reduce((m, p) => Math.max(m, p.text?.length ?? 0), 0);
  const over = overshoot(pieces, expectedEndSec);
  const ok = over <= DRIFT_TOLERANCE_SEC && maxGap <= GAP_TOLERANCE_SEC && maxChars <= PIECE_CHAR_LIMIT;
  return { overshoot: over, maxGap, maxChars, ok };
}

type Attempt = { result: { content?: unknown } };
const piecesOf = (a: Attempt): TimedPiece[] => (Array.isArray(a.result.content) ? (a.result.content as TimedPiece[]) : []);
type Timing = ReturnType<typeof timing>;
/** a 가 b 보다 덜 어긋났나. 정상인 쪽 → 덜 넘친 쪽 → 빈틈이 짧은 쪽 순으로 본다. */
const lessOff = (a: Timing, b: Timing) =>
  a.ok !== b.ok ? a.ok : a.overshoot !== b.overshoot ? a.overshoot < b.overshoot : a.maxGap < b.maxGap;

/** 받아쓰고, 어긋났으면 시간이 남을 때 한 번 더 받아쓴다.
 *  drift 는 쓰기로 한 결과의 넘침(초), gap 은 가장 긴 빈틈(초). */
export async function withDriftRetry<T extends Attempt>(
  attempt: () => Promise<T>,
  expectedEndSec: number | undefined,
  canRetry: (firstElapsedMs: number) => boolean,
): Promise<{ value: T; drift: number | null; gap: number | null; retried: boolean }> {
  const started = Date.now();
  const first = await attempt();
  if (expectedEndSec === undefined) return { value: first, drift: null, gap: null, retried: false };
  const t1 = timing(piecesOf(first), expectedEndSec);
  const pick = (value: T, t: Timing, retried: boolean) => ({ value, drift: t.overshoot, gap: t.maxGap, retried });
  if (t1.ok || !canRetry(Date.now() - started)) return pick(first, t1, false);
  let second: T;
  try {
    second = await attempt();
  } catch {
    return pick(first, t1, true);
  }
  const t2 = timing(piecesOf(second), expectedEndSec);
  return lessOff(t2, t1) ? pick(second, t2, true) : pick(first, t1, true);
}
