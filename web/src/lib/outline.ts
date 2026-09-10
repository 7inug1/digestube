/** 문단 하나에 목차 제목을 붙인다 — Claude Sonnet 5.
 *
 *  고른 근거 (2026-09-09, 영상 2편·문단 13개·회당 2번)
 *    후보              통과      인용  흔들림  평균ms  출력tok
 *    Claude Sonnet 5   25/26      25    11    1894     78
 *    Claude Haiku 4.5  24/26      26     0    1310     70
 *    qwen3.8-27b       24/26      24     0     479     33
 *    gpt-oss-20b       22/26      22     0    3247    664
 *    gpt-oss-120b      19/26      19     4    2714    590
 *    qwen3.6-27b        0/26       0     0   41904    800
 *
 *  통과율은 셋이 비슷했고 제목의 구체성에서 갈렸다. Sonnet 은 원문의 특징적인
 *  말을 집었고("눈이 마주친 3초의 순간"), Haiku 는 같은 영상에서 제목이 겹쳤다
 *  ("수능을 앞두고"가 두 번). 값은 영상 한 편에 약 $0.08 로, 전사($0.33)의 1/4이라
 *  선택을 가르지 못했다.
 *
 *  ⚠️ 확정이 아니다
 *    - 표본이 영상 2편·문단 13개다. "재서 이겼다"가 아니라 "이 범위에서 나았다"
 *    - Claude 5 세대는 temperature 를 받지 않아 Sonnet 만 조건을 못 맞췄다
 *      (흔들림 11 대 0). 방법론 5단계를 지키지 못한 자리다
 *    - GPT·Gemini·국산(HyperCLOVA·Solar)은 키가 없어 아예 빠졌다
 *
 *  다시 재려면: node --env-file=.env.local scripts/bench-outline.mjs
 *  모델을 바꾸려면 아래 상수만 고친다.
 */
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

export type Labeled = { seq: number; t: number; label: string; quote: string };

async function call(text: string): Promise<{ label: string; quote: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 없다");

  const r = await fetch(URL, {
    method: "POST",
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
  return { label: String(j.label ?? "").trim(), quote: String(j.quote ?? "").trim() };
}

/** 문단 하나 → 제목. 형식이 깨지면 한 번 더 부른다. */
export async function label(c: { seq: number; t: number; text: string }): Promise<Labeled> {
  for (let i = 0; i < 2; i++) {
    try {
      const { label, quote } = await call(c.text);
      return { seq: c.seq, t: c.t, label, quote };
    } catch (e) {
      if (i || !String(e).includes("JSON 아님")) throw e;
    }
  }
  throw new Error("도달 불가");
}
