/** Gemini 로 유튜브 영상을 직접 전사해 기존 native 자막과 대조한다.
 *
 *  목적은 2번 자리(전사) 후보 평가다. 채택 결정이 아니라 기준선 측정이다.
 *  운영 DB 는 읽기만 한다. 결과는 data/evals/transcription/ 아래에만 쓴다.
 *
 *  사용법:
 *    node --env-file=.env.local --import tsx scripts/eval-gemini-transcript.ts <videoId> [model]
 *    node --env-file=.env.local --import tsx scripts/eval-gemini-transcript.ts --models
 */
import {writeFileSync, mkdirSync} from 'node:fs';
import {db} from '../src/lib/supabase';

const API = 'https://generativelanguage.googleapis.com/v1beta';

const PROMPT = `이 영상의 음성을 그대로 받아쓴다.

규칙
- 들리는 말을 빠짐없이 옮긴다. 요약하거나 생략하지 않는다.
- 한국어 구두점을 정상적으로 찍는다.
- 화면에 뜬 글자는 옮기지 않는다. 음성만 옮긴다.
- 발화 단위로 끊고 각 단위의 시작·끝 시각을 MM:SS 로 적는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"segments":[{"start":"MM:SS","end":"MM:SS","text":"받아쓴 말"}]}`;

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY 가 없다');
  return k.trim();
}

async function listModels() {
  const r = await fetch(`${API}/models?key=${key()}`);
  const d = await r.json() as {models?: {name: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number}[]};
  for (const m of d.models ?? []) {
    if (m.supportedGenerationMethods?.includes('generateContent')) console.log(m.name, m.inputTokenLimit ?? '');
  }
}

type Seg = {start: string; end: string; text: string};
type Usage = {promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number};

function seconds(mmss: string): number | null {
  const p = mmss.trim().split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
}

/** 비교 대상인 native 자막도 정답이 아니다. 화면 자막이 섞여 있고 번역본일 수 있다.
 *  그래서 일치율은 '두 전사문이 얼마나 다른가'이지 정확도 점수가 아니다. */
function words(text: string): string[] {
  return text.replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().split(/\s+/u).filter(Boolean);
}

function overlap(a: string[], b: string[]) {
  const bag = new Map<string, number>();
  for (const w of b) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of a) { const n = bag.get(w) ?? 0; if (n > 0) { hit++; bag.set(w, n - 1); } }
  return {shared: hit, only_in_a: a.length - hit};
}

/** 세그먼트가 영상의 제자리에 붙는지. 기존 자막의 시각을 기준선으로 삼아
 *  같은 말이 나오는 지점의 시각 차이를 본다. 두 전사문의 표기가 달라 못 찾는 구간이
 *  생기므로, 찾은 비율(coverage)도 함께 적는다. native 시각 자체도 자막 단위라 거칠다. */
function normalize(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '');
}

function timeline(chunks: {t: number; t_end: number; text: string}[]) {
  let norm = '';
  const at: number[] = [];
  for (const c of chunks) {
    const n = normalize(c.text);
    for (let i = 0; i < n.length; i++) at.push(c.t + (c.t_end - c.t) * (i / Math.max(1, n.length)));
    norm += n;
  }
  return {norm, at};
}

function alignment(segments: Seg[], chunks: {t: number; t_end: number; text: string}[]) {
  const {norm, at} = timeline(chunks);
  const diffs: number[] = [];
  let matched = 0, from = 0;
  for (const s of segments) {
    const start = seconds(s.start);
    const probe = normalize(s.text).slice(0, 10);
    if (start === null || probe.length < 10) continue;
    // 앞에서부터 순서대로 찾는다. 같은 말이 여러 번 나와도 진행 방향을 지킨다.
    let i = norm.indexOf(probe, from);
    if (i < 0) i = norm.indexOf(probe);
    if (i < 0) continue;
    from = i + probe.length;
    matched++;
    diffs.push(Math.abs(start - at[i]));
  }
  diffs.sort((a, b) => a - b);
  const pick = (q: number) => diffs.length ? +diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * q))].toFixed(1) : null;
  return {
    comparable: segments.length,
    matched,
    coverage: segments.length ? +(matched / segments.length).toFixed(2) : 0,
    median_gap_sec: pick(0.5),
    p90_gap_sec: pick(0.9),
  };
}

