/** 검색 정답지(골든셋) 초안을 만든다.
 *
 *    node --experimental-websocket --env-file=.env.local --import tsx scripts/make-goldenset.ts
 *
 *  구성은 실행 전에 정했다 — 30문항(답 있음 22 · 답 없음 8), dev 15 / test 15.
 *  dev 로 커트라인을 고르고 test 로 한 번만 확인한다. 같은 문항으로 고르고
 *  같은 문항으로 검증하면 그 숫자는 그 문항에만 맞는 값이 된다.
 *
 *  **이 파일이 만드는 것은 초안이다.** 질문은 모델이 쓰고, 인용문이 문단에
 *  글자 그대로 있는지만 코드가 대조한다. 질문이 자연스러운지, 정답 구간이
 *  맞는지, "답 없음"이 정말 답이 없는지는 사람이 봐야 한다.
 *  운영 DB 는 읽기만 한다.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {listVideos, getVideo} from '../src/lib/store.supabase';
import {holds} from '../src/lib/verify';
import {meta} from '../src/lib/youtube';

const MODEL = 'claude-sonnet-5';
const OUT = 'data/evals/search';
const ANSWERABLE = 22;
const NO_ANSWER = 8;

const ASK_PROMPT = `아래는 영상 한 편의 전사문을 문단 표시 없이 이어 붙인 것이다. 이 영상에서만 답할 수 있는 질문을 {n}개 만든다.

규칙
- 실제 사람이 검색창에 칠 법한 말로 쓴다. 시험 문제처럼 쓰지 않는다.
- 문단에 쓰인 단어를 그대로 베끼지 않는다. 뜻은 같되 다른 말로 묻는다.
- quote 는 전사문에 **글자 그대로 들어 있는** 근거 문장 하나다. 지어내지 않는다.
- 서로 다른 내용을 묻는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"items":[{"question":"검색창에 칠 법한 질문","expected_answer":"한 문장으로 답","quote":"전사문에 그대로 있는 근거 문장"}]}

이어진 전사문:
{body}`;

const NONE_PROMPT = `아래는 어떤 서비스에 담긴 영상 {k}편의 주제다.

이 영상들에 **답이 없는** 질문을 {n}개 만든다. 검색이 "찾지 못했습니다"라고 답해야 하는 질문이다.

규칙
- 주제는 가까운데 내용은 없는 질문을 만든다. 전혀 딴 얘기(날씨·주식 시세)는 너무 쉬워서 쓸모가 없다.
- 예: 인간관계 영상이 있으면 "친구와 절교한 뒤 다시 연락하는 법" — 가깝지만 다룬 적 없는 것.
- 실제 사람이 칠 법한 말로 쓴다.
- 왜 답이 없다고 보는지 why 에 한 문장으로 적는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"items":[{"question":"질문","why":"이 영상들이 다루지 않는 이유"}]}

영상 주제:
{topics}`;

type Item = {question: string; expected_answer: string; quote: string};
type None_ = {question: string; why: string};

async function ask(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 가 없다');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
    body: JSON.stringify({model: MODEL, max_tokens: 4000, messages: [{role: 'user', content: prompt}]}),
    signal: AbortSignal.timeout(180000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${body.slice(0, 300)}`);
  const d = JSON.parse(body) as {content?: {type: string; text?: string}[]};
  return (d.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
}

function readJson<T>(raw: string, field: string): T[] {
  const body = raw.replace(/^[\s\S]*?```(?:json)?/u, '').replace(/```[\s\S]*$/u, '').trim() || raw.trim();
  const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as Record<string, unknown>;
  const items = parsed[field];
  if (!Array.isArray(items)) throw new Error(`${field} 가 배열이 아니다`);
  return items as T[];
}

async function main() {
  const videos = await listVideos();
  // 한 편씩 읽는다. 한꺼번에 부르면 Supabase 가 Gateway Timeout 을 돌려준다.
  const loaded = [];
  for (const v of videos) {
    const full = await getVideo(v.id);
    const m = await meta(v.id);
    loaded.push({id: v.id, title: m?.title ?? v.title ?? v.id, lang: v.lang ?? null,
                 revision: v.revision ?? null, chunks: full?.chunks ?? [],
                 outline: (full?.outline ?? []).map(o => o.label)});
  }
  const corpus = loaded.filter(v => v.chunks.length > 0);
  console.log(`코퍼스 ${corpus.length}편 · 문단 ${corpus.reduce((n, v) => n + v.chunks.length, 0)}개\n`);

  // 답 있는 질문 — 영상마다 나눠 만든다. 한 편에서 몰아 뽑으면 질문끼리 겹친다.
  const per = Math.ceil(ANSWERABLE / corpus.length);
  const answerable: (Item & {seq: number; video_id: string; t: number; t_end: number})[] = [];
  for (const v of corpus) {
    // 모델에 현재 청크 경계를 노출하지 않는다. 질문이 특정 청킹에 맞춰지는 것을 줄인다.
    const body = v.chunks.map(c => c.text).join(' ');
    const prompt = ASK_PROMPT.replace('{n}', String(per)).replace('{body}', body);
    try {
      const items = readJson<Item>(await ask(prompt), 'items');
      let kept = 0;
      for (const it of items) {
        // 질문을 만든 뒤 인용문으로 정답 시간 구간을 찾는다. 현재 청크 번호는 입력하지 않는다.
        const c = v.chunks.find(chunk => holds(it.quote, chunk.text));
        if (!c) continue;
        answerable.push({...it, seq: c.seq, video_id: v.id, t: c.t, t_end: c.t_end});
        kept += 1;
      }
      console.log(`${v.id.padEnd(13)} ${kept}/${items.length}개 (인용 대조 통과)  ${v.title.slice(0, 30)}`);
    } catch (e) {
      console.log(`${v.id.padEnd(13)} 실패 — ${(e as Error).message.slice(0, 70)}`);
    }
  }

  // 답 없는 질문 — 주제만 주고 만든다. 문단을 보여주면 그 안에서 답을 찾아버린다.
  const topics = corpus.map(v => `- ${v.title}: ${v.outline.slice(0, 4).join(' / ')}`).join('\n');
  let none: None_[] = [];
  try {
    none = readJson<None_>(await ask(NONE_PROMPT
      .replace('{k}', String(corpus.length)).replace('{n}', String(NO_ANSWER)).replace('{topics}', topics)), 'items');
    console.log(`\n답 없음 ${none.length}개 생성`);
  } catch (e) {
    console.log(`\n답 없음 생성 실패 — ${(e as Error).message.slice(0, 70)}`);
  }

  // dev / test 를 번갈아 넣어 두 쪽의 난이도와 구성이 쏠리지 않게 한다.
  const picked = answerable.slice(0, ANSWERABLE);
  const questions = [
    ...picked.map((q, i) => ({
      id: `Q${String(i + 1).padStart(2, '0')}`,
      question: q.question, category: 'answerable' as const,
      split: i % 2 === 0 ? 'dev' : 'test',
      author: 'AI', review_status: 'draft',
      expected_answer: q.expected_answer,
      targets: [{video_id: q.video_id, start: q.t, end: q.t_end, quote: q.quote, seq: q.seq}],
    })),
    ...none.slice(0, NO_ANSWER).map((q, i) => ({
      id: `N${String(i + 1).padStart(2, '0')}`,
      question: q.question, category: 'no_answer' as const,
      split: i % 2 === 0 ? 'dev' : 'test',
      author: 'AI', review_status: 'draft',
      expected_answer: null, why: q.why, targets: [],
    })),
  ];

  mkdirSync(OUT, {recursive: true});
  const stamp = new Date().toISOString();
  writeFileSync(`${OUT}/questions.draft.v2.json`, JSON.stringify({
    version: `draft-v2-${stamp}`,
    status: 'draft',
    note: '사람 검수 전이다. review_status 가 전부 draft 다.',
    design: {answerable: ANSWERABLE, no_answer: NO_ANSWER, split: 'dev 15 / test 15',
             rule: 'dev 로 커트라인을 고르고 test 로 한 번만 확인한다'},
    question_language: 'ko',
    generator: {model: MODEL, verified_by_code: '인용문이 해당 문단에 글자 그대로 있는지 대조'},
    corpus: corpus.map(v => ({video_id: v.id, title: v.title, lang: v.lang,
                              revision: v.revision, chunks: v.chunks.length})),
    questions, exported_at: stamp,
  }, null, 2));

  // 사람이 읽고 판단할 목록. JSON 을 눈으로 읽게 하지 않는다.
  const byId = new Map(corpus.map(v => [v.id, v]));
  const lines = ['# 검색 정답지 초안 v2 — 검수용', '',
    `문항 ${questions.length}개 (답 있음 ${picked.length} · 답 없음 ${none.slice(0, NO_ANSWER).length})`,
    `코퍼스 ${corpus.length}편 · 문단 ${corpus.reduce((n, v) => n + v.chunks.length, 0)}개`, '',
    '각 문항에서 볼 것: ① 질문이 사람 말 같은가 ② 정답 문단이 실제로 답인가 ③ 답 없음이 정말 없는가', '',
    '---', ''];
  for (const q of questions) {
    lines.push(`## ${q.id} · ${q.split} · ${q.category}`, '', `**${q.question}**`, '');
    if (q.category === 'answerable') {
      const t = q.targets[0];
      const v = byId.get(t.video_id)!;
      const chunk = v.chunks.find(c => c.seq === t.seq);
      lines.push(`기대 답: ${q.expected_answer}`, '',
        `정답 문단 — ${v.title} · ${Math.floor(t.start / 60)}:${String(Math.floor(t.start % 60)).padStart(2, '0')}`, '',
        '> ' + (chunk?.text ?? '').replace(/\n/g, ' '), '');
    } else {
      lines.push(`없다고 본 이유: ${(q as {why?: string}).why ?? ''}`, '');
    }
    lines.push('판정: ☐ 통과  ☐ 수정  ☐ 버림', '', '---', '');
  }
  writeFileSync(`${OUT}/questions.draft.v2.review.md`, lines.join('\n'));

  console.log(`\n총 ${questions.length}문항 (답 있음 ${picked.length} · 답 없음 ${none.slice(0, NO_ANSWER).length})`);
  console.log(`저장: ${OUT}/questions.draft.v2.json`);
  console.log(`검수용: ${OUT}/questions.draft.v2.review.md`);
}

main().catch(e => { console.error(e); process.exit(1); });
