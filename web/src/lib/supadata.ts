/** Supadata 로 영상의 말을 글로 받아온다.
 *
 *  mode 는 셋인데 generate 만 쓴다.
 *    native    있는 자막을 가져온다. 사람이 만든 자막이면 좋지만
 *              기계가 만든 자막이 와도 응답만 봐서는 구분할 수 없다.
 *    generate  자막을 무시하고 소리를 직접 받아쓴다. 품질이 일정하다.
 *
 *  측정 기록: 사람 자막이 있는 영상에서는 native 가 나았고(12:4),
 *  기계 자막이면 generate 가 크게 나았다(16:4). 어느 쪽이 왔는지 알 수
 *  없으므로 일정한 쪽을 택했다.
 *
 *  서버리스는 한 요청이 5분을 넘을 수 없다. 그래서 전사를 두 번에 나눠
 *  부른다 — 시작(작업 번호를 받는다)과 조회(끝났는지 본다).
 */
const BASE = "https://api.supadata.ai/v1";

export type Piece = { text: string; offset: number; duration: number };
export type Result = { lang?: string; content?: Piece[] | string };

export type Started =
  | { state: "working"; job: string }
  | { state: "done"; result: Result };

function key(): string {
  const k = process.env.SUPADATA_API_KEY;
  if (!k) throw new Error("SUPADATA_API_KEY 가 없다");
  return k.trim();
}

async function call(path: string, params?: Record<string, string>, retry = 3) {
  const k = key();
  const url = BASE + path + (params ? "?" + new URLSearchParams(params) : "");
  for (let i = 0; i <= retry; i++) {
    const r = await fetch(url, { headers: { "x-api-key": k }, cache: "no-store" });
    const body = await r.text();
    if (r.ok) return JSON.parse(body);

    // 429 는 무료 플랜의 요청 한도다. 실력과 무관하므로 기다렸다 다시 부른다.
    if (r.status === 429 && i < retry) {
      await new Promise((s) => setTimeout(s, 8000 * (i + 1)));
      continue;
    }
    // 키가 에러 응답에 그대로 돌아오는 경우가 있어 가린다
    throw new Error(`Supadata ${r.status}: ${body.slice(0, 300).replaceAll(k, "***")}`);
  }
  throw new Error("도달 불가");
}

/** 어떤 방식으로 받아올지.
 *
 *  generate 로 정했지만(2번 자리), 배포 환경에서 이 요청이 91.8초 걸려
 *  서버리스 함수 60초 제한에 걸린다. 실행 환경을 고칠 때까지 native 로
 *  둘 수 있게 환경변수로 뺀다 — 코드를 다시 올리지 않고 바꾸려는 것이다.
 *
 *  native 는 자막을 가져오기만 해서 2~4초. 대신 그 자막이 사람이 만든 것인지
 *  기계가 만든 것인지 응답으로 구분할 수 없다.
 */
const MODE = process.env.SUPADATA_MODE ?? "generate";

/** 어느 언어로 받아올지.
 *
 *  지정하지 않으면 그 영상에 달린 자막 중 아무거나 온다. 한국어 영상인데
 *  영어 자막이 붙어 있으면 영어가 왔다(byVgbqzYJrs 가 그랬다 — 한국어 강연인데
 *  "I said I ate kimchi stew, right?" 로 전사됐다). 다루는 영상이 한국어라
 *  한국어를 먼저 달라고 한다. 없으면 Supadata 가 있는 것으로 대신 준다.
 */
const LANG = process.env.SUPADATA_LANG ?? "ko";

/** 전사를 시작한다. 짧은 영상은 그 자리에서 결과가 오고, 긴 영상은 작업 번호만 온다. */
export async function start(videoUrl: string): Promise<Started> {
  // generate 는 소리를 직접 받아쓰므로 원어 그대로 나온다 — 언어를 지정하지 않는다.
  // native 는 번역본 중 하나가 오므로 어느 것을 원하는지 말해야 한다.
  const params: Record<string, string> =
    MODE === "generate" ? { url: videoUrl, mode: MODE }
                        : { url: videoUrl, mode: MODE, lang: LANG };
  const d = await call("/transcript", params);
  if (d.jobId && !d.content) return { state: "working", job: d.jobId };
  return { state: "done", result: d };
}

export type Polled =
  | { state: "working" }
  | { state: "done"; result: Result }
  | { state: "failed"; error: string };

export async function poll(job: string): Promise<Polled> {
  const d = await call(`/transcript/${job}`);
  if (d.status === "completed" || d.content) return { state: "done", result: d };
  if (d.status === "failed") return { state: "failed", error: d.error ?? "전사 실패" };
  return { state: "working" };
}

/** 조각을 이어 붙여 한 덩어리 글로. 조각 하나가 몇 글자 안 된다. */
export function toText(content: Result["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
}

/** 유튜브 주소에서 영상 번호(11자)를 뽑는다. */
export function videoId(url: string): string | null {
  const m = /(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(url ?? "");
  return m ? m[1] : null;
}

/** 유튜브 주소에서 플레이리스트 번호를 뽑는다. */
export function playlistId(url: string): string | null {
  const m = /[?&]list=([A-Za-z0-9_-]+)/.exec(url ?? "");
  // 유튜브가 임시로 만드는 목록(RD·UL 로 시작)은 사람마다 달라 쓸 수 없다
  return m && !/^(RD|UL)/.test(m[1]) ? m[1] : null;
}

/** 플레이리스트에 든 영상 번호들. 1크레딧.
 *
 *  전사를 여러 편 한꺼번에 거는 배치 기능은 유료 플랜에서만 된다(402). 그래서
 *  목록만 받아 오고 전사는 한 편씩 돈다.
 */
export async function playlistVideos(id: string, limit = 30): Promise<string[]> {
  const d = await call("/youtube/playlist/videos", { id, limit: String(limit) });
  return (d.videoIds ?? []) as string[];
}
