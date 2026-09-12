/** Supadata mode=generate 를 끝까지 돌려 총 소요 시간을 잰다.
 *
 *  2026-09-08 에 잰 91.8초는 작업 번호(HTTP 202)를 받기까지의 시간이고,
 *  결과가 나올 때까지의 총 시간은 재지 않았다. 일꾼을 어디에 둘지가 이 숫자로
 *  갈린다: Supabase Edge Function 무료는 wall clock 150초, Vercel Hobby 는
 *  fluid compute 기준 300초다.
 *
 *  운영 DB 를 건드리지 않는다. 결과는 파일로만 남긴다.
 *
 *  사용법: node --env-file=.env.local --import tsx scripts/measure-generate.ts <videoId|url> [lang]
 */
import {writeFileSync, mkdirSync} from 'node:fs';

const BASE = 'https://api.supadata.ai/v1';
const POLL_MS = 3000;
const GIVE_UP_MS = 15 * 60 * 1000;

type Piece = {text: string; offset: number; duration: number};
type Body = {jobId?: string; status?: string; error?: unknown; lang?: string; content?: Piece[] | string};
type Call = {at: number; elapsed_ms: number; status: number; billable: string | null; body: Body};

function key(): string {
  const k = process.env.SUPADATA_API_KEY;
  if (!k) throw new Error('SUPADATA_API_KEY 가 없다');
  return k.trim();
}

async function call(path: string, params?: Record<string, string>): Promise<Call> {
  const k = key();
  const url = BASE + path + (params ? '?' + new URLSearchParams(params) : '');
  const at = Date.now();
  const r = await fetch(url, {headers: {'x-api-key': k}, cache: 'no-store', signal: AbortSignal.timeout(300000)});
  const text = await r.text();
  const elapsed_ms = Date.now() - at;
  // 키가 에러 응답에 그대로 돌아오는 경우가 있어 가린다.
  if (!r.ok) throw new Error(`Supadata ${r.status} (${elapsed_ms}ms): ${text.slice(0, 300).replaceAll(k, '***')}`);
  return {at, elapsed_ms, status: r.status, billable: r.headers.get('x-billable-requests'), body: JSON.parse(text) as Body};
}

function join(content: Body['content']): string {
  if (typeof content === 'string') return content;
  return (content ?? []).map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
}

/** 구두점이 실제로 붙어 나오는지. 전사문 품질 점수가 아니라 존재 여부 확인이다. */
function punctuation(text: string) {
  const ends = (text.match(/[.!?。？！]/gu) ?? []).length;
  const commas = (text.match(/[,、]/gu) ?? []).length;
  const screen = (text.match(/[[(][^\])]{0,40}[\])]/gu) ?? []).slice(0, 5);
  return {chars: text.length, sentence_marks: ends, comma_marks: commas, marks_per_100_chars: +(ends * 100 / Math.max(1, text.length)).toFixed(2), bracketed_samples: screen};
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('영상 id 나 주소를 인자로 준다');
  const videoUrl = arg.startsWith('http') ? arg : `https://www.youtube.com/watch?v=${arg}`;
  const lang = process.argv[3];

  const started = Date.now();
  const params: Record<string, string> = {url: videoUrl, mode: 'generate'};
  if (lang) params.lang = lang;

  console.log(`generate 시작: ${videoUrl}`);
  const start = await call('/transcript', params);
  console.log(`시작 응답 ${start.status} · ${(start.elapsed_ms / 1000).toFixed(1)}초 · billable=${start.billable ?? '없음'}`);

  const polls: Call[] = [];
  let body = start.body;
  if (body.jobId && !body.content) {
    console.log(`작업 번호 ${body.jobId} — 폴링 시작`);
    for (;;) {
      if (Date.now() - started > GIVE_UP_MS) throw new Error('15분 넘게 안 끝나 중단');
      await new Promise(s => setTimeout(s, POLL_MS));
      const p = await call(`/transcript/${body.jobId}`);
      polls.push(p);
      const status = p.body.status ?? (p.body.content ? 'completed' : 'unknown');
      process.stdout.write(`  ${((Date.now() - started) / 1000).toFixed(0)}초 → ${status}\n`);
      if (p.body.status === 'failed') throw new Error(`전사 실패: ${JSON.stringify(p.body.error)}`);
      if (p.body.status === 'completed' || p.body.content) { body = p.body; break; }
    }
  }

  const total_ms = Date.now() - started;
  const text = join(body.content);
  const out = {
    measured_at: new Date(started).toISOString(),
    video_url: videoUrl,
    requested_lang: lang ?? null,
    returned_lang: body.lang ?? null,
    start_call_ms: start.elapsed_ms,
    start_status: start.status,
    poll_count: polls.length,
    total_ms,
    total_sec: +(total_ms / 1000).toFixed(1),
    billable_headers: [start.billable, ...polls.map(p => p.billable)],
    fits: {supabase_edge_free_150s: total_ms <= 150000, vercel_hobby_fluid_300s: total_ms <= 300000},
    punctuation: punctuation(text),
    text_head: text.slice(0, 600),
    pieces: Array.isArray(body.content) ? body.content.length : null,
  };

  const dir = 'data/evals/generate-timing';
  mkdirSync(dir, {recursive: true});
  const file = `${dir}/${new Date(started).toISOString().replace(/[:.]/g, '-')}-${arg.replace(/[^\w-]/g, '_')}.json`;
  writeFileSync(file, JSON.stringify({...out, raw_content: body.content}, null, 2));

  console.log('\n' + JSON.stringify(out, null, 2));
  console.log(`\n저장: ${file}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
