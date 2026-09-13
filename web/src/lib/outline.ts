/** 목차 모델. 사람 품질 평가는 보류 중이다.
 * 자동 인용 검사는 제목의 의미 정확성을 보장하지 않는다.
 * 비교 기록: scripts/bench-outline.mjs, scripts/pilot-outline.mjs, scripts/compare-outline.ts.
 *
 * 2026-09-13: Anthropic 크레딧이 떨어져 Sonnet 5 로는 목차를 만들 수 없다.
 * 전사에 쓰는 Gemini 로 옮긴다. 프롬프트는 그대로 둔다 — 모델에 맞춰 다듬으면
 * 지난 비교 결과와 나란히 놓을 수 없다. 되돌리려면 OUTLINE_PROVIDER=anthropic.
 */
import { holds } from "./verify";
import type { Outline } from "./types";

const PROVIDER = (process.env.OUTLINE_PROVIDER ?? "gemini") as "gemini" | "anthropic";
export const MODEL = PROVIDER === "gemini"
  ? (process.env.OUTLINE_MODEL ?? "gemini-3.8-flash")
  : "claude-sonnet-5";
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

async function callGemini(text: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 가 없다");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      contents: [{parts: [{text: PROMPT.replace("{text}", text)}]}],
      generationConfig: {responseMimeType: "application/json", maxOutputTokens: 2000, temperature: 0},
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`목차 ${r.status}: ${body.slice(0, 200).replaceAll(key, "***")}`);
  const d = JSON.parse(body) as {candidates?: {content?: {parts?: {text?: string}[]}}[]};
  return d.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
}

async function callAnthropic(text: string): Promise<string> {
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

  return (d.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
}

async function call(text: string): Promise<{ label: string; quote: string }> {
  const out = PROVIDER === "gemini" ? await callGemini(text) : await callAnthropic(text);
  // 시킨 형식을 안 지키는 일이 가끔 있다. 벤치마크에서 26회 중 1회였다.
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) throw new Error(`JSON 아님: ${out.slice(0, 120)}`);
  const j = JSON.parse(m[0]);
  if (typeof j.label !== "string" || typeof j.quote !== "string") throw new Error("invalid_fields");
  return { label: j.label.trim(), quote: j.quote.trim() };
}

/** 첫 문장을 25자 이내로 줄여 제목 자리를 채운다. 줄임표도 25자 안에 든다. */
export function fallbackTitle(text: string): string {
  const first = text.trim().replace(/\s+/g, " ").match(/^[\s\S]*?[.!?。？！](?=\s|$)|^[\s\S]+/)?.[0] ?? "";
  const chars = Array.from(first);
  return chars.length <= 25 ? first : chars.slice(0, 24).join("").trimEnd() + "…";
}

/** 한 번 더 시도하고, 그래도 확인되지 않으면 **원문 첫 문장으로 채운다**.
 *
 *  목차가 비면 그 대목으로 건너뛸 길이 사라지고 읽는 흐름이 끊긴다. 그래서
 *  줄을 남기되 `source:"fallback"` 으로 구분한다 — 모델이 붙인 제목과 섞이지
 *  않게 하고, 폴백 비율을 품질 지표로 셀 수 있게 한다.
 *  (2026-09-13 결정: 이력서 문장을 제품 동작에 맞춰 고친다. 반대로 하지 않는다.) */
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
  console.warn(`목차 확인 실패로 폴백 seq=${c.seq}: ${failures.join(",")}`);
  return {seq:c.seq,t:c.t,label:fallbackTitle(c.text),quote:"",source:"fallback",attempts:2,failure:failures.join(",")};
}