async function main() {
  if (process.argv[2] === '--models') return listModels();
  const vid = process.argv[2];
  if (!vid) throw new Error('영상 id 를 인자로 준다');
  const model = process.argv[3] ?? 'gemini-3-pro-preview';
  const url = `https://www.youtube.com/watch?v=${vid}`;

  // 기존 전사문(운영 DB, 읽기 전용)
  const got = await db().from('chunk').select('seq,t,t_end,text').eq('video_id', vid).order('seq');
  if (got.error) throw got.error;
  const native = (got.data ?? []).map(c => c.text).join(' ').replace(/\s+/gu, ' ').trim();
  if (!native) throw new Error(`${vid} 의 기존 문단이 DB 에 없다`);

  const started = Date.now();
  const r = await fetch(`${API}/models/${model}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text: PROMPT}, {fileData: {fileUri: url}}]}],
      generationConfig: {responseMimeType: 'application/json', maxOutputTokens: 65536, temperature: 0},
    }),
    signal: AbortSignal.timeout(900000),
  });
  const body = await r.text();
  const elapsed_ms = Date.now() - started;
  if (!r.ok) throw new Error(`Gemini ${r.status} (${elapsed_ms}ms): ${body.slice(0, 500).replaceAll(key(), '***')}`);

  const d = JSON.parse(body) as {candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[]; usageMetadata?: Usage};
  const raw = d.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  let segments: Seg[] = [];
  try { segments = (JSON.parse(raw) as {segments?: Seg[]}).segments ?? []; } catch { /* 원문은 아래에 저장한다 */ }

  const text = segments.map(s => s.text).join(' ').replace(/\s+/gu, ' ').trim();
  const g = words(text), n = words(native);
  const vsNative = overlap(g, n);
  const vsGemini = overlap(n, g);

  const secs = segments.map(s => ({start: seconds(s.start), end: seconds(s.end)}));
  const bad = secs.filter(s => s.start === null || s.end === null).length;
  const outOfOrder = secs.filter((s, i) => i > 0 && s.start !== null && secs[i - 1].start !== null && s.start < secs[i - 1].start!).length;
  const lastEnd = secs.at(-1)?.end ?? null;
  const nativeEnd = Math.max(...(got.data ?? []).map(c => c.t_end));

  // 통과 기준은 notes/22-transcription-gemini.md 에 측정 전에 적어 고정했다.
  const speaker_marks = (text.match(/>>/gu) ?? []).length;
  const bracket_marks = (text.match(/\[[^\]]{0,40}\]/gu) ?? []).length;
  const align = alignment(segments, got.data ?? []);
  const criteria = {
    A_run: d.candidates?.[0]?.finishReason === 'STOP',
    B_sentence_marks: (text.match(/[.!?。？！]/gu) ?? []).length > 0,
    C_timestamp_parse: bad === 0 && outOfOrder === 0,
    // D 교체(2026-09-12): 끝시각 비교는 '음악 자막이 뒤에 붙었나'를 재고 있었다.
    // 사유는 notes/22-transcription-gemini.md 에 적었다.
    D_alignment: align.coverage >= 0.5 && align.median_gap_sec !== null && align.median_gap_sec <= 5,
    E_not_truncated: text.length >= native.length * 0.85,
    F_no_contamination: speaker_marks === 0 && bracket_marks === 0,
    G_time_under_25pct: elapsed_ms / 1000 <= nativeEnd * 0.25,
  };

  const out = {
    measured_at: new Date(started).toISOString(),
    video_id: vid, model, url,
    elapsed_ms, elapsed_sec: +(elapsed_ms / 1000).toFixed(1),
    finish_reason: d.candidates?.[0]?.finishReason ?? null,
    usage: d.usageMetadata ?? null,
    segments: segments.length,
    chars: {gemini: text.length, native: native.length},
    punctuation: {
      gemini_sentence_marks: (text.match(/[.!?。？！]/gu) ?? []).length,
      native_sentence_marks: (native.match(/[.!?。？！]/gu) ?? []).length,
    },
    // 화면 자막 혼입 흔적. native 쪽에만 나오면 Gemini 가 음성만 옮겼다는 근거가 된다.
    bracketed: {
      gemini: (text.match(/[[(][^\])]{0,40}[\])]/gu) ?? []).slice(0, 5),
      native: (native.match(/[[(][^\])]{0,40}[\])]/gu) ?? []).slice(0, 5),
    },
    word_overlap: {
      gemini_words: g.length, native_words: n.length,
      shared: vsNative.shared,
      only_in_gemini: vsNative.only_in_a,
      only_in_native: vsGemini.only_in_a,
    },
    criteria,
    criteria_passed: Object.values(criteria).every(Boolean),
    contamination: {speaker_marks, bracket_marks},
    alignment: align,
    timestamps: {
      unparsable: bad, out_of_order: outOfOrder,
      last_end_sec: lastEnd, native_last_end_sec: Math.round(nativeEnd),
      tail_gap_sec: lastEnd === null ? null : +(nativeEnd - lastEnd).toFixed(1),
    },
  };

  const dir = `data/evals/transcription/${new Date(started).toISOString().replace(/[:.]/g, '-')}-${vid}`;
  mkdirSync(dir, {recursive: true});
  writeFileSync(`${dir}/summary.json`, JSON.stringify(out, null, 2));
  writeFileSync(`${dir}/gemini.json`, JSON.stringify({prompt: PROMPT, model, segments, raw}, null, 2));
  writeFileSync(`${dir}/native.txt`, native);
  writeFileSync(`${dir}/gemini.txt`, text);

  console.log(JSON.stringify(out, null, 2));
  console.log(`\n저장: ${dir}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
