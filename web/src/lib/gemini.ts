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

export async function transcribe(videoUrl: string): Promise<Result> {
  return (await transcribeWithUsage(videoUrl)).result;
}

/** 토큰 사용량까지 필요한 곳(재전사 스크립트·측정)에서 쓴다. */
export async function transcribeWithUsage(videoUrl: string): Promise<{result: Result; usage: Usage}> {
  const r = await fetch(`${API}/models/${MODEL}:generateContent?key=${key()}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      contents: [{parts: [{text: PROMPT}, {fileData: {fileUri: videoUrl}}]}],
      generationConfig: {responseMimeType: "application/json", maxOutputTokens: 65536, temperature: 0},
    }),
    // 실측 처리 시간은 영상 길이의 10~15% 였다(10.9분 영상 96초).
    signal: AbortSignal.timeout(280000),
  });
  const body = await r.text();
  // 키가 에러 응답에 그대로 돌아오는 경우가 있어 가린다.
  if (!r.ok) throw new Error(`전사에 실패했습니다 (${r.status}): ${body.slice(0, 200).replaceAll(key(), "***")}`);

  const data = JSON.parse(body) as {
    candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[];
    usageMetadata?: Usage;
  };
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`전사가 끝까지 오지 않았습니다 (${candidate.finishReason}).`);
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
