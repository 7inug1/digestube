/** 밖으로 나가는 말과 안에서 보는 말을 나눈다.
 *
 *  사고가 나면 그 자리에서 제일 자세한 말은 개발자용이다. Supabase 가 돌려준 SQL 오류,
 *  Gemini 가 준 JSON, Supadata 의 documentationUrl 같은 것들. 그걸 그대로 화면에 띄우면
 *  쓰는 사람은 무슨 일이 났는지도, 뭘 하면 되는지도 모른 채 남의 집 사정만 보게 된다.
 *  실제로 재생목록 주소 하나에 `Supadata 404: {"error":"not-found",...}` 가 떴다.
 *
 *  그래서 원문은 서버 로그로 보내고, 화면에는 "무엇이 잘못됐고 지금 뭘 하면 되는지"만
 *  남긴다. 우리가 직접 쓴 안내(쿼터·길이·라이브 같은 것)는 이미 사람 말이라 그대로 통과시킨다.
 */

/** 이미 사람에게 하는 말로 쓴 오류. 이걸로 던지면 화면에 그대로 나간다. */
export class SaidWell extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

const FALLBACK = "지금은 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

/** 원문에서 알아볼 수 있는 것만 골라 사람 말로 바꾼다.
 *  못 알아보면 하나로 뭉뚱그린다 — 틀린 짐작을 말하느니 아무 말도 안 하는 게 낫다. */
const RULES: [RegExp, string][] = [
  [/not-?found|404/i, "영상이나 재생목록을 찾지 못했어요. 주소가 맞는지, 공개된 것인지 확인해 주세요."],
  [/quota|rate.?limit|429/i, "지금 요청이 몰려 있어요. 잠시 뒤 다시 시도해 주세요."],
  [/unavailable|503|overloaded|붐벼/i, "처리 서버가 지금 붐벼요. 잠시 뒤 다시 눌러주세요."],
  [/timeout|timed out|시간 초과|AbortError/i, "시간이 너무 오래 걸려 멈췄어요. 다시 시도해 주세요."],
  [/unauthorized|forbidden|401|403|권한/i, "권한이 없어요. 로그인 상태를 확인해 주세요."],
  [/network|fetch failed|ECONN|ENOTFOUND/i, "연결이 잠시 끊겼어요. 인터넷 상태를 확인하고 다시 시도해 주세요."],
  [/API_KEY|api key|키가 없다|credential/i, "서비스 설정에 문제가 있어요. 잠시 뒤 다시 시도해 주세요."],
];

/** 화면에 내보낼 한 줄. 원문은 로그로 남긴다. */
export function saySorry(e: unknown, where: string): string {
  if (e instanceof SaidWell) return e.message;
  const raw = e instanceof Error ? e.message : String(e);
  // 우리가 쓴 안내는 대개 물음표나 "요"로 끝난다. 그런 문장은 이미 사람 말이다.
  if (/[가-힣]/.test(raw) && /(요[.!]?|세요[.!]?|\?)$/.test(raw.trim())) return raw;
  console.error(`[${where}] ${raw}`);
  return RULES.find(([re]) => re.test(raw))?.[1] ?? FALLBACK;
}
