/** 리랭킹 실험 비교 — 기준선·벡터(재실행)·리랭커별 결과를 나란히 놓고 채택 규칙을 적용한다.
 *    node compare.mjs <baseline.scored.json> <stamp>
 *  <stamp> 는 rerank.mjs 실행 시각(runs/<stamp>-*.json).
 */
import {readFileSync, writeFileSync} from 'node:fs';
const [baseFile, stamp] = process.argv.slice(2);
if (!baseFile || !stamp) throw new Error('기준선 scored 파일과 실행 시각이 필요합니다.');
const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const rd = f => JSON.parse(readFileSync(new URL(`./runs/${f}`, import.meta.url)));
const MODELS = ['bge-reranker-v2-m3', 'ko-reranker'];
const V = {
  '기준선(첫 평가)': JSON.parse(readFileSync(baseFile)),
  '벡터(재실행)': rd(`${stamp}-vector.scored.json`),
  ...Object.fromEntries(MODELS.map(m => [m, rd(`${stamp}-rerank-${m}.scored.json`)])),
};
const pool = rd(`${stamp}-pool.json`);
const runs = Object.fromEntries(MODELS.map(m => [m, rd(`${stamp}-rerank-${m}.json`)]));
const vecRun = rd(`${stamp}-vector.json`);
const baseRun = JSON.parse(readFileSync(baseFile.replace('.scored.json', '.json')));
const O = cfg.options;
const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const cov = d => d.summary.feature_coverage_top3.all;
const byId = d => Object.fromEntries(d.positives.map(p => [p.id, p]));

// 1. 결정성: 재실행한 벡터 top-3 가 첫 평가와 같은가
const det = cfg.positives.concat(cfg.negatives).map(q => {
  const a = baseRun.records.find(r => r.id === q.id)?.hits.slice(0, 3).map(h => `${h.video_id}#${h.seq}`).join(',');
  const b = vecRun.records.find(r => r.id === q.id)?.hits.slice(0, 3).map(h => `${h.video_id}#${h.seq}`).join(',');
  return {id: q.id, same: a === b};
});

// 2. 풀 재현율: 필수 근거 항목이 top-20 안에 있는가
function feats(q) {
  if (q.id === 'Q05' && !O.q05_split) return [q.merged_when_not_split];
  return q.features.filter(f => !(f.drop_when && O[f.drop_when.flag] === f.drop_when.value))
    .map(f => f.optional_extra && O[f.optional_extra.flag] ? {...f, accept: [...f.optional_extra.seq, ...f.accept]} : f);
}
let inPool = 0, total = 0; const poolMiss = [];
for (const q of cfg.positives) {
  const p = pool.pools.find(x => x.id === q.id);
  for (const f of feats(q)) {
    total++;
    const hit = p.pool.find(h => h.video_id === q.video && [...f.accept, ...(f.alt ?? [])].includes(h.seq));
    if (hit) inPool++; else poolMiss.push(`${q.id} ${f.name}`);
  }
}

// 3. 채택 규칙
const base = cov(V['기준선(첫 평가)']);
const b = byId(V['기준선(첫 평가)']);
const verdictRank = {'충분히 찾음': 3, '일부 찾음': 2, '못 찾음': 1, '오류': 0};
const enCov = d => d.summary.feature_coverage_top3.en.found;
const decide = MODELS.map(m => {
  const d = V[m], c = cov(d), p = byId(d);
  const r1 = c.found > base.found;
  const drops = ['Q02', 'Q03'].filter(id => verdictRank[p[id].verdict] < verdictRank[b[id].verdict]);
  return {m, found: c.found, total: c.total, en: enCov(d), r1, r2: drops.length === 0, drops,
    rerank_ms_first: runs[m].records[0]?.ms, pass: r1 && drops.length === 0};
});
const passing = decide.filter(x => x.pass);
let pick = null, why = '';
if (!passing.length) { why = '둘 다 규칙 1·2를 통과하지 못함 → 채택하지 않음. 풀 재현율부터 본다.'; }
else if (passing.length === 1) { pick = passing[0].m; why = `${pick}만 규칙 1·2 통과.`; }
else {
  const [x, y] = [...passing].sort((a, b) => b.found - a.found);
  if (x.found - y.found > 1) { pick = x.m; why = `항목 수 ${x.found} > ${y.found}.`; }
  else if (x.en !== y.en) { const w = x.en > y.en ? x : y; pick = w.m; why = `항목 수 차 1개 이내 → 영어 원문 항목 ${w.en}개로 앞섬.`; }
  else { why = '항목·영어 동률 → 속도로 판단(아래 시간 표).'; pick = 'speed'; }
}

