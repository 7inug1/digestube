/** 3번 자리(문단 나누기) 비교 — 기준은 notes/24-chunking-rerun.md 에 실행 전에 적었다.
 *
 *   node --env-file=.env.local --import tsx scripts/compare-chunking.ts
 *
 *  Gemini 전사문에 세 조건을 돌린다. 운영 DB 는 읽기만 한다.
 */
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {chunk, stats, TARGET, MAXLEN, PAUSE_SEC, type Piece} from '../src/lib/chunker';
import {db} from '../src/lib/supabase';

const EVALS = 'data/evals/transcription';

function seconds(v: string): number {
  const p = v.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

/** C 조건: 문장 경계를 무시하고 목표 길이마다 자른다. v2 초기 동작의 재현이다. */
function byLength(pieces: Piece[], target = TARGET) {
  const out: {t: number; t_end: number; text: string}[] = [];
  let buf = "", t = (pieces[0]?.offset ?? 0) / 1000, end = t;
  for (const p of pieces) {
    const value = p.text.replace(/\s+/gu, ' ').trim();
    if (!value) continue;
    if (!buf) t = p.offset / 1000;
    buf = buf ? `${buf} ${value}` : value;
    end = (p.offset + p.duration) / 1000;
    while (buf.length >= target) {
      out.push({t, t_end: end, text: buf.slice(0, target).trim()});
      buf = buf.slice(target).trim();
      t = end;
    }
  }
  if (buf) out.push({t, t_end: end, text: buf});
  return out;
}

async function main() {
  // 평가 때 만든 Gemini 전사(6편)
  const sources = new Map<string, Piece[]>();
  for (const d of readdirSync(EVALS).sort()) {
    const j = JSON.parse(readFileSync(`${EVALS}/${d}/gemini.json`, 'utf8')) as
      {model: string; segments: {start: string; end: string; text: string}[]};
    if (j.model !== 'gemini-3.5-flash') continue;
    const vid = d.split('-').at(-1)!;
    const pieces = j.segments.map(s => {
      const st = seconds(s.start), en = Math.max(st, seconds(s.end) || st);
      return {text: s.text, offset: Math.round(st * 1000), duration: Math.round((en - st) * 1000)};
    });
    sources.set(vid, pieces); // 같은 영상이 여러 번이면 마지막 실행을 쓴다
  }
  // 배포로 넣은 신규 2편은 DB 에 원본 조각이 저장돼 있다
  const got = await db().from('video').select('id,mode,raw').eq('mode', 'gemini');
  if (got.error) throw got.error;
  for (const v of got.data ?? []) {
    if (Array.isArray(v.raw) && v.raw.length && !sources.has(v.id)) sources.set(v.id, v.raw as Piece[]);
  }

  const conditions = {
    'A 문장경계': (p: Piece[]) => chunk(p),
    'B 문장경계+무음': (p: Piece[]) => chunk(p, TARGET, MAXLEN, PAUSE_SEC),
    'C 길이분할': (p: Piece[]) => byLength(p),
  };

  const rows: Record<string, unknown>[] = [];
  for (const [name, run] of Object.entries(conditions)) {
    let chunks = 0, ends = 0, lens: number[] = [];
    const perVideo: Record<string, unknown> = {};
    for (const [vid, pieces] of sources) {
      const out = run(pieces);
      const s = stats(out);
      chunks += out.length;
      ends += out.length - (s.cut ?? 0);
      lens = lens.concat(out.map(c => c.text.length));
      perVideo[vid] = {n: s.n, sentence_end: `${out.length - (s.cut ?? 0)}/${out.length}`, avg: s.avg, min: s.min, max: s.max};
    }
    rows.push({
      condition: name, videos: sources.size, chunks,
      sentence_end_pct: +(ends / chunks * 100).toFixed(1),
      avg_len: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length),
      min_len: Math.min(...lens), max_len: Math.max(...lens),
      spread: Math.max(...lens) - Math.min(...lens),
      per_video: perVideo,
    });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = `data/evals/chunking-rerun/${stamp}`;
  mkdirSync(dir, {recursive: true});
  writeFileSync(`${dir}/summary.json`, JSON.stringify({card: 'notes/24-chunking-rerun.md', settings: {TARGET, MAXLEN, PAUSE_SEC}, videos: [...sources.keys()], rows}, null, 2));
  for (const r of rows) console.log(JSON.stringify({...r, per_video: undefined}));
  console.log(`\n저장: ${dir}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
