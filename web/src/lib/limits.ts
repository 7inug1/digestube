/** 제출한 영상을 받을지 말지. 돈이 나가기 전에 거른다.
 *
 *  숫자는 2026-09-16 에 정했다.
 *  - 길이 30분: 서버 한 번 실행이 300초까지고 전사가 길이의 10~15% 라 역산한 값.
 *    큐를 붙이기 전까지는 이보다 긴 영상을 끝까지 못 돌린다.
 *  - 익명 하루 60분(길이 합산): 지갑 보호. 편수가 아니라 분으로 센다 — 비용은 길이에
    비례하고, 30분짜리 둘이든 10분짜리 여섯이든 같은 값이다.
    단가는 실측 1분당 약 12원(notes/26, 3.8-flash) — 1인 하루 최대 900원 선.
    30·90 도 놓고 봤다. 30 은 긴 영상 하나로 끝나 써보기 부족하고, 90 은 세 편째를
    익명에게 줄 이유가 없다 — 그건 로그인 보상으로 남긴다.
 *  세는 열쇠는 둘이다: IP 와 브라우저 표시(쿠키). 둘 중 하나라도 넘으면 막는다 —
  IP 만 쓰면 VPN 으로, 쿠키만 쓰면 쿠키를 지워 초기화된다. 둘을 동시에 피해야 하니
  실수와 흔한 남용은 걸린다. 그래도 작정하면 뚫리는 선이다 — 방벽이 아니라 문턱이고,
  진짜 신원은 로그인이다. 같은 IP 를 여러 사람이 쓰면(사무실·카페) 서로의 몫을 먹는데,
  그때 답도 로그인이다.
 */
import { db } from "./supabase";
import { details, type Details } from "./youtube";

export const MAX_SECONDS = 30 * 60;
export const ANON_DAY_SECONDS = 60 * 60;
/** 서버가 심는 브라우저 표시. httpOnly 라 화면 코드가 건드리지 못한다. */
export const BROWSER_COOKIE = "dt.bid";

export type Verdict = { ok: true } | { ok: false; code: string; error: string; status: number };

/** 영상 자체를 보고 판정한다. 순수 함수라 따로 테스트한다. */
export function judge(d: Details | null): Verdict {
  if (!d) return { ok: true }; // 확인 못 하면 막지 않는다 — 키가 없거나 API 가 죽은 것
  if (d.privacy === "private") return no("VIDEO_PRIVATE", "비공개 영상이거나 없는 영상이에요.", 422);
  if (d.live !== "none") return no("VIDEO_LIVE", "라이브·예정된 영상은 끝난 뒤에 넣어주세요.", 422);
  if (d.ageRestricted) return no("VIDEO_AGE", "연령 제한 영상은 받을 수 없어요.", 422);
  if (d.seconds > MAX_SECONDS) {
    const m = Math.round(d.seconds / 60);
    return no("VIDEO_TOO_LONG", `${m}분짜리네요. 지금은 ${MAX_SECONDS / 60}분까지만 받을 수 있어요.`, 422);
  }
  return { ok: true };
}

export async function checkVideo(vid: string): Promise<Verdict & { seconds: number }> {
  const d = await details(vid);
  return { ...judge(d), seconds: d?.seconds ?? 0 };
}

/** 오늘 이 IP 가 쓴 시간에 이 영상을 더하면 넘치나. 쿼터 테이블이 없거나 DB 가 안 닿으면
 *  막지 않는다 — 상한 때문에 서비스 전체가 서는 쪽이 더 나쁘다. */
export async function checkQuota(keys: string[], seconds: number): Promise<Verdict> {
  const counts = await Promise.all(keys.map(used));
  // 못 읽은 열쇠(null)는 세지 않는다 — DB 가 안 닿는다고 막으면 서비스가 선다
  const worst = counts.filter((n): n is number => n !== null).sort((a, b) => b - a)[0];
  if (worst === undefined || worst + seconds <= ANON_DAY_SECONDS) return { ok: true };
  return no("QUOTA", quotaMessage(ANON_DAY_SECONDS - worst, seconds), 429);
}

/** 남은 시간과 이 영상 길이를 같이 말한다. "안 돼요"만 하면 왜인지 모른다. */
export function quotaMessage(leftSeconds: number, wantSeconds: number): string {
  const left = Math.max(0, Math.floor(leftSeconds / 60));
  const want = Math.ceil(wantSeconds / 60);
  if (left === 0) return `오늘 ${ANON_DAY_SECONDS / 60}분을 다 썼어요. 내일 다시 와주세요.`;
  return `오늘 ${left}분 남았는데 이 영상은 ${want}분이에요. 더 짧은 영상을 넣거나 내일 다시 와주세요.`;
}

/** 이 영상 길이만큼 썼다고 적는다. 전사가 돌아온 뒤에 센다 — 구글이 튕긴 건 비용이 없다. */
export async function spendQuota(keys: string[], seconds: number): Promise<void> {
  const day = today();
  await Promise.all(keys.map(async key => {
    try {
      await db().rpc("quota_use", { p_key: key, p_day: day, p_seconds: seconds });
    } catch (e) {
      console.error("쿼터 기록 실패", (e as Error).message);
    }
  }));
}

async function used(ip: string): Promise<number | null> {
  try {
    const { data, error } = await db().from("quota").select("n").eq("key", ip).eq("day", today()).maybeSingle();
    if (error) return null;
    return data?.n ?? 0;
  } catch {
    return null;
  }
}

/** 한국 기준 날짜. UTC 로 세면 아침 9시에 하루가 바뀐다. */
function today(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 이 요청을 셀 열쇠들. 하나라도 있으면 센다. */
export function quotaKeys(req: Request): string[] {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const bid = req.headers.get("cookie")?.match(/(?:^|;\s*)dt\.bid=([^;]+)/)?.[1];
  return [ip ? `ip:${ip}` : null, bid ? `bid:${bid}` : null].filter((k): k is string => Boolean(k));
}

function no(code: string, error: string, status: number): Verdict {
  return { ok: false, code, error, status };
}
