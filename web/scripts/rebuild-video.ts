/** 영상 하나를 Gemini 파이프라인으로 다시 만든다: 전사 → 모델 청킹 → 목차 → 임베딩.
 *
 *   node --experimental-websocket --env-file=.env.local --import tsx scripts/rebuild-video.ts <videoId...>
 *
 *  운영 DB 를 교체한다. 목차·임베딩은 문단이 바뀌므로 다시 만든다.
 *  비용은 실측 토큰 × 공시 단가의 추정이다.
 */
import {beginIngest, cancelIngest, finishIngest, getVideo, saveOutlineBatch, saveEmbeddingBatch, refreshVideoStatus, chunksWithoutEmbedding} from "../src/lib/store.supabase";
import {transcribeWithUsage} from "../src/lib/gemini";
import {topicChunk} from "../src/lib/topic-chunker";
import {label} from "../src/lib/outline";
import {outlineWhole} from "../src/lib/outline-whole";
import {embed} from "../src/lib/embed";
import {saveTranscriptSource} from "../src/lib/transcript-source";
import {prepareTranscript} from "../src/lib/transcript";
import {meta} from "../src/lib/youtube";
import type {Piece} from "../src/lib/chunker";

const IN = 0.75 / 1e6, OUT = 3.75 / 1e6;   // gemini-3.8-flash
const OUTLINE_PER_CHUNK = 0.0015;           // 목차 비교 실측 평균

async function one(vid: string) {
  const token = crypto.randomUUID();
  let cost = 0;
  const t0 = Date.now();

  // 1) 전사
  const {result, usage} = await transcribeWithUsage(`https://www.youtube.com/watch?v=${vid}`);
  const tIn = usage.promptTokenCount ?? 0;
  const tOut = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  cost += tIn * IN + tOut * OUT;
  const pieces = (result.content ?? []) as Piece[];
  console.log(`  전사 ${pieces.length}발화 · $${(tIn * IN + tOut * OUT).toFixed(4)}`);

  // 2) 모델 청킹 (실패하면 코드 방식으로 되돌아간다)
  const topic = await topicChunk(pieces);
  console.log(`  청킹 ${topic.source} ${topic.chunks.length}문단 · ${(topic.ms / 1000).toFixed(1)}초` +
    (topic.problems.length ? ` · ${topic.problems[0].slice(0, 60)}` : ""));

  // 3) 저장 — 원본 조각과 문단을 같이 넣는다
  const state = await beginIngest(vid, true, token, "gemini", null);
  if (state !== "started") throw new Error(`예약 실패: ${state}`);
  try {
    const prepared = prepareTranscript(result, null);
    const m = await meta(vid);
    await saveTranscriptSource(vid, token, result, null);
    await finishIngest(vid, token, {
      id: vid, title: m?.title ?? null, channel: m?.channel ?? null, lang: result.lang ?? null,
      pieces: prepared.pieces, chars: prepared.chars, raw: prepared.raw,
    }, topic.chunks.map(c => ({t: c.t, t_end: c.t_end, text: c.text})));
  } catch (e) {
    await cancelIngest(vid, token).catch(() => console.error("  예약 해제 실패"));
    throw e;
  }

  // 4) 목차 — 전사문 전체에서 한 번에. 실패하면 문단별 방식으로 되돌린다.
  const v = await getVideo(vid);
  if (!v) throw new Error("저장 후 영상을 찾지 못했다");
  let items: Awaited<ReturnType<typeof label>>[] = [];
  try {
    const whole = await outlineWhole(v.chunks);
    // 항목이 두 개도 안 남으면 목차 구실을 못 한다. 그때만 되돌린다.
    if (whole.items.length < 2) throw new Error(`항목 ${whole.items.length}개`);
    items = whole.items;
    cost += (whole.usage.input * IN + whole.usage.output * OUT);
    console.log(`  목차 ${items.length}개 (전체 1회, 버림 ${whole.dropped.length}) · $${(whole.usage.input * IN + whole.usage.output * OUT).toFixed(4)}`);
    if (whole.goal) console.log(`   한 줄: ${whole.goal}`);
  } catch (e) {
    console.log(`  목차 전체 방식 실패(${(e as Error).message.slice(0, 60)}) → 문단별로 되돌림`);
    items = [];
    for (const c of v.chunks) items.push(await label(c));
    const fallback = items.filter(i => i.source === "fallback").length;
    cost += v.chunks.length * OUTLINE_PER_CHUNK;
    console.log(`  목차 ${items.length}개 (문단별, 폴백 ${fallback}) · $${(v.chunks.length * OUTLINE_PER_CHUNK).toFixed(4)}`);
  }
  await saveOutlineBatch(vid, v.revision ?? null, items);

  // 5) 임베딩 (HF 무료)
  for (;;) {
    const todo = (await chunksWithoutEmbedding(vid)).slice(0, 16);
    if (!todo.length) break;
    const vectors = await embed(todo.map(c => c.text));
    await saveEmbeddingBatch(vid, v.revision ?? null, todo.map((c, i) => ({seq: c.seq, vector: vectors[i]})));
  }
  await refreshVideoStatus(vid, v.revision ?? null);
  console.log(`  임베딩 완료 · 합계 $${cost.toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  return cost;
}

async function main() {
  const vids = process.argv.slice(2);
  if (!vids.length) throw new Error("영상 id 를 인자로 준다");
  let total = 0;
  for (const vid of vids) {
    console.log(`\n=== ${vid}`);
    try { total += await one(vid); } catch (e) { console.error(`  실패: ${(e as Error).message}`); }
  }
  console.log(`\n총 $${total.toFixed(4)} (약 ${Math.round(total * 1400)}원)`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
