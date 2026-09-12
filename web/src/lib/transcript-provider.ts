/** 전사를 누가 하는가 — 청사진 2번 자리.
 *
 *  2026-09-12 에 Supadata native 에서 Gemini 로 바꿨다(근거: notes/22-transcription-gemini.md).
 *  환경변수로 되돌릴 수 있게 둔다 — 코드를 다시 올리지 않고 바꾸려는 것이다.
 */
export type Provider = "gemini" | "supadata";

export function provider(): Provider {
  const value = process.env.TRANSCRIPT_PROVIDER ?? "gemini";
  if (value !== "gemini" && value !== "supadata") {
    throw new Error("TRANSCRIPT_PROVIDER는 gemini 또는 supadata여야 합니다.");
  }
  return value;
}
