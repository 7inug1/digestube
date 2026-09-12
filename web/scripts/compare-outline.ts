/** 4번 자리(목차) 재실행 — 통과 기준은 notes/23-outline-rerun.md 에 실행 전에 적었다.
 *
 *   node --env-file=.env.local --import tsx scripts/compare-outline.ts
 *
 *  온도를 아무 후보에도 주지 않는다(1차의 조건 차이를 없앤다).
 *  운영 DB 는 읽기만 한다. 결과는 data/evals/outline-rerun/ 에만 쓴다.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {db} from '../src/lib/supabase';

const RUNS = 2;
const SAMPLE = 30;
const MAXLEN = 25;
const GAP_MS = 1200;

const PROMPT = `다음은 영상 전사에서 잘라낸 문단이다. 목차에 걸 제목을 하나 만들어라.

규칙
- 제목은 한국어로 25자 이내.
- quote 는 이 문단에 **글자 그대로 들어 있는** 문장 하나를 옮긴다. 지어내지 않는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"label": "제목", "quote": "원문에 그대로 있는 문장"}

문단:
{text}`;

const CANDIDATES = [
  {name: 'Claude Sonnet 5', vendor: 'anthropic', model: 'claude-sonnet-5'},
  {name: 'Claude Haiku 4.5', vendor: 'anthropic', model: 'claude-haiku-4-5-20251001'},
  {name: 'qwen3.8-27b', vendor: 'groq', model: 'qwen/qwen3.8-27b'},
] as const;

const DROP = /[\s.,!?…·"'“”‘’()\[\]{}~\-—]+/gu;
const norm = (s: string) => (s ?? '').replace(DROP, '');
const holds = (quote: string, source: string) => { const q = norm(quote); return Boolean(q) && norm(source).includes(q); };
const sleep = (ms: number) => new Promise(s => setTimeout(s, ms));

function parseJson(text: string) {
  const m = /\{[\s\S]*\}/u.exec(text ?? '');
  if (!m) throw new Error('JSON 아님');
  return JSON.parse(m[0]) as {label?: unknown; quote?: unknown};
}

async function anthropic(model: string, prompt: string) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
    body: JSON.stringify({model, max_tokens: 300, messages: [{role: 'user', content: prompt}]}),
  });
  const d = await r.json() as {content?: {text?: string}[]; usage?: {output_tokens?: number}};
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return {text: (d.content ?? []).map(b => b.text ?? '').join(''), out: d.usage?.output_tokens ?? 0};
}

async function groq(model: string, prompt: string): Promise<{text: string; out: number}> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json'},
    body: JSON.stringify({model, max_tokens: 800, messages: [{role: 'user', content: prompt}]}),
  });
  if (r.status === 429) { // 무료 한도다. 실력과 무관하므로 기다렸다 다시 부른다.
    await sleep(Math.min(Number(r.headers.get('retry-after') ?? 8) * 1000, 30000));
    return groq(model, prompt);
  }
  const d = await r.json() as {choices?: {message?: {content?: string}}[]; usage?: {completion_tokens?: number}};
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(d).slice(0, 120)}`);
  return {text: d.choices?.[0]?.message?.content ?? '', out: d.usage?.completion_tokens ?? 0};
}

const callers = {anthropic, groq};

type Row = {video_id: string; seq: number; run: number; ms?: number; out?: number; label?: string; quote?: string;
  json_ok?: boolean; len_ok?: boolean; quote_ok?: boolean; pass?: boolean; error?: string};

async function main() {
  const got = await db().from('chunk').select('video_id,seq,text').order('video_id').order('seq');
  if (got.error) throw got.error;
  const chunks = got.data ?? [];

  // 영상별로 고르게 뽑는다. 출력 품질을 보기 전에 입력을 고정한다.
  const byVideo = new Map<string, typeof chunks>();
  for (const c of chunks) { const list = byVideo.get(c.video_id) ?? []; list.push(c); byVideo.set(c.video_id, list); }
  const videos = [...byVideo.keys()].sort();
  const per = Math.max(1, Math.round(SAMPLE / videos.length));
  const sample: typeof chunks = [];
  for (const v of videos) {
    const list = byVideo.get(v)!;
    for (let i = 0; i < per && sample.length < SAMPLE; i++) {
      const pick = list[Math.floor((list.length - 1) * (per === 1 ? 0.5 : i / (per - 1)))];
      if (pick && !sample.includes(pick)) sample.push(pick);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = `data/evals/outline-rerun/${stamp}`;
  mkdirSync(dir, {recursive: true});
  writeFileSync(`${dir}/manifest.json`, JSON.stringify({
    created_at: new Date().toISOString(), card: 'notes/23-outline-rerun.md',
    settings: {runs: RUNS, temperature: 'omitted for all candidates', anthropic_max_tokens: 300, groq_max_tokens: 800, maxlen: MAXLEN},
    candidates: CANDIDATES, inputs: sample,
  }, null, 2));
  console.log(`문단 ${sample.length}개 · 후보 ${CANDIDATES.length}개 · ${RUNS}회씩`);

  const summary: Record<string, unknown>[] = [];
  for (const c of CANDIDATES) {
    const rows: Row[] = [];
    for (const ch of sample) {
      for (let run = 0; run < RUNS; run++) {
        const rec: Row = {video_id: ch.video_id, seq: ch.seq, run};
        const s = Date.now();
        try {
          const {text, out} = await callers[c.vendor](c.model, PROMPT.replace('{text}', ch.text));
          rec.ms = Date.now() - s; rec.out = out;
          const parsed = parseJson(text);
          rec.label = String(parsed.label ?? '').trim();
          rec.quote = String(parsed.quote ?? '').trim();
          rec.json_ok = true;
          rec.len_ok = rec.label.length > 0 && rec.label.length <= MAXLEN;
          rec.quote_ok = holds(rec.quote, ch.text);
          rec.pass = rec.len_ok && rec.quote_ok;
        } catch (e) { rec.error = (e as Error).message; rec.pass = false; }
        rows.push(rec);
        await sleep(GAP_MS);
      }
    }
    const attempts = rows.length;
    const passed = rows.filter(r => r.pass).length;
    const errors = rows.filter(r => r.error).length;
    const times = rows.filter(r => r.ms).map(r => r.ms!);
    // 흔들림: 같은 문단 두 번의 제목이 다른 경우
    let wobble = 0;
    for (const ch of sample) {
      const [a, b] = rows.filter(r => r.video_id === ch.video_id && r.seq === ch.seq);
      if (a?.label && b?.label && a.label !== b.label) wobble++;
    }
    const stat = {
      name: c.name, model: c.model, attempts, passed,
      pass_rate: +(passed / attempts * 100).toFixed(1),
      errors, wobble, wobble_rate: +(wobble / sample.length * 100).toFixed(1),
      avg_ms: Math.round(times.reduce((x, y) => x + y, 0) / Math.max(1, times.length)),
      avg_out_tokens: Math.round(rows.reduce((x, r) => x + (r.out ?? 0), 0) / Math.max(1, attempts)),
    };
    summary.push(stat);
    writeFileSync(`${dir}/${c.model.replace(/[^\w.-]/g, '_')}.json`, JSON.stringify({candidate: c, rows}, null, 2));
    console.log(JSON.stringify(stat));
  }
  writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\n저장: ${dir}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
