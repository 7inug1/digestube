/** "라이브러리에 질문의 답이 있나" 판단 — 리랭커 1위 점수와 AI 판정을 합친다.
 *
 *  점수가 확실히 높거나(-2 이상) 확실히 낮으면(-8 미만) 점수로 바로 정하고, 그 사이만 AI 에게
 *  "이 문단들이 질문에 답이 되나"를 묻는다. 점수만으로는 주제가 가까운 "답 없음"을 못 거르고,
 *  AI 만 쓰면 매번 느리고 관련만 있는 문단(함정)에 속았다.
 *  골든셋 dev 15(2026-09-27): 점수 -4 12/15 · AI 만 실질 12/15 · 합치기 13/15(문맥 줄과 함께 14/15), AI 호출 27~40%.
 *  경계는 지금까지 본 개발 질문 27개에서 정했다 — 답 없는 질문 1위 점수 최대 -3.67, 정답을 찾은 질문은 1개를 빼고 -7.2 이상.
 */
export const HIGH = -2;
export const LOW = -8;
/** AI 가 실패하거나 늦을 때 쓰는 점수 기준. dev 15 에서 1위 점수만으로 가장 많이 맞힌 구간(-3.6~-2.5)의 가운데 */
export const FALLBACK = -3;
export const JUDGE_TIMEOUT_MS = 3000;

export type Verdict = { answerable: boolean; why: string };
export type Decision = { weak: boolean; by: "score" | "ai" | "fallback"; why?: string };

export async function decide(top: number, judge: () => Promise<Verdict>): Promise<Decision> {
  if (top >= HIGH) return { weak: false, by: "score" };
  if (top < LOW) return { weak: true, by: "score" };
  try {
    const v = await judge();
    return { weak: !v.answerable, by: "ai", why: v.why };
  } catch {
    return { weak: top < FALLBACK, by: "fallback" };
  }
}

const PROMPT = `아래는 사용자의 질문과, 사용자가 저장한 영상들의 전사문에서 찾은 문단 3개다.
이 문단들만 근거로 질문에 답할 수 있는지 판단한다.

규칙
- 문단에 질문이 묻는 내용이 직접 들어 있거나, 여러 문단을 합치면 답이 될 때만 answerable 을 true 로 한다.
- 주제만 비슷하고 질문이 묻는 내용이 없으면 false 다. 그럴듯하게 이어 붙여 답을 지어내지 않는다.
- "어느 영상이었지", "누구였지"처럼 찾는 대상을 묻는 질문은, 설명에 맞는 대목이 문단에 있으면 true 다.
- used 에는 답에 실제로 쓰이는 문단 번호만 적는다. 관련만 있고 답이 아닌 문단은 넣지 않는다.
- JSON 하나만 출력한다.

{"answerable": true, "used": [1], "why": "판단 이유 한 문장"}`;

/** Gemini 에 판정을 묻는다. 프롬프트는 evals/search/goldenset-judge.py 와 같다(골든셋으로 잰 그대로). */
export async function judgeWithGemini(question: string, passages: string[], timeoutMs = JUDGE_TIMEOUT_MS): Promise<Verdict> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY 가 없다");
  const body = passages.slice(0, 3).map((p, i) => `[${i + 1}] ${p}`).join("\n\n");
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${PROMPT}\n\n질문: ${question}\n\n${body}` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`판정 HTTP ${r.status}`);
  const d = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const v = JSON.parse(d.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "") as Partial<Verdict>;
  if (typeof v.answerable !== "boolean") throw new Error("판정 응답 모양이 다르다");
  return { answerable: v.answerable, why: String(v.why ?? "") };
}
