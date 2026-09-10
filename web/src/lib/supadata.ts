/** Supadata 전사. 배포 기본값은 기존 자막(native).
 * generate는 로컬 코퍼스 구축에 명시적으로 사용할 수 있다.
 * 과거 측정에서 generate 시작 요청이 91.8초 걸려 당시 배포 60초 제한을 넘었다.
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

async function call(path: string, params?: Record<string, string>, retry = 1) {
  const k = key();
  const url = BASE + path + (params ? "?" + new URLSearchParams(params) : "");
  for (let i = 0; i <= retry; i++) {
    const r = await fetch(url, { headers: { "x-api-key": k }, cache: "no-store", signal: AbortSignal.timeout(params?.mode === "generate" ? 120000 : 15000) });
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
export type Mode = "native" | "generate";
export function settings(): { mode: Mode; lang: string | null } {
  const mode = process.env.SUPADATA_MODE ?? "native";
  if (mode !== "native" && mode !== "generate") throw new Error("SUPADATA_MODE는 native 또는 generate여야 합니다.");
  return {mode, lang: mode === "native" ? process.env.SUPADATA_LANG ?? "ko" : null};
}

/** 시작과 저장에 같은 설정을 전달해 실제 요청 방식을 기록한다. */
export async function start(videoUrl: string, config = settings()): Promise<Started> {
  const params: Record<string, string> = {url:videoUrl, mode:config.mode};
  if (config.lang) params.lang = config.lang;
  const d = await call("/transcript", params);
  if (d.jobId && !d.content) return {state:"working",job:d.jobId};
  return {state:"done",result:d};
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
