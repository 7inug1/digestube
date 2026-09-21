/** 리랭킹 실험 (읽기 전용, 개발 반복 2).
 *
 *  운영 벡터 검색에서 top-20 을 받아 리랭커로 다시 순위를 매기고, 리랭커별로
 *  run.mjs 와 같은 형식의 결과를 남긴다(score.mjs 로 그대로 채점). 운영 코드·DB 는 바꾸지 않는다.
 *  검색 결과 본문은 화면에 찍지 않는다.
 *
 *    node --env-file=../../.env.local rerank.mjs
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const POOL = 20;
const MODELS = ['BAAI/bge-reranker-v2-m3', 'Dongjin-kr/ko-reranker'];
const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const {SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: K, HF_TOKEN: T} = process.env;
if (!U || !K || !T) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / HF_TOKEN 이 필요합니다 (--env-file).');
const sha = s => createHash('sha256').update(s).digest('hex');
const rest = async p => {
  const r = await fetch(`${U}/rest/v1/${p}`, {headers: {apikey: K, Authorization: `Bearer ${K}`}});
  if (!r.ok) throw new Error(`스냅샷 조회 실패 ${r.status}`);
  return r.json();
};
const VIDEOS = [cfg.auto_sample, ...cfg.ids];

async function snapshot() {
  const out = {};
  for (const id of VIDEOS) {
    const [v] = await rest(`video?select=id,revision,status&id=eq.${encodeURIComponent(id)}`);
    const ch = await rest(`chunk?select=seq,text,embedding&video_id=eq.${encodeURIComponent(id)}&order=seq`);
    out[id] = {revision: v?.revision ?? null, chunks: ch.length,
      transcript_sha256: sha(ch.map(c => c.text).join(' ')), embedding_sha256: sha(ch.map(c => String(c.embedding)).join('|')),
      by_seq: Object.fromEntries(ch.map(c => [c.seq, sha(c.text)]))};
  }
  return out;
}

async function rerank(model, q, texts) {
  const t0 = performance.now();
  const r = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: 'POST', headers: {Authorization: `Bearer ${T}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({inputs: texts.map(p => ({text: q, text_pair: p})), parameters: {function_to_apply: 'none', top_k: null, truncation: true}}),
    signal: AbortSignal.timeout(120000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`리랭커 ${r.status}: ${body.slice(0, 120)}`);
  const d = JSON.parse(body);
  if (!Array.isArray(d) || d.length !== texts.length) throw new Error('리랭커 응답 개수 불일치');
  // top_k: null 이면 입력마다 [{score}] 하나씩, 입력 순서 그대로 온다(위치 표지로 확인함).
  if (!d.every(x => Array.isArray(x) && x.length === 1)) throw new Error('리랭커 응답 형식이 예상과 다름');
  return {scores: d.map(x => x[0].score), ms: Math.round(performance.now() - t0)};
}

const code = (() => {
  try {
    const dir = fileURLToPath(new URL('../../..', import.meta.url));
    return {head: execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
            dirty: execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', 'web/src', 'web/supabase'], {encoding: 'utf8'}).trim() || null};
  } catch { return null; }
})();

const started = new Date().toISOString();
const before = await snapshot();
const qs = [...cfg.positives.map(q => ({...q, kind: 'positive'})), ...cfg.negatives.map(q => ({...q, kind: 'negative'}))];
const pools = [];

for (const q of qs) {
  const url = new URL('/api/search', cfg.base);
  url.searchParams.set('q', q.q); url.searchParams.set('k', String(POOL)); url.searchParams.set('ids', cfg.ids.join(','));
  const t0 = performance.now();
  const entry = {id: q.id, kind: q.kind, q: q.q, retrieval_ms: null, error: null, pool: [], rerank: {}};
  try {
    const r = await fetch(url, {signal: AbortSignal.timeout(65000)});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const hits = (await r.json()).hits ?? [];
    entry.retrieval_ms = Math.round(performance.now() - t0);
    for (const h of hits) {
      if (!VIDEOS.includes(h.video_id)) throw new Error(`범위 밖 영상: ${h.video_id}`);
      if (before[h.video_id]?.by_seq[h.seq] !== sha(h.text ?? '')) throw new Error(`응답과 스냅샷 불일치: ${h.video_id}#${h.seq}`);
    }
    entry.pool = hits.map((h, i) => ({vec_rank: i + 1, video_id: h.video_id, seq: h.seq, t: h.t, t_end: h.t_end, vec_score: h.score, hl: h.hl ?? null, text: h.text}));
    for (const m of MODELS) {
      try { entry.rerank[m] = await rerank(m, q.q, entry.pool.map(p => p.text)); }
      catch (e) { entry.rerank[m] = {error: e.name === 'TimeoutError' ? 'timeout' : e.message}; }
    }
  } catch (e) { entry.error = e.name === 'TimeoutError' ? 'timeout' : e.message; }
  pools.push(entry);
  console.log(`${q.id}  ${entry.error ?? 'ok'}  검색 ${entry.retrieval_ms}ms  풀 ${entry.pool.length}  ` +
    MODELS.map(m => `${m.split('/')[1]} ${entry.rerank[m]?.error ?? entry.rerank[m]?.ms + 'ms'}`).join('  '));
}

const after = await snapshot();
const stable = JSON.stringify(before) === JSON.stringify(after);
const stamp = started.replace(/[:.]/g, '-');
mkdirSync(new URL('./runs/', import.meta.url), {recursive: true});
const meta = {config_version: cfg.version, started, completed: new Date().toISOString(), base: cfg.base, ids: cfg.ids,
  auto_sample: cfg.auto_sample, pool_k: POOL, k_score: cfg.k_score, code, corpus_stable: stable,
  corpus: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, {revision: v.revision, chunks: v.chunks, transcript_sha256: v.transcript_sha256, embedding_sha256: v.embedding_sha256}]))};

const asRun = (label, pick) => ({protocol: 'feature-coverage-v1', variant: label, ...meta,
  records: pools.map(p => {
    if (p.error) return {id: p.id, kind: p.kind, q: p.q, http_status: null, ms: null, error: p.error, hits: []};
    const r = pick(p);
    if (r.error) return {id: p.id, kind: p.kind, q: p.q, http_status: 200, ms: null, error: r.error, hits: []};
    return {id: p.id, kind: p.kind, q: p.q, http_status: 200, ms: r.ms, error: null,
      hits: r.order.slice(0, 5).map((x, i) => ({rank: i + 1, video_id: x.video_id, seq: x.seq, t: x.t, t_end: x.t_end,
        score: x.score, vec_rank: x.vec_rank, hl: x.hl, text_sha256: sha(x.text)}))};
  })});

const files = [];
const vec = asRun('vector-top20-first5', p => ({ms: p.retrieval_ms, order: p.pool.map(x => ({...x, score: x.vec_score}))}));
files.push([`${stamp}-vector.json`, vec]);
for (const m of MODELS) {
  const run = asRun(`rerank:${m}`, p => {
    const rr = p.rerank[m];
    if (rr?.error) return {error: rr.error};
    return {ms: p.retrieval_ms + rr.ms, order: p.pool.map((x, i) => ({...x, score: rr.scores[i]})).sort((a, b) => b.score - a.score)};
  });
  files.push([`${stamp}-rerank-${m.split('/')[1]}.json`, run]);
}
for (const [f, d] of files) writeFileSync(new URL(`./runs/${f}`, import.meta.url), JSON.stringify(d, null, 2) + '\n');
writeFileSync(new URL(`./runs/${stamp}-pool.json`, import.meta.url),
  JSON.stringify({...meta, pools: pools.map(p => ({...p, pool: p.pool.map(({text, ...x}) => ({...x, text_sha256: sha(text)}))}))}, null, 2) + '\n');
console.log(`\n데이터 유지: ${stable}`);
for (const [f] of files) console.log(`  runs/${f}`);
if (!stable) { console.error('실행 중 데이터가 바뀌었습니다. 결과를 비교에 쓰지 않습니다.'); process.exitCode = 1; }
