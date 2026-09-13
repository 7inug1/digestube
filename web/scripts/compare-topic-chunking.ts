/** 3번 자리(문단 나누기) — 주제 기반 청킹 준비 실험 1편.
 *  기준 문서는 notes/27-topic-chunking-plan.md 에 실행 전에 적었다.
 *
 *    node --env-file=.env.local --import tsx scripts/compare-topic-chunking.ts
 *
 *  운영 DB(Supabase)와 저장된 전사문은 건드리지 않는다. 읽기만 한다.
 *  결과는 data/evals/chunking/topic/<시각>-<영상>/ 아래에만 쓴다.
 *
 *  이번 1편은 준비 실험이다. 최종 모델 선정 근거로 쓰지 않는다.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {chunk, MAXLEN, type Chunk, type Piece} from '../src/lib/chunker';

const DIALOGUE = process.argv.includes('--dialogue');
const VIDEO = DIALOGUE ? 'byVgbqzYJrs' : 'JRJd1ZrHmgg';
/** 입력을 하나로 고정한다 — 전사문이 바뀌면 경계 비교가 성립하지 않는다. */
const SOURCE = DIALOGUE ? 'data/evals/chunking/dialogue-source.json' : 'data/evals/transcription/2026-09-13T05-35-40-595Z-JRJd1ZrHmgg/gemini.json';
const READABLE = process.argv.includes('--sonnet-readable');
const BALANCED = READABLE || process.argv.includes('--sonnet-balanced');
const REFINED = BALANCED || process.argv.includes('--sonnet-refined');
const OUT = READABLE ? 'data/evals/chunking/topic-readable' : DIALOGUE ? 'data/evals/chunking/topic-dialogue' : BALANCED ? 'data/evals/chunking/topic-balanced' : REFINED ? 'data/evals/chunking/topic-refined' : 'data/evals/chunking/topic';

/** 후보마다 1회. 온도는 0 으로 맞춘다 — 같은 입력에 같은 답이 나와야 다시 잴 수 있다.
 *
 *  단, Sonnet 5 는 temperature 를 받지 않는다(`temperature is deprecated for this model`).
 *  세 후보의 표집 설정을 똑같이 맞출 방법이 없어서, 받는 쪽만 0 으로 고정하고
 *  이 비대칭을 run.json 에 적는다. 숨기면 뒤에 오는 사람이 같은 값을 재현하지 못한다. */
const CANDIDATES = [
  {key: 'sonnet', provider: 'anthropic', model: 'claude-sonnet-5',  temperature: false},
  {key: 'haiku',  provider: 'anthropic', model: 'claude-haiku-4-5', temperature: true},
  {key: 'gemini', provider: 'gemini',    model: 'gemini-3.8-flash', temperature: true},
] as const;

const SAMPLING_NOTE =
  'Sonnet 5 는 temperature 를 받지 않아 기본값으로 돌았다. Haiku 4.5 와 Gemini 3.8 Flash 만 temperature=0 이다. ' +
  '같은 입력에 대한 재현성이 후보마다 다르다는 뜻이므로, 문단 수 차이를 모델 차이로만 읽지 않는다.';

/** 분할 지시. 세 후보에 글자 그대로 같은 문장을 쓴다 —
 *  후보마다 프롬프트를 다듬으면 나란히 놓고 잴 수 없다.
 *
 *  구조화 출력(json_schema / responseSchema)은 이번에 쓰지 않는다. 한쪽만 켜면
 *  형식 오류율이 달라져 비교가 흐려지고, 양쪽의 스키마 동작이 같다는 근거가 아직 없다.
 *  형식 실패는 그대로 기록해서 다음 회차의 판단 재료로 남긴다. */
const PROMPT = `아래는 영상 전사를 발화 단위로 끊어 번호를 붙인 것이다. 문단이 시작하는 자리를 고른다.

규칙
- 같은 논점의 설명과 사례는 한 문단에 묶는다.
- 새로운 논점으로 넘어가는 자리에서만 나눈다.
- 짧은 맞장구나 화자가 바뀌었다는 이유만으로는 나누지 않는다.
- 한 줄이 완성된 문장이라는 보장은 없다. 문장이 이어지는 중이면 그 사이에서 나누지 않는다.
- 원문을 다시 출력하지 않는다. 문단이 시작하는 줄 번호만 반환한다.
- 1번은 반드시 포함한다. 번호는 오름차순이고 중복이 없다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"starts":[1]}

전사:
{lines}`;

