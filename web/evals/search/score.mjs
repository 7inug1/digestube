/** Digestube 검색 개발 평가 — 채점기.
 *
 *  실행 결과(runs/*.json)와 config.json 을 읽어 문항별 판정과 보고서를 만든다.
 *  채점 단위는 "필수 근거 항목". top-3 안에 그 항목의 문단이 하나라도 있으면 찾은 것으로 본다.
 *  config.options 는 사용자 결정에 따라 바꾸는 값이다. 결과를 보고 바꾸지 않는다.
 *
 *    node score.mjs runs/<실행>.json
 */
import {readFileSync, writeFileSync} from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const runPath = process.argv[2];
if (!runPath) throw new Error('실행 결과 파일 경로가 필요합니다.');
const run = JSON.parse(readFileSync(runPath));
const O = cfg.options, K3 = cfg.k_score;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function effectiveFeatures(q) {
  if (q.id === 'Q05' && !O.q05_split) return [q.merged_when_not_split];
  return q.features
    .filter(f => !(f.drop_when && O[f.drop_when.flag] === f.drop_when.value))
    .map(f => f.optional_extra && O[f.optional_extra.flag] ? {...f, accept: [...f.optional_extra.seq, ...f.accept]} : f);
}

function cover(q, feats, hits) {
  return feats.map(f => {
    const own = hits.filter(h => h.video_id === q.video);
    const p = own.find(h => f.accept.includes(h.seq));
    const a = !p && own.find(h => (f.alt ?? []).includes(h.seq));
    const m = p || a;
    return {name: f.name, found: !!m, seq: m?.seq ?? null, rank: m?.rank ?? null, via_alt: !!a};
  });
}

const rec = Object.fromEntries(run.records.map(r => [r.id, r]));
const scored = [];

for (const q of cfg.positives) {
  const r = rec[q.id];
  const feats = effectiveFeatures(q);
  if (!r || r.error) { scored.push({id: q.id, lang: q.lang, verdict: '오류', error: r?.error ?? '기록 없음', features: feats.length}); continue; }
  const top3 = r.hits.filter(h => h.rank <= K3), top5 = r.hits;
  const c3 = cover(q, feats, top3), c5 = cover(q, feats, top5);
  const got = c3.filter(c => c.found).length;
  let verdict = got === feats.length ? '충분히 찾음' : got > 0 ? '일부 찾음' : '못 찾음';
  let note = null;
  if (q.id === 'Q06' && got === 0 && top3.some(h => h.video_id === q.video && q.support.includes(h.seq))) {
    note = '원리 문단 없이 절차 문단(보조)만 반환';
    if (O.q06_support_is_partial) verdict = '일부 찾음';
  }
  const label = h => {
    if (h.video_id !== q.video) return `다른 영상`;
    const hitF = feats.findIndex(f => f.accept.includes(h.seq) || (f.alt ?? []).includes(h.seq));
    if (hitF >= 0) return `항목 ${hitF + 1}${(feats[hitF].alt ?? []).includes(h.seq) ? ' (대체)' : ''}`;
    if (q.support?.includes(h.seq)) return '보조';
    return '무관';
  };
  scored.push({id: q.id, lang: q.lang, q: q.q, verdict, note, features: feats.length, found3: got, found5: c5.filter(c => c.found).length,
    ms: r.ms, coverage3: c3, coverage5: c5, manual_check: q.manual_check ?? null,
    hits: top5.map(h => ({...h, time: `${mmss(h.t)}–${mmss(h.t_end)}`, role: label(h), counted: h.rank <= K3}))});
}

const negs = cfg.negatives.map(n => {
  const r = rec[n.id];
  if (!r || r.error) return {id: n.id, q: n.q, status: '오류', error: r?.error ?? '기록 없음'};
  const top = r.hits[0];
  return {id: n.id, q: n.q, status: r.hits.length ? '결과 반환' : '빈 결과', returned: Math.min(r.hits.length, K3),
    top1: top ? {video_id: top.video_id, seq: top.seq, score: top.score, time: `${mmss(top.t)}–${mmss(top.t_end)}`} : null, ms: r.ms};
});

const pos = scored.filter(s => s.verdict !== '오류');
const tally = arr => Object.fromEntries(['충분히 찾음', '일부 찾음', '못 찾음', '오류'].map(v => [v, arr.filter(s => s.verdict === v).length]));
const featCov = (arr, key) => { const f = arr.reduce((a, s) => a + s.features, 0), g = arr.reduce((a, s) => a + (s[key] ?? 0), 0); return {found: g, total: f}; };
const multi = pos.filter(s => s.features >= 3);
const allMs = run.records.filter(r => !r.error).map(r => r.ms);

const summary = {
  corpus_stable: run.corpus_stable, options: O,
  verdicts: {all: tally(scored), ko: tally(scored.filter(s => s.lang === 'ko')), en: tally(scored.filter(s => s.lang === 'en'))},
  feature_coverage_top3: {all: featCov(pos, 'found3'), ko: featCov(pos.filter(s => s.lang === 'ko'), 'found3'), en: featCov(pos.filter(s => s.lang === 'en'), 'found3')},
  feature_coverage_top5: featCov(pos, 'found5'),
  multi_feature_top3_vs_top5: {top3: featCov(multi, 'found3'), top5: featCov(multi, 'found5'), questions: multi.map(s => s.id)},
  latency_ms: {first: run.records[0]?.ms ?? null, rest_median: allMs.length > 1 ? median(allMs.slice(1)) : null,
    rest_min: allMs.length > 1 ? Math.min(...allMs.slice(1)) : null, rest_max: allMs.length > 1 ? Math.max(...allMs.slice(1)) : null},
  negatives_with_result: negs.filter(n => n.status === '결과 반환').length, negatives_error: negs.filter(n => n.status === '오류').length,
};

