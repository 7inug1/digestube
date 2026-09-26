/** 제출한 영상을 받을지 말지. 돈이 나가기 전에 거른다.
 *
 *  숫자는 2026-09-16 에 정했다.
 *  - 한 편 길이 제한은 없다(2026-09-17). 영상을 SLICE_SECONDS 구간으로 나눠 받아쓰므로
 *    서버 한 번 실행(300초)은 구간 하나만 감당하면 된다. 그 전의 30분 상한은
 *    "영상 전체를 한 번에 받아쓴다"는 전제에서 300초를 전사 속도로 역산한 값이었다.
 *  - 하루 90분(길이 합산, 2026-09-26 에 60분에서 올림): 지갑 보호. 편수가 아니라 분으로 센다 — 비용은 길이에
    비례하고, 30분짜리 둘이든 10분짜리 여섯이든 같은 값이다.
    단가는 실측 1분당 약 12원(notes/26, 3.8-flash) — 1인 하루 최대 1,350원 선.
    처음(09-16)에는 60분으로 두고 90분을 로그인 보상으로 남겼다. 09-26 에 모두 90분으로
    올렸다. 로그인에만 주지 않은 이유는 아래 — 상한이 둘이면 화면이 "지금 몇 분
    남았는지"를 한 줄로 말하지 못한다. 지갑은 전체 상한이 지킨다.
 *  세는 법(2026-09-17): 쓴 시간을 쓴 곳 전부에 적고, 어느 하나라도 하루 몫을 넘으면 막는다.
  열쇠는 익명이면 IP + 브라우저 표시(쿠키), 로그인했으면 계정 + 브라우저 표시다.

  로그인해도 브라우저에 계속 적는 이유는 구멍 때문이다. 계정만 세면 익명으로 하루 몫을
  다 쓰고 로그인해 또 한 번 쓸 수 있고, 로그인해서 다 쓰고 로그아웃해도 또 쓸 수 있다.
  두 곳에 적으면 어느 쪽으로도 초기화되지 않는다.

  로그인하면 IP 는 보지 않는다. 계정이 이미 사람을 알아보는데 IP 까지 보면, 사무실·카페처럼
  IP 를 나눠 쓰는 곳에서 옆 사람이 쓴 만큼 내가 막힌다 — 내가 한 일이 없는데 막히는 것이다.
  익명은 여전히 IP 를 본다. 거기서 막히면 답은 로그인이고, 그게 로그인할 이유이기도 하다.

  신원을 아무리 겹쳐 쌓아도 못 막는 것이 하나 있다: 스크립트로 쿠키와 IP 를 매번 갈아
  끼우며 부르는 것. 신원이 무한이니 신원으로 세는 방법으로는 끝이 없다.
  그래서 전체 상한(ALL_DAY_SECONDS)을 따로 둔다 — 하루에 서비스 전체가 쓸 수 있는 양이다.
  넘으면 모두가 멈춘다. 남용이 터진 날에는 정직한 사람도 막히지만, 청구서가 터지는 쪽보다 낫다.

  익명 상한과 로그인 상한을 다르게 두는 것도 생각했지만 뒀다. 숫자가 둘이면 화면이
  "지금 몇 분 남았는지"를 한 줄로 말하지 못하고, 규칙도 설명하기 어려워진다.
 */
import { db } from "./supabase";
import { details, type Details } from "./youtube";

export const ANON_DAY_SECONDS = 90 * 60;
/** IP 는 개인 몫을 재는 자가 아니라 뒷문이다.
 *
 *  사무실·카페·통신사 NAT 뒤에서는 여러 사람이 공인 IP 하나를 나눠 쓴다. 뒤에 몇 명이
 *  있는지 밖에서는 알 수 없다 — 그게 NAT 다. IP 도 개인 몫으로 재면 먼저 온 한 사람이
 *  다 쓰는 순간 나머지가 전부 막힌다. 아무것도 안 했는데 막히는 것이다.
 *
 *  그래서 IP 는 느슨하게 둔다. 개인 몫은 브라우저와 계정이 재고, IP 는 "쿠키를 지우며
 *  같은 자리에서 무한히 반복하는 것"만 막는다. 세 배면 그 반복을 세 번에서 끊는다.
 *  지갑 자체는 전체 상한이 지키므로 여기를 빡빡하게 쥘 이유가 없다.
 */
export const IP_DAY_SECONDS = 3 * ANON_DAY_SECONDS;

/** 하루에 서비스 전체가 쓸 수 있는 양. 10시간 = 실측 단가로 약 7,200원.
 *  개인 상한이 90분이니 정직하게 쓰는 사람 일곱 명쯤이 꽉 채워야 닿는 선이다. */
export const ALL_DAY_SECONDS = 10 * 60 * 60;
/** 전체 사용량을 적는 열쇠. 사람이 아니라 서비스 자신이다. */
const ALL = "all";
/** 한 번에 받아쓸 구간. 서버 한 번 실행이 300초이고 받아쓰기가 길이의 15% 쯤 걸리니
 *  20분(=180초)이면 모델 준비 시간까지 넣어도 넉넉하다. */
