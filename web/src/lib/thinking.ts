/** Gemini 3 의 생각(thinking) 단계. 끌 수는 없고 low · medium(기본) · high 셋이다.
 *  생각 토큰도 출력 단가로 과금된다 — 받아쓰기에는 깊은 추론이 필요 없어 낮출 여지가 있다(notes/35).
 *  https://ai.google.dev/gemini-api/docs/thinking (2026-09-27 조회) */
const LEVELS = ["low", "medium", "high"] as const;
export type ThinkingLevel = (typeof LEVELS)[number];

export function thinkingConfig(level: string | undefined): { thinkingConfig?: { thinkingLevel: ThinkingLevel } } {
  if (level === undefined) return {};
  if (!(LEVELS as readonly string[]).includes(level)) throw new Error(`생각 단계는 low · medium · high 중 하나: ${level}`);
  return { thinkingConfig: { thinkingLevel: level as ThinkingLevel } };
}
