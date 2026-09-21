/** Digestube 검색 개발 평가 — 실행기 (읽기 전용).
 *
 *  운영 검색 API를 그대로 부르고, 실행 전후로 평가 4편의 데이터를 스냅샷해서
 *  중간에 문단·임베딩이 바뀌면 결과를 폐기 표시한다. DB에는 아무것도 쓰지 않는다.
 *  검색 결과 본문은 화면에 찍지 않는다 — 채점 기준을 정하기 전에 결과를 보지 않으려는 것.
 *
 *    node --env-file=../../.env.local run.mjs
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (--env-file).');
const rest = async p => {
  const r = await fetch(`${U}/rest/v1/${p}`, {headers: {apikey: K, Authorization: `Bearer ${K}`}});
  if (!r.ok) throw new Error(`스냅샷 조회 실패 ${r.status}`);
  return r.json();
};
const sha = s => createHash('sha256').update(s).digest('hex');
const VIDEOS = [cfg.auto_sample, ...cfg.ids];

async function snapshot() {
  const out = {};
  for (const id of VIDEOS) {
    const [v] = await rest(`video?select=id,revision,status&id=eq.${encodeURIComponent(id)}`);
    const ch = await rest(`chunk?select=seq,t,t_end,text,embedding&video_id=eq.${encodeURIComponent(id)}&order=seq`);
    out[id] = {
      revision: v?.revision ?? null, status: v?.status ?? null, chunks: ch.length,
      missing_embedding: ch.filter(c => !c.embedding).length,
      transcript_sha256: sha(ch.map(c => c.text).join(' ')),
      embedding_sha256: sha(ch.map(c => String(c.embedding)).join('|')),
      by_seq: Object.fromEntries(ch.map(c => [c.seq, {t: c.t, t_end: c.t_end, text_sha256: sha(c.text)}])),
    };
  }
  return out;
}

const commit = (() => {
  try {
    const dir = fileURLToPath(new URL('../../..', import.meta.url));
    return {head: execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
            dirty: execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', 'web/src', 'web/supabase'], {encoding: 'utf8'}).trim() || null};
  } catch { return null; }
})();

const started = new Date().toISOString();
const before = await snapshot();
const questions = [...cfg.positives.map(q => ({...q, kind: 'positive'})), ...cfg.negatives.map(q => ({...q, kind: 'negative'}))];
const records = [];

for (const q of questions) {
  const url = new URL('/api/search', cfg.base);
  url.searchParams.set('q', q.q);
  url.searchParams.set('k', String(cfg.k_request));
  url.searchParams.set('ids', cfg.ids.join(','));
  // EVAL_RERANK=1: 운영 검색의 리랭크 경로(rerank=1)를 잰다
  if (process.env.EVAL_RERANK === '1') url.searchParams.set('rerank', '1');
  const t0 = performance.now();
  let status = null, hits = [], error = null, rerank = null;
  try {
    const r = await fetch(url, {signal: AbortSignal.timeout(65000)});
    status = r.status;
    const body = await r.text();
    if (!r.ok) throw new Error(`HTTP ${status}`);
    const d = JSON.parse(body);
    rerank = d.rerank ?? null;
    hits = (d.hits ?? []).map((h, i) => ({rank: i + 1, video_id: h.video_id, seq: h.seq, t: h.t, t_end: h.t_end,
      score: h.score, hl: h.hl ?? null, text_sha256: sha(h.text ?? '')}));
    for (const h of hits) {
      if (!VIDEOS.includes(h.video_id)) throw new Error(`범위 밖 영상 반환: ${h.video_id}`);
      const s = before[h.video_id]?.by_seq[h.seq];
      if (!s || s.text_sha256 !== h.text_sha256) throw new Error(`응답과 스냅샷 불일치: ${h.video_id}#${h.seq}`);
    }
  } catch (e) {
    error = e.name === 'TimeoutError' ? 'timeout' : e.message;
  }
  const ms = Math.round(performance.now() - t0);
  records.push({id: q.id, kind: q.kind, q: q.q, http_status: status, ms, error, hits, rerank});
  console.log(`${q.id}  ${error ? '오류: ' + error : 'ok'}  ${ms}ms  ${hits.length}건${rerank ? `  리랭크 ${rerank.reranked ? '적용' : '생략(' + rerank.reason + ')'} ${rerank.ms}ms` : ''}`);
}

const after = await snapshot();
const stable = JSON.stringify(before) === JSON.stringify(after);
const out = {
  protocol: 'feature-coverage-v1', variant: process.env.EVAL_RERANK === '1' ? 'production-rerank' : 'production-vector',
  config_version: cfg.version, started, completed: new Date().toISOString(),
  base: cfg.base, ids: cfg.ids, auto_sample: cfg.auto_sample, k_request: cfg.k_request, k_score: cfg.k_score,
  code: commit, corpus_stable: stable,
  corpus: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, {revision: v.revision, status: v.status, chunks: v.chunks,
    missing_embedding: v.missing_embedding, transcript_sha256: v.transcript_sha256, embedding_sha256: v.embedding_sha256}])),
  records,
};
mkdirSync(new URL('./runs/', import.meta.url), {recursive: true});
const file = new URL(`./runs/${started.replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`\n데이터 유지: ${stable}  저장: ${fileURLToPath(file)}`);
if (!stable) { console.error('실행 중 데이터가 바뀌었습니다. 이 결과는 비교에 쓰지 않습니다.'); process.exitCode = 1; }
