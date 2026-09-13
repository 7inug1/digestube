/** 주제 기반 청킹 결과의 의미 오류 검토 초안.
 *
 *    node --env-file=.env.local --import tsx scripts/review-topic-chunking.ts [실행폴더]
 *
 *  코드가 검사하는 것(원문·시각·순서·번호)은 compare-topic-chunking.ts 가 이미 봤다.
 *  여기서는 코드가 볼 수 없는 것 — 같은 논점을 쪼갰는지, 다른 논점을 섞었는지,
 *  문장 중간에서 잘랐는지 — 만 본다.
 *
 *  이것은 초안이다. 판정이 아니다.
 *  - 검토자와 후보가 같은 계열 모델이면 자기 답을 후하게 볼 수 있다. 파일에 그 사실을 적는다.
 *  - 최종 판단은 사람이 한다. notes/27-topic-chunking-plan.md 의 규칙 그대로다.
 */
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import type {Chunk} from '../src/lib/chunker';

const OUT = 'data/evals/chunking/topic';
const REVIEWER = 'gemini-3.8-flash';

const PROMPT = `아래는 영상 전사를 문단으로 나눈 결과다. 나눈 자리가 의미상 옳은지 본다.

찾을 것
- 초과 분할: 같은 논점의 설명이나 사례가 서로 다른 문단으로 갈라진 자리.
- 누락 경계: 서로 다른 논점이 한 문단에 섞인 자리.
- 미완성 문장 분할: 문장이 끝나지 않았는데 문단이 바뀐 자리.

규칙
- 문단 내용을 고쳐 쓰지 않는다. 자리만 지적한다.
- 확실하지 않으면 적지 않는다. 억지로 개수를 채우지 않는다.
- 문제가 없으면 빈 배열을 반환한다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"findings":[{"between":"3→4","type":"초과 분할","why":"한 문장으로 이유를 적는다"}]}

문단:
{body}`;

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY 가 없다');
  return k;
}

async function ask(prompt: string) {
  const k = key();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${REVIEWER}:generateContent?key=${k}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {maxOutputTokens: 4000, temperature: 0},
    }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${body.slice(0, 300).replaceAll(k, '***')}`);
  const d = JSON.parse(body) as {
    candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[];
    usageMetadata?: {promptTokenCount?: number; candidatesTokenCount?: number};
  };
  const c = d.candidates?.[0];
  if (c?.finishReason && c.finishReason !== 'STOP') throw new Error(`응답이 끝까지 오지 않았다 (${c.finishReason})`);
  return {raw: c?.content?.parts?.map(p => p.text ?? '').join('') ?? '', usage: d.usageMetadata};
}

type Finding = {between: string; type: string; why: string};

function read(raw: string): Finding[] {
  const body = raw.replace(/^[\s\S]*?```(?:json)?/u, '').replace(/```[\s\S]*$/u, '').trim() || raw.trim();
  const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as {findings?: unknown};
  return Array.isArray(parsed.findings) ? parsed.findings as Finding[] : [];
}

async function main() {
  const dir = process.argv[2] ?? `${OUT}/${readdirSync(OUT).sort().at(-1)}`;
  const run = JSON.parse(readFileSync(`${dir}/run.json`, 'utf8')) as {results: {key: string; error: string | null}[]};

  // 이미 받아둔 검토는 그대로 둔다. 재시도가 성공분을 덮어쓰면 호출을 두 번 쓰고도 기록이 준다.
  const prior = await readFile(`${dir}/review.json`, 'utf8')
    .then(s => (JSON.parse(s) as {reviews?: Record<string, {findings?: unknown}>}).reviews ?? {})
    .catch(() => ({} as Record<string, {findings?: unknown}>));

  const reviews: Record<string, unknown> = {};
  for (const r of run.results) {
    if (prior[r.key]?.findings) { reviews[r.key] = prior[r.key]; console.log(`${r.key.padEnd(7)} 이전 결과 유지`); continue; }
    if (r.error) { reviews[r.key] = {skipped: `후보 실행이 실패해 검토할 문단이 없다 — ${r.error}`}; continue; }
    const rec = JSON.parse(readFileSync(`${dir}/${r.key}.json`, 'utf8')) as {model: string; chunks: Chunk[]};
    const body = rec.chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
    const prompt = PROMPT.replace('{body}', body);
    try {
      const {raw, usage} = await ask(prompt);
      reviews[r.key] = {model: rec.model, findings: read(raw), raw, usage};
      console.log(`${r.key.padEnd(7)} 지적 ${read(raw).length}건`);
    } catch (e) {
      reviews[r.key] = {model: rec.model, error: (e as Error).message};
      console.log(`${r.key.padEnd(7)} 검토 실패 — ${(e as Error).message.slice(0, 80)}`);
    }
  }

  writeFileSync(`${dir}/review.json`, JSON.stringify({
    note: '초안이다. 판정이 아니다. 최종 검수는 사람이 한다.',
    caveat: `검토자(${REVIEWER})가 후보 중 하나와 같은 모델이다. 자기 답에 후할 수 있다.`,
    reviewer: REVIEWER, prompt: PROMPT, reviewedAt: new Date().toISOString(), reviews,
  }, null, 2));
  console.log(`\n저장: ${dir}/review.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
