/** 물어보기 — 검색이 찾은 문단(최대 3개)만 근거로 짧은 답을 쓴다.
 *
 *  "답 없음" 판단(judge.ts)이 "있음"일 때만 부른다. 문장마다 [1][2] 각주를 달아
 *  누르면 그 영상·그 시각으로 가게 한다 — NotebookLM 은 유튜브 전사에 시각이 없어 이걸 못 한다.
 *  판단이 틀려 근거가 부족하면 모델이 DECLINE 문구로 답하지 않는다(두 번째 안전장치).
 */
export const DECLINE = "찾은 문단만으로는 답하기 어려워요.";
export const ANSWER_MODEL = "gemini-3.8-flash";

export type Passage = { title: string; t: number; text: string };

const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function answerPrompt(question: string, passages: Passage[]): string {
  const body = passages.map((p, i) => `[${i + 1}] ${p.title} · ${mm(p.t)}\n${p.text}`).join("\n\n");
  return `사용자가 저장한 유튜브 영상들에서 찾은 문단들이다. 이 문단들만 근거로 질문에 답한다.

규칙
- 문단에 없는 내용은 쓰지 않는다. 일반 상식으로 채우지 않는다.
- 문장마다 끝에 근거 문단 번호를 [1]처럼 붙인다. 여러 문단이면 [1][2].
- 관련만 있고 질문에 답이 되지 않는 문단은 인용하지 않는다.
- 3~5문장, 존댓말(~요)로 쓴다. 제목·목록·굵은 글씨 없이 문장으로만 쓴다.
- 여러 영상의 말이 다르면 누가 어떻게 말했는지 나눠 쓴다.
- 문단만으로 답할 수 없으면 다른 말 없이 "${DECLINE}" 한 문장만 쓴다.

질문: ${question}

${body}`;
}

/** 본문에 나온 각주 번호 — 나온 순서대로 한 번씩, 없는 번호는 버린다. */
export function citations(text: string, n: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const k = Number(m[1]);
    if (k >= 1 && k <= n && !out.includes(k)) out.push(k);
  }
  return out;
}

/** 있지도 않은 번호의 각주는 지운다 — 누르면 갈 곳이 없다. */
export function cleanCitations(text: string, n: number): string {
  return text.replace(/\s*\[(\d+)\]/g, (all, k) => (Number(k) >= 1 && Number(k) <= n ? all : ""));
}

export function isDecline(text: string): boolean {
  return text.trim().startsWith(DECLINE);
}

/** Gemini 스트림(SSE)에서 글 조각만 꺼낸다. 마지막 덜 온 이벤트는 rest 로 남겨 다음 조각에 붙인다. */
export function splitSse(buf: string): { texts: string[]; rest: string } {
  const events = buf.replace(/\r\n/g, "\n").split("\n\n");
  const rest = events.pop() ?? "";
  const texts: string[] = [];
  for (const e of events) {
    const line = e.split("\n").find(l => l.startsWith("data:"));
    if (!line) continue;
    try {
      const d = JSON.parse(line.slice(5)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const t = d.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
      if (t) texts.push(t);
    } catch { /* 깨진 이벤트는 건너뛴다 */ }
  }
  return { texts, rest };
}

/** 답을 흘려보내며 쓴다. 조각이 올 때마다 onDelta 를 부르고, 끝나면 전체 글을 돌려준다. */
export async function streamAnswer(question: string, passages: Passage[], onDelta: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY 가 없다");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ANSWER_MODEL}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: answerPrompt(question, passages) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
    }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`답 생성 HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", all = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { texts, rest } = splitSse(buf + dec.decode(value, { stream: true }));
    buf = rest;
    for (const t of texts) { all += t; onDelta(t); }
  }
  const tail = splitSse(buf + "\n\n").texts;
  for (const t of tail) { all += t; onDelta(t); }
  return all;
}
