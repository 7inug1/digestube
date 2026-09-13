/** 3번 자리(문단 나누기) — 모델이 경계를 고르고 코드가 지킨다.
 *
 *  두 번 부른다. 원문은 모델에게 다시 쓰게 하지 않는다 — 번호만 받는다.
 *    1) 전사문 전체 → 큰 주제가 시작하는 발화 번호
 *    2) 360자를 넘는 주제만 → 그 안의 세부 경계 번호
 *
 *  프롬프트는 실험(notes/27~29)에서 쓴 것을 글자 그대로 옮겼다. 다듬으면
 *  그때 잰 결과와 나란히 놓을 수 없다.
 *
 *  코드가 지키는 것: 원문 보존·번호 범위·오름차순·700자 상한.
 *  하나라도 어긋나면 기존 문장 경계 방식으로 되돌린다 — 모델이 실패해도
 *  문단이 없는 영상이 생기지 않게 한다.
 */
import {chunk, type Chunk, type Piece} from "./chunker";

const API = "https://generativelanguage.googleapis.com/v1beta";
export const TOPIC_MODEL = process.env.TOPIC_CHUNK_MODEL ?? "gemini-3.8-flash";
/** 이 길이를 넘는 주제만 한 번 더 나눈다. 실험에서 쓴 값이다. */
const REFINE_OVER = 360;
/** 코드 안전장치. 모델 경계와 무관하게 이 길이를 넘으면 자른다. */
const HARD_MAX = 700;

const TOPIC_PROMPT = `아래는 영상 전사를 발화 단위로 끊어 번호를 붙인 것이다. 문단이 시작하는 자리를 고른다.

규칙
- 기본은 같은 논점의 설명과 바로 이어지는 사례를 한 문단에 묶는 것이다. 새로운 논점으로 넘어가면 나눈다.
- 첫째·둘째·셋째 또는 단계처럼 각각 독립적으로 설명하는 나열 항목은 분리한다. 한 문장 안에서 목록을 언급하는 것만으로 나누지는 않는다.
- 설명에서 예시나 팁으로 바뀌었다는 이유만으로 분리하지 않는다. 설명·예시·짧은 보충은 함께 유지한다.
- 같은 항목이 길게 이어질 때만 세부 내용의 전환점에서 추가로 나눈다. 긴 항목은 가능하면 2~3개 문단으로 묶고, 모든 예시를 따로 떼지 않는다.
- 짧은 도입·연결·마무리 발화는 관련된 앞뒤 문단에 묶는다. 문단 수를 늘리는 것 자체가 목표가 아니다.
- 짧은 맞장구나 화자가 바뀌었다는 이유만으로는 나누지 않는다.
- 한 줄이 완성된 문장이라는 보장은 없다. 문장이 이어지는 중이면 그 사이에서 나누지 않는다.
- 원문을 다시 출력하지 않는다. 문단이 시작하는 줄 번호만 반환한다.
- 1번은 반드시 포함한다. 번호는 오름차순이고 중복이 없다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"starts":[1]}

전사:
`;

const REFINE_PROMPT = `아래는 이미 주제별로 나눈 전사문 중 긴 구간들이다. 큰 주제 경계는 바꾸지 말고 각 구간 안에서 읽기 좋은 세부 문단의 시작 번호를 골라라.

- 각 주제의 첫 번호는 반드시 포함한다.
- 한 문단은 280~360자 정도를 권장하지만 정확한 글자 수보다 의미가 자연스럽게 완결되는 위치를 우선한다.
- 설명과 바로 이어지는 사례는 묶는다. 예시 하나마다 기계적으로 나누지 않는다.
- 설명의 초점이 바뀌는 긴 구간은 2~3개 문단으로 나눈다.
- 미완성 문장, 짧은 맞장구, 화자 변경만으로 나누지 않는다.
- 번호만 JSON으로 반환한다: {"topics":[{"topic":3,"starts":[12,20]}]}

`;

export type TopicResult = {
  chunks: Chunk[];
  /** 모델 경계를 썼는지, 코드 방식으로 되돌렸는지. 저장해서 나중에 구분한다. */
  source: "model" | "fallback";
  model: string;
  starts: number[] | null;
  problems: string[];
  ms: number;
};

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY 가 없다");
  return k.trim();
}

