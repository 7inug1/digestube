/** 문단 앞에 붙이는 문맥 한 줄 — 검색(임베딩)과 순서 매기기(리랭커)에만 쓰고 화면에는 원문을 보여 준다.
 *
 *  문단 하나만 보면 "어느 영상의 어떤 대목인지"가 빠진다. "코딩 유튜버"는 문단이 아니라 채널명에,
 *  "코난이 카메라 앞에 선 계기"는 목차 제목에 있었다. Anthropic Contextual Retrieval 의 간소판으로,
 *  LLM 으로 문맥을 새로 쓰지 않고 이미 있는 제목·채널·요약·목차를 붙인다.
 *  골든셋 dev 15(2026-09-27): 근거 발견 9/14 → 10/14, 합친 판단 13/15 → 14/15. evals/search/runs 참고.
 */
export type ContextSource = {
  title?: string | null;
  channel?: string | null;
  tldr?: string[] | null;
  outline: { seq: number; label: string }[];
};

export function contextLine(v: ContextSource, seq: number): string {
  const parts: string[] = [];
  if (v.title) parts.push(`영상: ${v.title}`);
  if (v.channel) parts.push(`채널: ${v.channel}`);
  if (v.tldr?.length) parts.push(`요지: ${v.tldr[0]}`);
  // 문단보다 앞선 목차 중 가장 가까운 것이 이 문단이 속한 대목이다
  const section = v.outline.filter(o => o.seq <= seq).at(-1);
  if (section) parts.push(`이 대목: ${section.label}`);
  return parts.join(" · ");
}

export function searchText(v: ContextSource, chunk: { seq: number; text: string }): string {
  const line = contextLine(v, chunk.seq);
  return line ? `${line}\n${chunk.text}` : chunk.text;
}
