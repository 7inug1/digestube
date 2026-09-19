/** Gemini 로 유튜브 영상을 직접 전사한다.
 *
 *  2번 자리(전사) 선정 근거는 notes/22-transcription-gemini.md 에 있다.
 *  한국어 6편에서 통과 기준 6/6 을 충족했다. Supadata native 는 오인식이 잦고
 *  영상에 따라 구두점이 아예 없어서 문단 나누기가 무너졌다.
 *
 *  유튜브 주소를 그대로 넘긴다 — 배포 서버가 유튜브에서 직접 오디오를 받지 못하는
 *  제약(데이터센터 IP 차단)을 우회하는 방식이다.
 */
import type {Piece, Result} from "./supadata";
import {timeoutFor} from "./deadline";

const API = "https://generativelanguage.googleapis.com/v1beta";
/** 모델을 고정한다. 바꾸면 다시 재야 한다 — 근거는 notes/26-transcription-model-compare.md.
 *  3.5-flash 로 6/6 을 확인했지만 단가가 두 배($1.50/$9.00 대 $0.75/$3.75)라 3.8 로 옮겼다.
 *  3.8 은 아직 2편만 확인했다. 나머지는 채우는 중이다. */
export const MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.8-flash";

const PROMPT = `이 영상의 음성을 그대로 받아쓴다.

규칙
- 들리는 말을 빠짐없이 옮긴다. 요약하거나 생략하지 않는다.
- 구두점을 정상적으로 찍는다.
- 화면에 뜬 글자는 옮기지 않는다. 음성만 옮긴다.
- 발화 단위로 끊고 각 단위의 시작·끝 시각을 MM:SS 로 적는다.
- lang 은 음성의 언어를 ISO 639-1 두 글자로 적는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"lang":"ko","segments":[{"start":"MM:SS","end":"MM:SS","text":"받아쓴 말"}]}`;

type Segment = {start: string; end: string; text: string};

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY 가 없다");
  return k.trim();
}

/** MM:SS 또는 HH:MM:SS → 초. 형식이 아니면 null 이다. */
function seconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

/** 발화 단위를 자막 조각과 같은 모양으로 바꾼다. 청킹·저장은 기존 경로를 그대로 쓴다.
 *  끝시각이 없거나 거꾸로면 다음 조각의 시작까지로 메운다 — 시각을 지어내지 않는다. */
function toPieces(segments: Segment[]): Piece[] {
  const rows = segments
    .map(s => ({text: typeof s.text === "string" ? s.text.trim() : "", start: seconds(s.start), end: seconds(s.end)}))
    .filter(s => s.text && s.start !== null);
  const out: Piece[] = [];
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i].start!;
    const next = rows[i + 1]?.start ?? null;
    let end = rows[i].end;
    if (end === null || end < start) end = next !== null && next > start ? next : start;
    out.push({text: rows[i].text, offset: Math.round(start * 1000), duration: Math.round((end - start) * 1000)});
  }
  return out;
}

export type Usage = {promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number};

export async function transcribe(videoUrl: string, until?: number): Promise<Result> {
  return (await transcribeWithUsage(videoUrl, until)).result;
}

/** 영상의 한 구간. 서버 한 번 실행이 300초까지라 긴 영상은 나눠서 받아쓴다.
 *  돌아오는 시각은 잘라낸 구간 기준이 아니라 영상 전체 기준이다(확인함) —
 *  그래서 이어 붙일 때 보정할 것이 없다. */
export type Range = { from: number; to: number };

