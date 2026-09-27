/** 내려받은 음성 파일을 Gemini 입력으로 만든다(로컬 전용 — notes/34).
 *
 *  유튜브 주소를 넘기면 Gemini 는 화면까지 입력으로 받아 초당 약 100토큰을 쓴다.
 *  음성만 넘기면 초당 32토큰이다. 서버는 유튜브 다운로드가 막혀 이 길을 못 쓰고,
 *  집 인터넷에서 돌리는 로컬에서만 쓸 수 있다.
 */
const MIME: Record<string, string> = { mp3: "audio/mp3", m4a: "audio/aac", aac: "audio/aac", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac" };
/** 요청 전체 20MB 한도. 프롬프트 몫으로 1MB 를 남긴다. */
const INLINE_LIMIT = 19 * 1024 * 1024;

export function audioPart(path: string, bytes: Buffer) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME[ext];
  if (!mimeType) throw new Error(`지원하지 않는 음성 형식: .${ext}`);
  const data = bytes.toString("base64");
  if (data.length > INLINE_LIMIT) throw new Error("인라인 입력은 요청 20MB 안이어야 한다 — 파일 API 를 써야 한다");
  return { inlineData: { mimeType, data } };
}