type Usage = {input?: number; output?: number; thoughts?: number};
type Record_ = {
  key: string; provider: string; model: string;
  config: Record<string, unknown>;
  prompt: string;
  raw: string | null;
  usage: Usage | null;
  ms: number;
  error: string | null;
  starts: number[] | null;
  chunks: Chunk[] | null;
  checks: Checks | null;
};

function seconds(v: string): number {
  const p = v.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

const squash = (s: string) => s.replace(/\s+/gu, '').trim();

/** 번호 붙이기. 모든 후보가 글자 그대로 같은 입력을 본다. 1부터 센다. */
function numbered(pieces: Piece[]): string {
  return pieces.map((p, i) => `${i + 1}\t${p.text.replace(/\s+/gu, ' ').trim()}`).join('\n');
}

/** 모델이 답을 코드펜스로 감싸거나 앞뒤에 말을 붙여도 같은 방식으로 읽는다.
 *  후보별로 다르게 관대하면 형식 실패율 비교가 무너진다. */
function readStarts(raw: string, n: number): number[] {
  const body = raw.replace(/^[\s\S]*?```(?:json)?/u, '').replace(/```[\s\S]*$/u, '').trim() || raw.trim();
  const slice = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  const parsed = JSON.parse(slice) as {starts?: unknown};
  if (!Array.isArray(parsed.starts)) throw new Error('starts 가 배열이 아니다');
  const out = parsed.starts.map(Number);
  if (out.some(v => !Number.isInteger(v))) throw new Error('starts 에 정수가 아닌 값이 있다');
  if (out.some(v => v < 1 || v > n)) throw new Error(`starts 에 1..${n} 밖의 번호가 있다`);
  if (out.some((v, i) => i > 0 && v <= out[i - 1])) throw new Error('starts 가 오름차순이 아니거나 중복이 있다');
  return out;
}

/** 긴 문단 보정. 모델이 준 경계 안에서만 자르고, 자르는 방법은 기존 청커를 그대로 쓴다.
 *  세 후보에 같은 값(MAXLEN)을 쓴다 — 후보마다 다르면 문단 수 비교가 무의미해진다. */
function build(pieces: Piece[], starts: number[]): Chunk[] {
  const heads = starts[0] === 1 ? starts : [1, ...starts];
  return heads.flatMap((s, i) =>
    chunk(pieces.slice(s - 1, (heads[i + 1] ?? pieces.length + 1) - 1), MAXLEN, MAXLEN));
}

type Checks = {
  textPreserved: boolean;
  orderOk: boolean;
  timesOk: boolean;
  chunkCount: number;
  overMax: number;
  lengths: {min: number; median: number; max: number};
  problems: string[];
};

/** 코드가 검사할 수 있는 것만 검사한다 — 원문·시각·순서·번호.
 *  의미상 옳은 경계인지는 여기서 판정하지 않는다. */
function verify(chunks: Chunk[], pieces: Piece[]): Checks {
  const problems: string[] = [];
  const textPreserved = squash(chunks.map(c => c.text).join('')) === squash(pieces.map(p => p.text).join(''));
  if (!textPreserved) problems.push('원문이 그대로 보존되지 않았다(누락·중복·변경).');

  const orderOk = chunks.every((c, i) => i === 0 || c.t >= chunks[i - 1].t);
  if (!orderOk) problems.push('문단 순서가 시간 순이 아니다.');

  const timesOk = chunks.every(c => Number.isFinite(c.t) && Number.isFinite(c.t_end) && c.t_end >= c.t);
  if (!timesOk) problems.push('시작·끝 시각이 뒤집혔거나 숫자가 아니다.');

  const lens = chunks.map(c => c.text.length).sort((a, b) => a - b);
  const overMax = lens.filter(n => n > MAXLEN).length;
  if (overMax) problems.push(`${MAXLEN}자를 넘는 문단 ${overMax}개.`);

  return {
    textPreserved, orderOk, timesOk,
    chunkCount: chunks.length, overMax,
    lengths: {min: lens[0] ?? 0, median: lens[lens.length >> 1] ?? 0, max: lens.at(-1) ?? 0},
    problems,
  };
}

async function askAnthropic(model: string, prompt: string, temperature: boolean) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 가 없다');
  const max_tokens = READABLE ? 16000 : REFINED ? 8000 : 2000;
  const config = temperature ? {model, max_tokens, temperature: 0} : {model, max_tokens};
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
    body: JSON.stringify({...config, messages: [{role: 'user', content: prompt}]}),
    signal: AbortSignal.timeout(120000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${body.slice(0, 300)}`);
  const d = JSON.parse(body) as {
    content?: {type: string; text?: string}[];
    usage?: {input_tokens?: number; output_tokens?: number};
    stop_reason?: string;
  };
  if (d.stop_reason && !['end_turn', 'stop_sequence'].includes(d.stop_reason)) {
    throw new Error(`응답이 끝까지 오지 않았다 (stop_reason=${d.stop_reason})`);
  }
  const raw = (d.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
  return {raw, config, usage: {input: d.usage?.input_tokens, output: d.usage?.output_tokens}};
}

async function askGemini(model: string, prompt: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 없다');
  const config = {model, maxOutputTokens: 2000, temperature: 0};
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {maxOutputTokens: config.maxOutputTokens, temperature: config.temperature},
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await r.text();
  // 키가 에러 본문에 그대로 돌아오는 경우가 있어 가린다.
  if (!r.ok) throw new Error(`${r.status}: ${body.slice(0, 300).replaceAll(key, '***')}`);
  const d = JSON.parse(body) as {
    candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[];
    usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number};
  };
  const c = d.candidates?.[0];
  if (c?.finishReason && c.finishReason !== 'STOP') throw new Error(`응답이 끝까지 오지 않았다 (${c.finishReason})`);
  const raw = c?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  return {raw, config, usage: {
    input: d.usageMetadata?.promptTokenCount,
    output: d.usageMetadata?.candidatesTokenCount,
    thoughts: d.usageMetadata?.thoughtsTokenCount,
  }};
}

async function main() {
  const src = JSON.parse(readFileSync(SOURCE, 'utf8')) as
    {model: string; segments: {start: string; end: string; text: string}[]};
  const pieces: Piece[] = src.segments.map(s => {
    const st = seconds(s.start), en = Math.max(st, seconds(s.end) || st);
    return {text: s.text, offset: Math.round(st * 1000), duration: Math.round((en - st) * 1000)};
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = `${OUT}/${stamp}-${VIDEO}`;
  mkdirSync(dir, {recursive: true});

  let instructions = REFINED ? PROMPT.replace(
    '- 같은 논점의 설명과 사례는 한 문단에 묶는다.\n- 새로운 논점으로 넘어가는 자리에서만 나눈다.',
    '- 새로운 논점으로 넘어가면 나눈다. 같은 큰 주제 안에서도 읽기 쉬운 세부 문단을 만든다.\n' +
    '- 첫째·둘째·셋째처럼 독립적으로 설명하는 나열 항목은 각각 별도 문단으로 나눈다.\n' +
    '- 같은 단계 안에서도 설명에서 구체적인 방법, 별도의 예시, 팁으로 역할이 바뀌면 문단을 나눈다.\n' +
    '- 단, 짧은 보충 설명을 무조건 분리하지 않는다. 각 문단은 앞뒤 문장을 함께 읽어 뜻이 완성되게 한다.'
  ) : PROMPT;
  if (BALANCED) instructions = PROMPT.replace(
    '- 같은 논점의 설명과 사례는 한 문단에 묶는다.\n- 새로운 논점으로 넘어가는 자리에서만 나눈다.',
    '- 기본은 같은 논점의 설명과 바로 이어지는 사례를 한 문단에 묶는 것이다. 새로운 논점으로 넘어가면 나눈다.\n' +
    '- 첫째·둘째·셋째 또는 단계처럼 각각 독립적으로 설명하는 나열 항목은 분리한다. 한 문장 안에서 목록을 언급하는 것만으로 나누지는 않는다.\n' +
    '- 설명에서 예시나 팁으로 바뀌었다는 이유만으로 분리하지 않는다. 설명·예시·짧은 보충은 함께 유지한다.\n' +
    '- 같은 항목이 길게 이어질 때만 세부 내용의 전환점에서 추가로 나눈다. 긴 항목은 가능하면 2~3개 문단으로 묶고, 모든 예시를 따로 떼지 않는다.\n' +
    '- 짧은 도입·연결·마무리 발화는 관련된 앞뒤 문단에 묶는다. 문단 수를 늘리는 것 자체가 목표가 아니다.'
  );
  if (READABLE) instructions = instructions.replace(
    '\n\n{"starts":[1]}',
    '\n- 한 문단은 280~360자 정도를 권장한다. 정확한 글자 수보다 의미가 자연스럽게 완결되는 위치를 우선하고, 필요하면 범위를 벗어나도 된다.\n' +
    '- 긴 주제는 설명의 초점이 바뀌는 위치에서 2~3개 문단으로 나누되, 예시 하나마다 기계적으로 분리하지 않는다.\n\n{"starts":[1]}'
  );
  const prompt = instructions.replace('{lines}', numbered(pieces));
  const records: Record_[] = [];

  // 기준선 — 지금 서비스가 쓰는 길이 기반 방식. 모델을 부르지 않는다.
  {
    const t0 = Date.now();
    const chunks = chunk(pieces);
    records.push({
      key: 'current', provider: 'local', model: '문장 경계 + 목표 340자/최대 700자',
      config: {target: 340, maxlen: MAXLEN}, prompt: '', raw: null, usage: null,
      ms: Date.now() - t0, error: null, starts: null, chunks, checks: verify(chunks, pieces),
    });
  }

  for (const c of CANDIDATES) {
    if (REFINED && c.key !== 'sonnet') continue;
    const t0 = Date.now();
    const rec: Record_ = {
      key: c.key, provider: c.provider, model: c.model, config: {}, prompt,
      raw: null, usage: null, ms: 0, error: null, starts: null, chunks: null, checks: null,
    };
    try {
      const {raw, config, usage} = c.provider === 'anthropic'
        ? await askAnthropic(c.model, prompt, c.temperature)
        : await askGemini(c.model, prompt);
      rec.raw = raw; rec.config = config; rec.usage = usage; rec.ms = Date.now() - t0;
      const starts = readStarts(raw, pieces.length);
      const chunks = build(pieces, starts);
      rec.starts = starts; rec.chunks = chunks; rec.checks = verify(chunks, pieces);
    } catch (e) {
      rec.ms = rec.ms || Date.now() - t0;
      rec.error = (e as Error).message;
    }
    records.push(rec);
    const mark = rec.error ? `실패 — ${rec.error.slice(0, 90)}` : `문단 ${rec.checks!.chunkCount}개`;
    console.log(`${c.key.padEnd(7)} ${c.model.padEnd(22)} ${String(rec.ms).padStart(6)}ms  ${mark}`);
  }

  for (const r of records) writeFileSync(`${dir}/${r.key}.json`, JSON.stringify(r, null, 2));
  writeFileSync(`${dir}/run.json`, JSON.stringify({
    note: '준비 실험 1편. 최종 모델 선정 근거로 쓰지 않는다.',
    samplingNote: SAMPLING_NOTE,
    video: VIDEO, source: SOURCE, transcriptModel: src.model, segments: pieces.length,
    ranAt: new Date().toISOString(), prompt,
    results: records.map(r => ({
      key: r.key, provider: r.provider, model: r.model, ms: r.ms, error: r.error,
      usage: r.usage, chunkCount: r.checks?.chunkCount ?? null, problems: r.checks?.problems ?? null,
    })),
  }, null, 2));
  console.log(`\n저장: ${dir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
