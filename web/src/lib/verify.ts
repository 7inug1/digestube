/** 근거 대조 — 제목이 기댄 문장이 원문에 실제로 있는가.
 *
 *  없으면 그 항목을 버린다. 고를 것이 없는 자리라 후보 비교가 없다.
 *
 *  이 장치가 왜 필요한지는 벤치마크에서 그대로 드러났다. qwen3.6-27b 는
 *  JSON 을 24/26 만들면서 인용은 0/26 이었다 — 형식은 지키고 원문에 없는
 *  문장을 지어냈다. 대조가 없었으면 그 목차가 전부 통과했을 것이다.
 *
 *  판정을 어떻게 하느냐가 그 숫자를 바꾼다
 *    글자 그대로 일치를 요구하면 공백이나 구두점 하나 차이로 멀쩡한 인용이
 *    떨어진다. 그래서 공백과 구두점을 지운 뒤 부분 문자열로 본다.
 *    이 완화가 어디까지 봐주는지가 통과율을 좌우하므로 규칙은 여기 한 곳에만 둔다.
 */
const DROP = /[\s.,!?…·"'“”‘’()\[\]{}~\-—]+/g;

export const norm = (s: string) => (s ?? "").replace(DROP, "");

export function holds(quote: string, source: string): boolean {
  const q = norm(quote);
  return Boolean(q) && norm(source).includes(q);
}

/** 통과한 항목만 남기고, 인용 통과율을 함께 낸다. */
export function check<T extends { seq: number; quote: string }>(
  items: T[],
  chunks: { seq: number; text: string }[],
) {
  const bySeq = new Map(chunks.map((c) => [c.seq, c.text]));
  const kept = items.filter((x) => holds(x.quote, bySeq.get(x.seq) ?? ""));
  const n = items.length;
  return {
    kept,
    stats: { n, kept: kept.length, quote_pass: n ? Math.round((kept.length / n) * 100) : 0 },
  };
}