// 4. 시간
const lat = Object.fromEntries(MODELS.map(m => {
  const full = Object.keys(pool.pools[0].rerank).find(k => k.endsWith('/' + m));
  const rr = pool.pools.filter(p => !p.error && p.rerank[full] && !p.rerank[full].error).map(p => p.rerank[full].ms);
  return [m, {first: rr[0], rest_median: med(rr.slice(1)), rest_max: Math.max(...rr.slice(1))}];
}));
const retr = pool.pools.map(p => p.retrieval_ms).filter(Boolean);

// 5. 답 없는 질문: 리랭크 1위 점수 vs 찾아낸 정답 문단 점수
const negTop = m => runs[m].records.filter(r => r.kind === 'negative').map(r => ({id: r.id, s: r.hits[0]?.score}));
const posHitScores = m => { const d = byId(V[m]); return cfg.positives.flatMap(q => (d[q.id].hits ?? []).filter(h => h.counted && h.role.startsWith('항목')).map(h => h.score)); };

const pct = ({found, total}) => `${found}/${total} (${Math.round(found / total * 100)}%)`;
let md = `# 리랭킹 실험 비교 (개발 반복 2)\n\n실행 ${pool.started} · 같은 12문항 · 채점 기준 변경 없음 · **데이터 유지: ${pool.corpus_stable ? '예' : '아니오'}**\n\n`;
md += `## 요약\n\n| 방식 | 충분 | 일부 | 못 찾음 | 필수 근거 top-3 | top-5 |\n|---|---:|---:|---:|---:|---:|\n`;
for (const [k, d] of Object.entries(V)) { const t = d.summary.verdicts.all; md += `| ${k} | ${t['충분히 찾음']} | ${t['일부 찾음']} | ${t['못 찾음']} | ${pct(cov(d))} | ${pct(d.summary.feature_coverage_top5)} |\n`; }
md += `\n**풀 재현율(top-20 안에 필수 근거가 있는 비율): ${inPool}/${total} (${Math.round(inPool / total * 100)}%)** — 리랭킹으로 도달할 수 있는 상한.\n`;
if (poolMiss.length) md += `풀에 없는 항목: ${poolMiss.join(' · ')}\n`;
md += `\n벡터 검색 결정성: 재실행 top-3가 첫 평가와 ${det.filter(x => x.same).length}/${det.length} 문항 동일${det.some(x => !x.same) ? ` (다름: ${det.filter(x => !x.same).map(x => x.id).join(', ')})` : ''}.\n`;
md += `\n## 문항별 판정\n\n| 문항 | ${Object.keys(V).join(' | ')} |\n|---|${Object.keys(V).map(() => '---').join('|')}|\n`;
for (const q of cfg.positives) md += `| ${q.id} ${q.lang === 'en' ? '(영어)' : ''} | ${Object.values(V).map(d => { const p = byId(d)[q.id]; return `${p.verdict} ${p.found3 ?? 0}/${p.features}`; }).join(' | ')} |\n`;
md += `\n## 채택 규칙 적용\n\n| 리랭커 | 항목 top-3 | 규칙1 (>${base.found}) | 규칙2 (Q02·Q03 유지) | 영어 항목 |\n|---|---:|---|---|---:|\n`;
for (const x of decide) md += `| ${x.m} | ${x.found}/${x.total} | ${x.r1 ? '통과' : '미달'} | ${x.r2 ? '통과' : `미달(${x.drops.join(',')})`} | ${x.en} |\n`;
md += `\n**판정: ${pick && pick !== 'speed' ? pick + ' 채택 후보' : pick === 'speed' ? '속도로 결정' : '채택 안 함'}.** ${why}\n`;
md += `\n## 시간\n\n| | 첫 호출 | 이후 중앙값 | 이후 최대 |\n|---|---:|---:|---:|\n| 벡터 검색(k=20) | ${retr[0]}ms | ${med(retr.slice(1))}ms | ${Math.max(...retr.slice(1))}ms |\n`;
for (const m of MODELS) md += `| 리랭크 ${m} (20쌍) | ${lat[m].first}ms | ${lat[m].rest_median}ms | ${lat[m].rest_max}ms |\n`;
md += `\n## 답 없는 질문 (리랭크 1위 점수)\n\n| 리랭커 | N01 | N02 | N03 | N04 | 찾아낸 정답 문단 점수 범위 |\n|---|---:|---:|---:|---:|---|\n`;
for (const m of MODELS) { const n = negTop(m), ps = posHitScores(m); md += `| ${m} | ${n.map(x => x.s?.toFixed(2) ?? '—').join(' | ')} | ${ps.length ? `${Math.min(...ps).toFixed(2)} ~ ${Math.max(...ps).toFixed(2)}` : '—'} |\n`; }
md += `\n12문항으로 커트라인을 정하지 않는다(측정 전 규칙 5). 분포만 기록.\n`;
writeFileSync(new URL(`./runs/${stamp}-compare.md`, import.meta.url), md);
console.log(md);
