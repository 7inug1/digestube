/** 화면 글자를 같이 받아오면 출력·시간이 얼마나 느는가.
 *
 *   node --env-file=.env.local --import tsx scripts/eval-screen-text.ts <videoId...>
 *
 *  같은 모델·같은 영상에 프롬프트만 둘로 나눠 돌린다(A 음성만 / B 음성+화면).
 *  입력 토큰은 어차피 프레임을 보내므로 거의 같고, 늘어나는 쪽은 출력이다.
 *  운영 DB 는 건드리지 않는다.
 */
import {mkdirSync, writeFileSync} from 'node:fs';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'gemini-3.6-flash';

const BASE = `이 영상의 음성을 그대로 받아쓴다.

규칙
- 들리는 말을 빠짐없이 옮긴다. 요약하거나 생략하지 않는다.
- 구두점을 정상적으로 찍는다.
- 화면에 뜬 글자는 옮기지 않는다. 음성만 옮긴다.
- 발화 단위로 끊고 각 단위의 시작·끝 시각을 MM:SS 로 적는다.
- lang 은 음성의 언어를 ISO 639-1 두 글자로 적는다.
- JSON 하나만 출력한다. 설명을 붙이지 않는다.

{"lang":"ko","segments":[{"start":"MM:SS","end":"MM:SS","text":"받아쓴 말"}]}`;

const WITH_SCREEN = `${BASE.replace('{"lang":"ko","segments":[{"start":"MM:SS","end":"MM:SS","text":"받아쓴 말"}]}', '')}
- 화면에 **읽을 수 있는 글자**(슬라이드·자막·표지판·차트 숫자)가 있으면 screen 에 따로 적는다.
- 화면 글자는 segments 의 text 에 섞지 않는다.
- 읽을 글자가 없으면 screen 은 빈 배열로 둔다. 없는 것을 지어내지 않는다.
- has_screen_text 는 읽을 만한 화면 글자가 있었는지 true/false 로 적는다.

{"lang":"ko","has_screen_text":true,"segments":[{"start":"MM:SS","end":"MM:SS","text":"받아쓴 말"}],"screen":[{"start":"MM:SS","text":"화면에 뜬 글자"}]}`;

type Usage = {promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; thoughtsTokenCount?: number};

async function run(videoUrl: string, prompt: string) {
  const key = process.env.GEMINI_API_KEY!.trim();
  const started = Date.now();
  const r = await fetch(`${API}/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text: prompt}, {fileData: {fileUri: videoUrl}}]}],
      generationConfig: {responseMimeType: 'application/json', maxOutputTokens: 65536, temperature: 0},
    }),
    signal: AbortSignal.timeout(600000),
  });
  const body = await r.text();
  const elapsed = Date.now() - started;
  if (!r.ok) throw new Error(`${r.status} (${(elapsed / 1000).toFixed(1)}초): ${body.slice(0, 200).replaceAll(key, '***')}`);
  const d = JSON.parse(body) as {candidates?: {content?: {parts?: {text?: string}[]}; finishReason?: string}[]; usageMetadata?: Usage};
  const raw = d.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  let parsed: {segments?: {text: string}[]; screen?: {start: string; text: string}[]; has_screen_text?: boolean} = {};
  try { parsed = JSON.parse(raw); } catch { /* 원문을 남긴다 */ }
  return {elapsed, usage: d.usageMetadata ?? {}, finish: d.candidates?.[0]?.finishReason, parsed, raw};
}

async function main() {
  const vids = process.argv.slice(2).filter(a => !a.startsWith('--') && a !== MODEL);
  if (!vids.length) throw new Error('영상 id 를 인자로 준다');
  const out: Record<string, unknown>[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = `data/evals/screen-text/${stamp}`;
  mkdirSync(dir, {recursive: true});

  for (const vid of vids) {
    const url = `https://www.youtube.com/watch?v=${vid}`;
    const row: Record<string, unknown> = {video_id: vid, model: MODEL};
    for (const [name, prompt] of [['A 음성만', BASE], ['B 음성+화면', WITH_SCREEN]] as const) {
      const r = await run(url, prompt);
      const speech = (r.parsed.segments ?? []).map(s => s.text).join(' ');
      const screen = (r.parsed.screen ?? []).map(s => s.text).join(' ');
      row[name] = {
        sec: +(r.elapsed / 1000).toFixed(1),
        prompt_tokens: r.usage.promptTokenCount, output_tokens: r.usage.candidatesTokenCount,
        thoughts: r.usage.thoughtsTokenCount, total_tokens: r.usage.totalTokenCount,
        finish: r.finish, segments: (r.parsed.segments ?? []).length,
        speech_chars: speech.length,
        screen_items: (r.parsed.screen ?? []).length, screen_chars: screen.length,
        has_screen_text: r.parsed.has_screen_text ?? null,
        screen_sample: (r.parsed.screen ?? []).slice(0, 5).map(s => `${s.start} ${s.text}`),
      };
      writeFileSync(`${dir}/${vid}-${name.split(' ')[0]}.json`, JSON.stringify(r.parsed, null, 2));
    }
    out.push(row);
    console.log(JSON.stringify(row, null, 1));
  }
  writeFileSync(`${dir}/summary.json`, JSON.stringify(out, null, 2));
  console.log(`\n저장: ${dir}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
