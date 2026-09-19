/** 목차를 전사문 전체에서 한 번에 만든다 — v1 방식으로 되돌린 것.
 *
 *  v2 는 문단마다 제목을 달았다. 그래서 8분 영상에 목차가 16개 나왔고,
 *  모델이 앞뒤 맥락을 못 봐서 비슷한 제목이 이어졌다.
 *  v1(`digestube/server/pipeline/summarize.py`)은 전사문을 통째로 주고
 *  "영상이 실제로 몇 덩어리인지에 맞춰" 목차를 뽑게 했다. 그 방식이 맞다.
 *
 *  지어내기 방지는 그대로다: 제목이 기댄 인용문이 원문에 글자 그대로 있어야 한다.
 *  없으면 그 항목을 버린다. 항목이 너무 적게 남으면 문단별 방식으로 되돌린다.
 */
import {holds} from "./verify";
import {timeoutFor} from "./deadline";
import type {Outline} from "./types";

const API = "https://generativelanguage.googleapis.com/v1beta";
export const WHOLE_MODEL = process.env.OUTLINE_MODEL ?? "gemini-3.8-flash";

const SCHEMA = `아래는 유튜브 영상의 전사문이다. 문단마다 번호가 붙어 있다.

이 영상의 목차를 만들어라. 다음 JSON 형식으로만 답한다.

{"goal":"영상이 하려는 말 한 문장","tldr":["요점 한 줄","요점 한 줄","요점 한 줄"],"points":[{"label":"짧은 소제목","start":"그 대목이 시작되는 첫 문장을 전사문에서 글자 그대로 옮김","quote":"그 대목의 핵심 문장을 전사문에서 글자 그대로 옮김"}]}

규칙
- tldr 은 3~4줄. 한 줄에 요점 하나씩, 각 줄은 40자 이내로 그 자체로 말이 되게 쓴다.
  "이 영상은 ~을 다룬다" 같은 소개말이 아니라, 영상이 실제로 한 주장을 적는다.
- start 와 quote 는 전사문에 있는 문장을 토씨 하나 안 틀리고 그대로 옮긴다. 줄이거나 이어 붙이거나 의역하면 버려진다.
- start 는 그 대목이 "시작되는" 자리다. 앞 대목 이야기가 끝나고 새 이야기가 처음 나오는 문장을 고른다.
  소제목은 이 문장 앞에 붙는다 — 이야기가 한참 진행된 뒤에 제목이 나오면 안 된다.
  '자 그럼', '두 번째는' 같은 전환 문구만 있는 짧은 문장은 피하고, 그 뒤 첫 내용 문장을 고른다.
- quote 는 "이 문장만 읽어도 무슨 말인지 통하는" 핵심 문장을 고른다. '두 번째는', '자 그럼' 같은 전환 문구는 고르지 않는다.
- label 은 한국어 25자 이내. 번호를 붙이지 않는다.
- points 개수는 영상이 실제로 몇 덩어리인지에 맞춘다. 억지로 개수를 맞추지 않는다. 보통 4~8개다.
- 문단 하나마다 목차를 만들지 않는다. 같은 이야기가 이어지면 한 항목으로 묶는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

전사문:
`;

type Point = {label?: string; start?: string; quote?: string};

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY 가 없다");
  return k.trim();
}

export type WholeResult = {
  goal: string | null;
  /** 세 줄 요약. 목차와 같은 호출에서 받는다 — 따로 부르면 값이 두 배다. */
  tldr: string[];
  items: Omit<Outline, "video_id">[];
  /** 버린 항목 수와 이유 — 조용히 사라지면 나중에 원인을 못 찾는다. */
  dropped: string[];
  ms: number;
  usage: {input: number; output: number};
};

export async function outlineWhole(
  chunks: {seq: number; t: number; text: string}[],
  until?: number,
): Promise<WholeResult> {
  const started = Date.now();
  const body = chunks.map(c => `[${c.seq}] ${c.text}`).join("\n\n");
  const k = key();
  const r = await fetch(`${API}/models/${WHOLE_MODEL}:generateContent?key=${k}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      contents: [{parts: [{text: SCHEMA + body}]}],
      // start 가 늘면서 8000 을 넘기는 영상이 나왔다(MAX_TOKENS). 출력은 쓴 만큼만
      // 값이 드니 넉넉히 둔다 — 한도에 걸려 통째로 버리는 쪽이 훨씬 비싸다.
      generationConfig: {responseMimeType: "application/json", maxOutputTokens: 24000, temperature: 0},
    }),
    signal: AbortSignal.timeout(timeoutFor("목차", 180000, until)),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`목차 ${r.status}: ${text.slice(0, 200).replaceAll(k, "***")}`);
  const d = JSON.parse(text) as {
    candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[];
    usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number};
  };
  const c = d.candidates?.[0];
  if (c?.finishReason !== "STOP") throw new Error(`목차 응답 미완료: ${c?.finishReason}`);
  const raw = c.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as
    {goal?: string; tldr?: unknown; points?: Point[]};

  const dropped: string[] = [];
  const items: Omit<Outline, "video_id">[] = [];
  const used = new Set<number>();
  let last = -1;
  for (const p of parsed.points ?? []) {
    const label = String(p.label ?? "").trim();
    const quote = String(p.quote ?? "").trim();
    if (!label || Array.from(label).length > 25) { dropped.push(`제목 길이: ${label.slice(0, 20)}`); continue; }
    // 인용문이 들어 있는 문단을 찾는다. 못 찾으면 지어낸 것으로 보고 버린다.
    // 제목이 붙을 자리는 "그 대목이 시작되는 문장"이다. 핵심 문장(quote)은 대개
    // 대목 한복판에 있어서, 거기에 붙이면 이야기가 이미 시작된 뒤에 제목이 나온다 —
    // 실제로 그래 보였다. start 를 먼저 찾고, 없거나 확인이 안 되면 quote 로 물러선다.
    if (!chunks.some(ch => holds(quote, ch.text))) { dropped.push(`인용문 원문에 없음: ${label}`); continue; }
    const start = String(p.start ?? "").trim();
    const at = (start && chunks.find(ch => holds(start, ch.text))) || chunks.find(ch => holds(quote, ch.text));
    if (!at) { dropped.push(`원문에 없음: ${label}`); continue; }
    // 한 문단에 목차가 둘 붙지 않게 한다(저장소도 문단당 하나만 받는다).
    if (used.has(at.seq)) { dropped.push(`문단 중복: ${label}`); continue; }
    // 뒤로 가는 제목은 만들지 않는다. start 를 앞 대목에서 찾아 오면 순서가 뒤집힌다.
    if (at.seq < last) { dropped.push(`순서 역전: ${label}`); continue; }
    last = at.seq;
    used.add(at.seq);
    items.push({seq: at.seq, t: at.t, label, quote, source: "model", attempts: 1, failure: null});
  }
  items.sort((a, b) => a.seq - b.seq);

  return {
    goal: typeof parsed.goal === "string" ? parsed.goal.trim() : null,
    // 네 줄까지만 받는다. 더 길면 요약이 아니라 또 하나의 글이 된다.
    tldr: (Array.isArray(parsed.tldr) ? parsed.tldr : [])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map(x => x.trim()).slice(0, 4),
    items, dropped, ms: Date.now() - started,
    usage: {
      input: d.usageMetadata?.promptTokenCount ?? 0,
      output: (d.usageMetadata?.candidatesTokenCount ?? 0) + (d.usageMetadata?.thoughtsTokenCount ?? 0),
    },
  };
}
