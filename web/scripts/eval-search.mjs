/** 검색 임계치를 재는 스크립트.
 *
 *   node --env-file=.env.local scripts/eval-search.mjs
 *
 * 관련 있는 질문과 없는 질문의 1등 점수를 나란히 놓고, 두 무리가 겹치는지 본다.
 * 겹치지 않으면 그 사이에 선을 그을 수 있다.
 *
 * ⚠️ 질문 11개는 임시다. 골든셋이 생기면 그것으로 바꾼다 —
 *    notes/10-search-threshold.md 참고.
 */
const BASE = process.env.EVAL_BASE ?? "http://127.0.0.1:3000";

const RELEVANT = [
  "눈 마주치면 민망해", "임신했을 때 지하철", "남 눈치 안 보고 살고 싶다",
  "시험 앞두고 긴장돼", "낡은 차 타는 게 창피해", "친절한 사람이 되고 싶다",
];
const IRRELEVANT = [
  "파이썬 문법", "주식 투자 방법", "김치찌개 레시피", "축구 경기 결과", "비행기 예약",
];

async function top(q) {
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&k=3`);
  const d = await r.json();
  if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 160));
  return d;
}

const box = { 관련: [], 무관: [] };
for (const [key, qs] of [["관련", RELEVANT], ["무관", IRRELEVANT]]) {
  console.log(`\n═══ ${key} 있음/없음 ═══`);
  for (const q of qs) {
    const hits = await top(q);
    box[key].push(hits[0]?.score ?? 0);
    console.log(`\n▶ ${q}`);
    hits.forEach((h) =>
      console.log(`  ${h.score.toFixed(3)}  ${h.video_id.slice(0, 6)}  ${(h.hl ?? h.text).slice(0, 50)}`));
  }
}

console.log("\n" + "─".repeat(56));
const line = (k) => {
  const s = box[k];
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return `최저 ${Math.min(...s).toFixed(3)} · 평균 ${avg.toFixed(3)} · 최고 ${Math.max(...s).toFixed(3)}`;
};
console.log(`관련 있음  ${line("관련")}`);
console.log(`관련 없음  ${line("무관")}`);
const gap = Math.min(...box.관련) - Math.max(...box.무관);
console.log(gap > 0
  ? `\n겹치지 않는다. 틈 ${gap.toFixed(3)} — 그 사이에 선을 그을 수 있다.`
  : `\n겹친다(${gap.toFixed(3)}). 점수만으로는 가를 수 없다.`);
