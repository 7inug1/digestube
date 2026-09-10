/** 목차 모델은 Sonnet 5를 잠정 사용한다. 사람 품질 평가는 보류 중이다.
 * 자동 인용 검사는 제목의 의미 정확성을 보장하지 않는다.
 * 비교 기록: scripts/bench-outline.mjs, scripts/pilot-outline.mjs.
 */
import { holds } from "./verify";
import type { Outline } from "./types";
export const MODEL = "claude-sonnet-5";
const URL = "https://api.anthropic.com/v1/messages";

/** 프롬프트는 모델에 맞춰 다듬지 않는다 — 다듬으면 후보를 나란히 놓고 잴 수 없다.
    벤치마크(scripts/bench-outline.mjs)와 같은 문장을 쓴다. */
const PROMPT = `다음은 영상 전사에서 잘라낸 문단이다. 목차에 걸 제목을 하나 만들어라.

규칙
- 제목은 한국어로 25자 이내.
- quote 는 이 문단에 **글자 그대로 들어 있는** 문장 하나를 옮긴다. 지어내지 않는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"label": "제목", "quote": "원문에 그대로 있는 문장"}

문단:
{text}`;

export type Labeled = Omit<Outline, "video_id">;

async function call(text: string): Promise<{ label: string; quote: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 없다");

  const r = await fetch(URL, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: PROMPT.replace("{text}", text) }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`목차 ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);

  const out = (d.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  // 시킨 형식을 안 지키는 일이 가끔 있다. 벤치마크에서 26회 중 1회였다.
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) throw new Error(`JSON 아님: ${out.slice(0, 120)}`);
  const j = JSON.parse(m[0]);
  if (typeof j.label !== "string" || typeof j.quote !== "string") throw new Error("invalid_fields");
  return { label: j.label.trim(), quote: j.quote.trim() };
}

/** First sentence, with the ellipsis included in the 25-character budget. */
export function fallbackTitle(text: string): string {
  const first = text.trim().replace(/\s+/g, " ").match(/^[\s\S]*?[.!?。？！](?=\s|$)|^[\s\S]+/)?.[0] ?? "";
  const chars = Array.from(first);
  return chars.length <= 25 ? first : chars.slice(0,24).join("").trimEnd() + "…";
}

/** Retry every generation/validation failure once, then keep the navigation item. */
export async function label(
  c: {seq:number;t:number;text:string},
  generate: (text:string) => Promise<{label:string;quote:string}> = call,
): Promise<Labeled> {
  const failures: string[] = [];
  for (let attempt=1;attempt<=2;attempt++) {
    try {
      const result = await generate(c.text);
      if (!result.label || Array.from(result.label).length>25) { failures.push("invalid_label"); continue; }
      if (!holds(result.quote,c.text)) { failures.push("quote_mismatch"); continue; }
      return {seq:c.seq,t:c.t,...result,source:"model",attempts:attempt,failure:failures.join(",") || null};
    } catch { failures.push("generation_error"); }
  }
  return {seq:c.seq,t:c.t,label:fallbackTitle(c.text),quote:"",source:"fallback",attempts:2,failure:failures.join(",")};
}