function call(videoUrl: string, stream = false, range?: Range, until?: number): Promise<Response> {
  const path = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
  const file: Record<string, unknown> = { fileData: { fileUri: videoUrl } };
  if (range) file.videoMetadata = { startOffset: `${range.from}s`, endOffset: `${range.to}s` };
  return fetch(`${API}/models/${MODEL}:${path}key=${key()}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      contents: [{parts: [{text: PROMPT}, file]}],
      generationConfig: {responseMimeType: "application/json", maxOutputTokens: 65536, temperature: 0},
    }),
    // 실측 처리 시간은 영상 길이의 10~15% 였다(10.9분 영상 96초).
    signal: AbortSignal.timeout(timeoutFor("전사", 280000, until)),
  });
}


/** 받아쓰는 동안 한 줄씩 내보낸다.
 *
 *  다 끝나고 한 번에 주면 10분 영상에 96초 동안 빈 화면이다. 값이나 결과는 같고
 *  기다리는 느낌만 달라진다 — 첫 문장이 몇 초 만에 뜨면 무슨 일이 벌어지는지 보인다.
 *
 *  모델은 JSON 하나를 흘려 보낸다. 중간 조각은 깨진 JSON 이라 통째로는 못 읽는다.
 *  segments 배열 안에서 중괄호가 맞아떨어진 객체만 골라 그때그때 넘긴다.
 *  전문은 서버가 따로 쌓는다 — 화면이 끊겨도 저장은 끝까지 간다.
 */
export async function transcribeStream(
  videoUrl: string,
  onSegment: (seg: Segment) => void,
  range?: Range,
  until?: number,
): Promise<{result: Result; usage: Usage}> {
  let r = await call(videoUrl, true, range, until);
  if (r.status === 503 || r.status === 429) {
    await new Promise(res => setTimeout(res, 3000));
    r = await call(videoUrl, true, range, until);
  }
  if (r.status === 503 || r.status === 429) {
    throw new Error("전사 서버가 지금 붐벼요. 잠시 뒤 다시 눌러주세요.");
  }
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`전사에 실패했습니다 (${r.status}): ${body.slice(0, 200).replaceAll(key(), "***")}`);
  }
  if (!r.body) throw new Error("전사 응답이 비어 있습니다.");

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let sse = "";      // 아직 줄바꿈이 안 온 SSE 조각
  let json = "";     // 모델이 지금까지 뱉은 JSON 전체
  let sent = 0;      // 이미 화면으로 넘긴 조각 수
  let usage: Usage = {};
  const segments: Segment[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sse += decoder.decode(value, { stream: true });
    const lines = sse.split("\n");
    sse = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      usage = chunk.usageMetadata ?? usage;
      const stop = chunk.candidates?.[0]?.finishReason;
      if (stop && stop !== "STOP") throw new Error(reasonMessage(stop));
      const piece = chunk.candidates?.[0]?.content?.parts?.map((x: {text?: string}) => x.text ?? "").join("") ?? "";
      if (!piece) continue;
      json += piece;
      sent = drain(json, sent, seg => { segments.push(seg); onSegment(seg); });
    }
  }

  const content = toPieces(segments);
  if (!content.length) throw new Error("전사 결과가 비어 있습니다. 기존 내용은 유지됩니다.");
  const lang = /"lang"\s*:\s*"([a-z]{2})"/i.exec(json)?.[1]?.toLowerCase();
  return {result: {lang, content}, usage};
}

/** 모델이 중간에 멈춘 이유를 사람 말로 옮긴다. RECITATION 은 받아쓴 글이 어딘가에
 *  그대로 있는 글과 너무 닮았다고 모델이 스스로 멈춘 것이다 — 낭독·자막 읽기 영상에서 난다.
 *  영어 약어를 그대로 보여주면 쓰는 사람은 자기가 뭘 잘못했는지 알 수 없다. */
function reasonMessage(reason: string): string {
  if (reason === "RECITATION") return "이 영상은 받아쓰기가 중간에 막혔어요. 다른 영상으로 해볼까요?";
  if (reason === "SAFETY") return "이 영상은 받아쓸 수 없는 내용이 있어요.";
  if (reason === "MAX_TOKENS") return "영상이 너무 길어 한 번에 다 받아쓰지 못했어요.";
  return `전사가 끝까지 오지 않았어요 (${reason}).`;
}

/** 쌓인 JSON 에서 아직 안 넘긴 조각을 꺼낸다. 이미 넘긴 개수를 돌려준다.
 *
 *  바깥은 {"lang":..,"segments":[..]} 하나라 중괄호 깊이가 1 로 시작한다.
 *  깊이가 0 으로 떨어지길 기다리면 맨 끝까지 아무것도 안 나온다 — 처음에 그렇게
 *  짰다가 조각이 하나도 안 왔다. 깊이 2 에서 1 로 돌아오는 객체가 우리가 찾는 것이다.
 *
 *  매번 처음부터 훑는다. 이어서 훑으려면 깊이를 호출 사이에 들고 다녀야 하는데,
 *  전사문은 길어야 수백 KB 라 다시 훑는 값이 그 복잡함보다 싸다.
 */
function drain(json: string, already: number, emit: (seg: Segment) => void): number {
  let depth = 0, start = -1, seen = 0, inStr = false, esc = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 1) start = i; depth++; continue; }
    if (c === "}") {
      depth--;
      if (depth === 1 && start >= 0) {
        seen++;
        if (seen > already) {
          try {
            const o = JSON.parse(json.slice(start, i + 1));
            if (typeof o?.text === "string" && typeof o?.start === "string") emit(o as Segment);
          } catch {}
        }
        start = -1;
      }
    }
  }
  return seen;
}

/** 토큰 사용량까지 필요한 곳(재전사 스크립트·측정)에서 쓴다. */
export async function transcribeWithUsage(videoUrl: string, until?: number): Promise<{result: Result; usage: Usage}> {
  let r = await call(videoUrl, false, undefined, until);
  // 503(혼잡)·429(속도 제한)는 구글 쪽 사정이고 비용도 없다. 3초 뒤 한 번만 더 두드린다.
  // 2026-09-16 운영에서 503 이 연달아 났는데 로컬은 4초 만에 됐다 — 경로 문제라 재시도가 먹힌다.
  if (r.status === 503 || r.status === 429) {
    await new Promise(res => setTimeout(res, 3000));
    r = await call(videoUrl, false, undefined, until);
  }
  const body = await r.text();
  if (r.status === 503 || r.status === 429) {
    throw new Error("전사 서버가 지금 붐벼요. 잠시 뒤 다시 눌러주세요.");
  }
  // 키가 에러 응답에 그대로 돌아오는 경우가 있어 가린다.
  if (!r.ok) throw new Error(`전사에 실패했습니다 (${r.status}): ${body.slice(0, 200).replaceAll(key(), "***")}`);


  const data = JSON.parse(body) as {
    candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[];
    usageMetadata?: Usage;
  };
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(reasonMessage(candidate.finishReason));
  }
  const raw = candidate?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  let parsed: {lang?: string; segments?: Segment[]};
  try { parsed = JSON.parse(raw) as typeof parsed; }
  catch { throw new Error("전사 결과를 읽지 못했습니다. 잠시 후 다시 시도해 주세요."); }

  const content = toPieces(parsed.segments ?? []);
  if (!content.length) throw new Error("전사 결과가 비어 있습니다. 기존 내용은 유지됩니다.");
  const lang = typeof parsed.lang === "string" && /^[a-z]{2}$/i.test(parsed.lang) ? parsed.lang.toLowerCase() : undefined;
  return {result: {lang, content}, usage: data.usageMetadata ?? {}};
}