export const SLICE_SECONDS = 20 * 60;
/** 서버가 심는 브라우저 표시. httpOnly 라 화면 코드가 건드리지 못한다. */
export const BROWSER_COOKIE = "dt.bid";

export type Verdict = { ok: true } | { ok: false; code: string; error: string; status: number };

/** 영상 자체를 보고 판정한다. 순수 함수라 따로 테스트한다. */
export function judge(d: Details | null): Verdict {
  if (!d) return { ok: true }; // 확인 못 하면 막지 않는다 — 키가 없거나 API 가 죽은 것
  if (d.privacy === "private") return no("VIDEO_PRIVATE", "비공개 영상이거나 없는 영상이에요.", 422);
  if (d.live !== "none") return no("VIDEO_LIVE", "라이브·예정된 영상은 끝난 뒤에 넣어주세요.", 422);
  if (d.ageRestricted) return no("VIDEO_AGE", "연령 제한 영상은 받을 수 없어요.", 422);
  return { ok: true };
}

export async function checkVideo(vid: string): Promise<Verdict & { seconds: number }> {
  const d = await details(vid);
  return { ...judge(d), seconds: d?.seconds ?? 0 };
}

/** 오늘 이 IP 가 쓴 시간에 이 영상을 더하면 넘치나. 쿼터 테이블이 없거나 DB 가 안 닿으면
 *  막지 않는다 — 상한 때문에 서비스 전체가 서는 쪽이 더 나쁘다. */
export async function checkQuota(keys: string[], seconds: number): Promise<Verdict> {
  // 전체 상한이 먼저다. 개인 몫이 남아 있어도 서비스가 오늘치를 다 썼으면 멈춘다.
  const all = await used(ALL);
  if (all !== null && all + seconds > ALL_DAY_SECONDS) {
    return no("QUOTA_ALL",
      "사용자가 많아 오늘 서비스 전체 사용량이 마감됐어요. 내일 다시 열려요.", 429);
  }
  // 열쇠마다 상한이 다르다. 못 읽은 열쇠(null)는 세지 않는다 —
  // DB 가 안 닿는다고 막으면 서비스가 선다.
  const counts = await Promise.all(keys.map(async k => [k, await used(k)] as const));
  for (const [k, n] of counts) {
    if (n === null) continue;
    const cap = capOf(k);
    if (n + seconds > cap) {
      // IP 에서 걸린 것은 "이 자리에서 너무 많이 왔다"는 뜻이라 말이 달라야 한다
      if (k.startsWith("ip:")) {
        // "지역"이라고 쓰지 않는다. 우리가 아는 건 공인 IP 하나뿐이고 그게 어디인지는
        // 모른다 — 통신사 NAT 은 도시 하나를 덮기도 한다. 아는 만큼만 말한다.
        return no("QUOTA_IP",
          "같은 네트워크(와이파이·회사망)에서 오늘 사용량이 많았어요. " +
          "로그인하면 내 몫으로 이어서 쓸 수 있어요.", 429);
      }
      return no("QUOTA", quotaMessage(cap - n, seconds), 429);
    }
  }
  return { ok: true };
}

/** 열쇠마다 다른 상한. IP 만 느슨하다 — 위 주석의 이유. */
function capOf(key: string): number {
  return key.startsWith("ip:") ? IP_DAY_SECONDS : ANON_DAY_SECONDS;
}

/** 오늘 남은 초. 열쇠 중 가장 많이 쓴 쪽을 기준으로 본다 — 막을 때와 같은 잣대다.
 *  못 읽으면 null 을 준다. 화면은 그때 아무 말도 하지 않는다 — 틀린 숫자보다 낫다. */
export async function remaining(keys: string[]): Promise<number | null> {
  // IP 는 뒷문이라 화면에 적지 않는다. 보이는 숫자는 내 몫(브라우저·계정)이다.
  const own = keys.filter(k => !k.startsWith("ip:"));
  const [all, ...mine] = await Promise.all([used(ALL), ...own.map(used)]);
  const counts = mine.filter((n): n is number => n !== null);
  if (!counts.length) return null;
  const left = Math.max(0, ANON_DAY_SECONDS - Math.max(...counts));
  // 전체가 바닥나면 개인 몫이 남아 있어도 쓸 수 없다. 화면에는 쓸 수 있는 양만 보인다.
  const allLeft = all === null ? Infinity : Math.max(0, ALL_DAY_SECONDS - all);
  return Math.min(left, allLeft);
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
  // 개인 열쇠와 함께 전체에도 적는다 — 신원을 갈아 끼워도 이 숫자는 계속 쌓인다
  await Promise.all([...keys, ALL].map(async key => {
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

/** 이 요청을 셀 열쇠들. 로그인했으면 계정을 쓰고 IP 는 뺀다 — 위 주석의 이유. */
export function quotaKeys(req: Request, userId?: string | null): string[] {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const bid = req.headers.get("cookie")?.match(/(?:^|;\s*)dt\.bid=([^;]+)/)?.[1];
  const keys = [bid ? `bid:${bid}` : null];
  keys.push(userId ? `user:${userId}` : (ip ? `ip:${ip}` : null));
  return keys.filter((k): k is string => Boolean(k));
}

function no(code: string, error: string, status: number): Verdict {
  return { ok: false, code, error, status };
}
