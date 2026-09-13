/** 기존 영상을 Gemini 로 다시 전사한다.
 *
 *   node --env-file=.env.local --import tsx scripts/retranscribe.ts <videoId...>
 *
 *  운영 DB 의 전사문·문단을 **교체**한다. 목차·임베딩은 지워지고 다시 만들어야 한다.
 *  검색 평가의 정답 구간(사용자 검수)도 문단이 바뀌면 무효다 — notes/22 참고.
 */
import {beginIngest, cancelIngest, finishIngest} from '../src/lib/store.supabase';
import {transcribeWithUsage, MODEL} from '../src/lib/gemini';
import {prepareTranscript} from '../src/lib/transcript';
import {saveTranscriptSource} from '../src/lib/transcript-source';
import {meta} from '../src/lib/youtube';

const PRICE: Record<string, [number, number]> = {
  'gemini-3.8-flash': [0.75, 3.75], 'gemini-3.6-flash': [0.75, 3.75], 'gemini-3.5-flash': [1.5, 9.0],
};

async function one(vid: string) {
  const token = crypto.randomUUID();
  const state = await beginIngest(vid, true, token, 'gemini', null);
  if (state !== 'started') throw new Error(`${vid}: ${state}`);
  try {
    const started = Date.now();
    const {result, usage} = await transcribeWithUsage(`https://www.youtube.com/watch?v=${vid}`);
    const elapsed = (Date.now() - started) / 1000;
    const prepared = prepareTranscript(result, null);
    const m = await meta(vid);
    await saveTranscriptSource(vid, token, result, null);
    await finishIngest(vid, token, {
      id: vid, title: m?.title ?? null, channel: m?.channel ?? null, lang: result.lang ?? null,
      pieces: prepared.pieces, chars: prepared.chars, raw: prepared.raw,
    }, prepared.chunks);
    const [ip, op] = PRICE[MODEL] ?? [0, 0];
    const input = usage.promptTokenCount ?? 0;
    const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    const cost = (input * ip + output * op) / 1e6;
    console.log(`${vid} · ${elapsed.toFixed(1)}초 · 문단 ${prepared.chunks.length} · ${prepared.chars}자 · 입력 ${input} 출력 ${output} · $${cost.toFixed(4)}`);
    return cost;
  } catch (e) {
    await cancelIngest(vid, token).catch(() => console.error(`${vid}: 예약 해제 실패`));
    throw e;
  }
}

async function main() {
  const vids = process.argv.slice(2);
  if (!vids.length) throw new Error('영상 id 를 인자로 준다');
  console.log(`모델 ${MODEL} · ${vids.length}편`);
  let total = 0;
  for (const vid of vids) {
    try { total += await one(vid); }
    catch (e) { console.error(`${vid} 실패: ${(e as Error).message}`); }
  }
  console.log(`합계 $${total.toFixed(4)} — 목차·임베딩은 아직이다`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
