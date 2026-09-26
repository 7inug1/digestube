/** 리랭커를 미리 깨울지.
 *
 *  리랭커는 무료 추론 서버라 한동안 안 쓰면 잠든다. 잠든 뒤 첫 요청은 5초 제한을 넘겨
 *  순서 다듬기와 "맞는 대목 없음" 판단을 건너뛴다(2026-09-26 운영에서 확인).
 *  읽기·검색 화면을 열 때 가볍게 한 번 불러 깨워 둔다. 5분 안에 이미 깨웠으면 다시 부르지 않는다.
 */
export const WARM_EVERY_MS = 5 * 60 * 1000;
const KEY = "digestube.rerank-warm";

export function warmDue(last: number | null, now: number): boolean {
  if (last === null || !Number.isFinite(last) || last > now) return true;
  return now - last >= WARM_EVERY_MS;
}

/** 화면에서 부른다. 실패해도 조용히 넘어간다 — 깨우기는 덤이다. */
export function warmReranker() {
  try {
    const raw = sessionStorage.getItem(KEY);
    const now = Date.now();
    if (!warmDue(raw === null ? null : Number(raw), now)) return;
    sessionStorage.setItem(KEY, String(now));
  } catch { /* 저장소가 막혀 있어도 깨우기는 한다 */ }
  fetch("/api/rerank/warm", { method: "POST", keepalive: true }).catch(() => {});
}