const pct = ({found, total}) => `${found}/${total}${total ? ` (${Math.round(found / total * 100)}%)` : ''}`;
let md = `# 검색 개발 평가 결과\n\n실행 ${run.started} · 기준 ${cfg.version} · 코드 \`${run.code?.head?.slice(0, 7) ?? '?'}\`${run.code?.dirty ? ' (검색 경로 수정 있음)' : ''}\n\n`;
md += `**데이터 유지: ${run.corpus_stable ? '예' : '아니오 — 이 결과는 비교에 쓰지 않음'}** · 모드: 라이브러리 전체 검색 · 범위 4편 · 점수는 top-${K3}\n\n`;
md += `**개발 평가.** 근거를 찾는 과정에서 전사문을 이미 봤으므로 독립 최종 검증이 아니다.\n\n## 요약\n\n| | 충분히 찾음 | 일부 찾음 | 못 찾음 | 오류 |\n|---|---:|---:|---:|---:|\n`;
for (const [k, n] of [['전체', 'all'], ['한국어 원문', 'ko'], ['영어 원문', 'en']]) { const t = summary.verdicts[n]; md += `| ${k} | ${t['충분히 찾음']} | ${t['일부 찾음']} | ${t['못 찾음']} | ${t['오류']} |\n`; }
md += `\n| 필수 근거 항목 충족 | 값 |\n|---|---:|\n| 전체 (top-3) | ${pct(summary.feature_coverage_top3.all)} |\n| 한국어 원문 (top-3) | ${pct(summary.feature_coverage_top3.ko)} |\n| 영어 원문 (top-3) | ${pct(summary.feature_coverage_top3.en)} |\n| 전체 (top-5, 진단용) | ${pct(summary.feature_coverage_top5)} |\n`;
md += `| 3항목 질문 ${summary.multi_feature_top3_vs_top5.questions.join('·')} top-3 → top-5 | ${pct(summary.multi_feature_top3_vs_top5.top3)} → ${pct(summary.multi_feature_top3_vs_top5.top5)} |\n`;
const L = summary.latency_ms;
md += `\n응답 시간: 첫 요청 ${L.first}ms · 이후 중앙값 ${L.rest_median}ms (${L.rest_min}–${L.rest_max}ms). HTTP 왕복과 강조 계산을 포함한다.\n\n## 문항별\n\n`;
for (const s of scored) {
  md += `### ${s.id} · ${s.lang === 'en' ? '영어 원문' : '한국어 원문'} · **${s.verdict}**${s.features ? ` (${s.found3 ?? 0}/${s.features}항목)` : ''}\n\n`;
  if (s.error) { md += `오류: ${s.error}\n\n`; continue; }
  md += `${s.q}\n\n| 항목 | top-3 | top-5 |\n|---|---|---|\n`;
  s.coverage3.forEach((c, i) => { const c5 = s.coverage5[i]; md += `| ${c.name} | ${c.found ? `✅ seq ${c.seq} (${c.rank}위)${c.via_alt ? ' 대체' : ''}` : '—'} | ${c5.found ? `seq ${c5.seq} (${c5.rank}위)` : '—'} |\n`; });
  md += `\n| 순위 | 영상 | seq | 구간 | 점수 | 역할 |\n|---:|---|---:|---|---:|---|\n`;
  for (const h of s.hits) md += `| ${h.rank}${h.counted ? '' : ' (진단)'} | ${h.video_id} | ${h.seq} | ${h.time} | ${h.score.toFixed(3)} | ${h.role} |\n`;
  if (s.note) md += `\n비고: ${s.note}\n`;
  if (s.manual_check) md += `\n사람 확인: ${s.manual_check} — ☐ 역할·이유 설명함 ☐ 이름만 나열\n`;
  md += `\n실패 이유(사람 기록): \n\n`;
}
md += `## 답 없는 질문\n\n현재 서비스에는 거절 기능이 없다. 결과를 반환한 것을 고장으로 해석하지 않으며, 오류로 빈 결과가 나온 경우는 거절로 세지 않는다.\n\n| 문항 | 상태 | 1위 영상 | seq | 구간 | 1위 점수 |\n|---|---|---|---:|---|---:|\n`;
for (const n of negs) md += `| ${n.id} | ${n.status}${n.error ? ` (${n.error})` : ''} | ${n.top1?.video_id ?? '—'} | ${n.top1?.seq ?? '—'} | ${n.top1?.time ?? '—'} | ${n.top1 ? n.top1.score.toFixed(3) : '—'} |\n`;

const base = runPath.replace(/\.json$/, '');
writeFileSync(`${base}.scored.json`, JSON.stringify({summary, positives: scored, negatives: negs}, null, 2) + '\n');
writeFileSync(`${base}.report.md`, md);
console.log(md);
