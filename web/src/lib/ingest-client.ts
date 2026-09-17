/** 영상 하나를 글로 바꾸는 전 과정 — 화면에서 부른다.
 *
 *  서버 한 번 실행이 300초까지라 긴 일은 전부 "부르고, 남았으면 또 부르기"로 돈다.
 *  받아쓰기는 구간별로, 목차와 검색 준비는 남은 개수만큼. 그래서 이 파일이 있다 —
 *  이 순서를 화면 두 곳(랜딩 입력창·읽기 화면)이 같이 써야 하기 때문이다.
 */
export class IngestError extends Error {
  constructor(message: string, public code?: string, public vid?: string, public title?: string) { super(message); }
}

/** 전사 응답 한 줄. 스트리밍이면 t 가, 예전 방식이면 state 가 온다 —
 *  한 줄짜리 JSON 도 같은 읽개로 읽히므로 두 방식이 한 코드로 돌아간다. */
export type IngestEvent = {
  t?: "meta" | "seg" | "slice" | "added" | "done" | "error";
  seconds?: number; start?: string; from?: number; to?: number; total?: number; next?: number | null;
  state?: string; vid?: string; job?: string; token?: string;
  error?: string; code?: string; title?: string; text?: string;
};

export type Stage = "전사" | "목차" | "검색 준비";

export type Watcher = {
  /** 영상 길이(초)와 제목. 화면이 남은 시간을 어림잡는 데 쓴다. */
  onMeta?: (m: { seconds: number; title: string | null }) => void;
  /** 받아쓴 한 줄. start 는 영상 속 시각("MM:SS"). */
  onSegment?: (s: { start?: string; text: string }) => void;
  onStage?: (s: { stage: Stage; detail: string; ratio: number | null }) => void;
  /** 이미 변환돼 있어 담기만 한 경우. 전사도 비용도 없다. */
  onAlready?: () => void;
};

/** "MM:SS" 또는 "HH:MM:SS" → 초. 형식이 아니면 null. */
export function clock(v?: string): number | null {
  if (!v) return null;
  const n = v.split(":").map(Number);
  if (n.some(x => !Number.isFinite(x))) return null;
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 2) return n[0] * 60 + n[1];
  return null;
}

/** 유튜브 주소에서 영상 번호. 못 찾으면 null — 화면이 먼저 걸러 준다. */
export function videoIdOf(url: string): string | null {
  const m = /[?&]v=([\w-]{11})|youtu\.be\/([\w-]{11})|\/(?:embed|shorts|live)\/([\w-]{11})/.exec(url);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
}

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new IngestError(d.error ?? `${r.status}`, d.code, d.vid, d.title);
  return d;
}

/** 줄마다 JSON 하나(NDJSON). 받아쓴 조각은 그때그때 넘기고, 끝나면 마지막 줄을 돌려준다. */
async function slice(url: string, replace: boolean, watch: Watcher, from: number, token?: string) {
  const r = await fetch("/api/ingest", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, replace, stream: true, from, token }),
  });
  if (!r.ok || !r.body) {
    const d = await r.json().catch(() => ({}));
    throw new IngestError(d.error ?? `${r.status}`, d.code, d.vid, d.title);
  }
  const reader = r.body.getReader(), decoder = new TextDecoder();
  let buf = "", last: IngestEvent | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let e: IngestEvent;
      try { e = JSON.parse(line) as IngestEvent; } catch { continue; }
      if (e.t === "meta") { watch.onMeta?.({ seconds: e.seconds ?? 0, title: e.title ?? null }); continue; }
      if (e.t === "seg") { watch.onSegment?.({ start: e.start, text: e.text ?? "" }); continue; }
      if (e.t === "error") throw new IngestError(e.error ?? "전사에 실패했어요.", e.code, e.vid, e.title);
      last = e;
    }
  }
  if (!last) throw new IngestError("전사가 끝까지 오지 않았어요. 다시 시도해 주세요.");
  return last;
}

/** 다 만든 뒤의 숫자. 끝났다는 걸 "무엇이 생겼는지"로 말하려고 돌려준다. */
export type Made = { vid: string; paragraphs: number; outline: number };

/** 받아쓰기 → 목차 → 검색 준비. */
export async function runIngest(url: string, watch: Watcher = {}, replace = false): Promise<Made> {
  let total = 0;
  const seen: Watcher = {
    ...watch,
    onMeta: m => { total = m.seconds; watch.onMeta?.(m); },
    onSegment: s => {
      watch.onSegment?.(s);
      const at = clock(s.start);
      if (total > 0 && at !== null) {
        watch.onStage?.({ stage: "전사", detail: "영상 소리를 받아쓰는 중…", ratio: Math.min(1, at / total) });
      }
    },
  };

  watch.onStage?.({ stage: "전사", detail: "영상 소리를 받아쓰는 중…", ratio: null });
  let d = await slice(url, replace, seen, 0);
  if (d.t === "added" && d.vid) { watch.onAlready?.(); return { vid: d.vid, paragraphs: 0, outline: 0 }; }
  // 긴 영상은 구간을 나눠 받는다. 다음 구간은 여기서 다시 부른다 —
  // 서버에서 돌면 300초 상한에 다시 걸린다.
  while (d.t === "slice" && typeof d.next === "number") {
    d = await slice(url, replace, seen, d.next, d.token);
  }
  const vid = d.vid;
  if (!vid) throw new IngestError("전사가 끝까지 오지 않았어요. 다시 시도해 주세요.");

  watch.onStage?.({ stage: "목차", detail: "목차 만드는 중…", ratio: 0 });
  let o;
  do {
    o = await post("/api/outline", { vid });
    watch.onStage?.({ stage: "목차", detail: `목차 ${o.kept}/${o.n}개 준비됨`, ratio: o.n ? o.kept / o.n : null });
  } while (o.left);

  watch.onStage?.({ stage: "검색 준비", detail: "검색 준비 중…", ratio: 0 });
  let e, whole = 0;
  do {
    e = await post("/api/embed", { vid });
    whole = whole || (e.done + e.left);
    watch.onStage?.({ stage: "검색 준비", detail: `문단 ${whole - e.left}/${whole}개 준비됨`,
      ratio: whole ? (whole - e.left) / whole : null });
    if (e.left && !e.done) throw new IngestError("검색 준비가 멈췄어요. 다시 이어서 처리해 주세요.");
  } while (e.left);

  return { vid, paragraphs: Number(o.n ?? 0), outline: Number(o.kept ?? 0) };
}
