/** 점검 기준선: 저장해 둔 원본 자막 조각(ms)을 점검 스크립트가 쓰는 문단 모양(초)으로 바꾼다.
 *  운영 DB 문단은 이제 Gemini 전사라, 현재 모델을 재점검할 때는 원본 자막을 따로 읽어야 한다. */
export type Piece = { text: string; offset: number; duration: number };
export type BaselineChunk = { t: number; t_end: number; text: string };

export function piecesToChunks(pieces: Piece[]): BaselineChunk[] {
  return pieces
    .map(p => ({ t: p.offset / 1000, t_end: (p.offset + p.duration) / 1000, text: p.text.replace(/\s+/gu, " ").trim() }))
    .filter(c => c.text);
}