async function ask(prompt: string): Promise<string> {
  const k = key();
  const r = await fetch(`${API}/models/${TOPIC_MODEL}:generateContent?key=${k}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {responseMimeType: "application/json", maxOutputTokens: 16000, temperature: 0},
    }),
    signal: AbortSignal.timeout(240000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`문단 나누기 ${r.status}: ${body.slice(0, 200).replaceAll(k, "***")}`);
  const d = JSON.parse(body) as {candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[]};
  const c = d.candidates?.[0];
  if (c?.finishReason !== "STOP") throw new Error(`문단 나누기 응답 미완료: ${c?.finishReason}`);
  return c.content?.parts?.map(p => p.text ?? "").join("") ?? "";
}

function parse<T>(raw: string): T {
  const clean = raw.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)) as T;
}

const numbered = (pieces: Piece[], from = 1) =>
  pieces.map((p, i) => `${from + i}\t${p.text}`).join("\n");

const squash = (s: string) => s.replace(/\s+/gu, "");

/** 경계 번호로 문단을 만든다. 700자를 넘는 문단만 코드가 더 자른다. */
function build(pieces: Piece[], starts: number[]): Chunk[] {
  return starts.flatMap((start, i) =>
    chunk(pieces.slice(start - 1, (starts[i + 1] ?? pieces.length + 1) - 1), HARD_MAX, HARD_MAX));
}

export async function topicChunk(pieces: Piece[]): Promise<TopicResult> {
  const started = Date.now();
  const problems: string[] = [];
  const done = (chunks: Chunk[], source: TopicResult["source"], starts: number[] | null): TopicResult =>
    ({chunks, source, model: TOPIC_MODEL, starts, problems, ms: Date.now() - started});

  try {
    // 1) 큰 주제 경계
    const first = parse<{starts?: number[]}>(await ask(TOPIC_PROMPT + numbered(pieces)));
    let starts = [...new Set(first.starts ?? [])].filter(n => Number.isInteger(n) && n >= 1 && n <= pieces.length)
      .sort((a, b) => a - b);
    if (starts[0] !== 1) starts = [1, ...starts];
    if (starts.length < 2) problems.push("큰 주제 경계가 하나뿐이다");

    // 2) 긴 주제만 다시
    const groups = starts.flatMap((start, i) =>
      pieces.slice(start - 1, (starts[i + 1] ?? pieces.length + 1) - 1)
        .map(p => p.text.trim()).join(" ").length > REFINE_OVER
        ? [{topic: i + 1, start, end: starts[i + 1] ?? pieces.length + 1}] : []);

    let additions: number[] = [];
    if (groups.length) {
      const lines = groups.map(g =>
        `주제 ${g.topic}\n` + numbered(pieces.slice(g.start - 1, g.end - 1), g.start)).join("\n\n");
      const second = parse<{topics?: {topic: number; starts: number[]}[]}>(await ask(REFINE_PROMPT + lines));
      const allowed = new Set(groups.flatMap(g =>
        Array.from({length: g.end - g.start}, (_, i) => g.start + i)));
      additions = (second.topics ?? []).flatMap(t => t.starts ?? [])
        .filter(n => Number.isInteger(n) && allowed.has(n) && !starts.includes(n));
    }

    const all = [...new Set([...starts, ...additions])].sort((a, b) => a - b);
    const chunks = build(pieces, all);

    // 코드가 지키는 선. 하나라도 어긋나면 모델 결과를 쓰지 않는다.
    if (squash(chunks.map(c => c.text).join("")) !== squash(pieces.map(p => p.text).join(""))) {
      problems.push("원문 보존 실패");
      return done(chunk(pieces), "fallback", null);
    }
    if (chunks.some(c => !c.text.trim())) { problems.push("빈 문단"); return done(chunk(pieces), "fallback", null); }
    if (!chunks.length) { problems.push("문단 없음"); return done(chunk(pieces), "fallback", null); }

    return done(chunks, "model", all);
  } catch (e) {
    // 모델이 실패해도 문단은 나와야 한다. 기존 문장 경계 방식으로 되돌린다.
    problems.push((e as Error).message);
    return done(chunk(pieces), "fallback", null);
  }
}
