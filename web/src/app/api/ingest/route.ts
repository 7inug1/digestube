import { NextResponse } from "next/server";
import { beginIngest, cancelIngest, finishIngest, getVideo, setIngestJob } from "@/lib/store";
import { poll, start, videoId, settings, type Result } from "@/lib/supadata";
import { transcribe } from "@/lib/gemini";
import { provider } from "@/lib/transcript-provider";
import { prepareTranscript } from "@/lib/transcript";
import { topicChunk } from "@/lib/topic-chunker";
import { saveTranscriptSource } from "@/lib/transcript-source";
import { meta } from "@/lib/youtube";
import { checkQuota, checkVideo, quotaKeys, spendQuota } from "@/lib/limits";
import { currentUser } from "@/lib/auth/server";
import { addToLibrary } from "@/lib/store";

// Gemini 전사는 영상 길이의 10~15% 가 걸린다(실측: 10.9분 영상 96초).
// fluid compute 가 켜진 Hobby 플랜의 상한이 300초다.
export const maxDuration = 300;

async function save(vid: string, token: string, r: Result, lang: string | null) {
  const prepared = prepareTranscript(r, lang);
  // 전사는 발화 조각까지만 만든다. 읽기 화면의 문단은 주제 경계 모델이
  // 고르고, 모델 호출이 실패하면 topicChunk 내부에서 기존 코드 방식으로
  // 되돌아간다. 새로 등록하는 영상과 재구축한 코퍼스가 같은 경로를 쓴다.
  const topic = await topicChunk(prepared.raw);
  const m = await meta(vid);
  await saveTranscriptSource(vid, token, r, lang);
  await finishIngest(vid, token, {
    id:vid, title:m?.title ?? null, channel:m?.channel ?? null, lang:r.lang ?? null,
    pieces:prepared.pieces, chars:prepared.chars, raw:prepared.raw,
  }, topic.chunks);
  return {
    vid, chunks:topic.chunks.length, chars:prepared.chars,
    chunking:topic.source, chunkModel:topic.model,
  };
}

export async function POST(req: Request) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({error:"입력을 확인해 주세요."}, {status:400}); }
  const vid = typeof body?.url === "string" ? videoId(body.url) : null;
  if (!vid) return NextResponse.json({error:"유튜브 주소를 확인해 주세요."}, {status:400});
  const token = crypto.randomUUID();
  let reserved = false;
  try {
    // Preflight avoids a paid request and gives a useful link even before replacement.
    const existing = await getVideo(vid);
    // 전사가 실패해 껍데기만 남은 행은 '이미 등록된 영상'이 아니다.
    // 이게 없으면 실패한 주소를 다시 넣을 때 replace 없이는 409 로 막힌다.
    const usable = existing && existing.status !== "실패";
    // 이미 변환된 영상이면 담기만 한다. 전사를 다시 하지 않으니 비용도 쿼터도 없다 —
    // 남이 변환해 둔 영상을 내 라이브러리에 넣는 길이기도 하다.
    // (다시 전사하려는 건 replace: true 로 온다)
    if (usable && body.replace !== true) {
      const me = await currentUser();
      if (me) await addToLibrary(me.id, [vid]);
      return NextResponse.json({state:"added", vid, title:existing!.title});
    }
    // 돈이 나가기 전에 거른다. 이미 있는 영상 확인이 먼저다 — 그건 비용이 없다.
    const keys = quotaKeys(req);
    const video = await checkVideo(vid);
    for (const v of [video, await checkQuota(keys, video.seconds)]) {
      if (!v.ok) return NextResponse.json({code:v.code, error:v.error, vid}, {status:v.status});
    }
    const source = provider();
    // Gemini 는 언어를 고르지 않는다 — 영상의 언어 그대로 받아쓴다.
    const config = source === "gemini" ? {mode: "gemini" as const, lang: null} : settings();
    const state = await beginIngest(vid, body.replace === true || existing?.status === "실패", token, config.mode, config.lang);
    if (state !== "started") return NextResponse.json({code:state === "busy" ? "INGEST_BUSY" : "VIDEO_EXISTS",
      error:state === "busy" ? "이미 처리 중입니다. 잠시 후 다시 확인해 주세요." : "이미 등록된 영상입니다.", vid}, {status:409});
    reserved = true;
    const url = `https://www.youtube.com/watch?v=${vid}`;
    if (source === "gemini") {
      const r = await transcribe(url);
      // 전사가 돌아온 뒤에 센다. 그 전에 세면 구글이 503 으로 튕긴 것도 깎인다 —
      // 실제로 그랬다. 전사 뒤 저장이 실패하는 건 드물고, 그때는 비용이 나갔으니 깎는 게 맞다.
      await spendQuota(keys, video.seconds);
      const done = await save(vid,token,r,null);
      const me = await currentUser();
      if (me) await addToLibrary(me.id, [vid]);
      return NextResponse.json({state:"done",...done});
    }
    await spendQuota(keys, video.seconds);
    const r = await start(url, settings());
    if (r.state === "working") {
      await setIngestJob(vid, token, r.job);
      return NextResponse.json({state:"working",vid,job:r.job,token});
    }
    return NextResponse.json({state:"done",...(await save(vid,token,r.result,config.lang))});
  } catch (e) {
    if (reserved) await cancelIngest(vid,token).catch(() => console.error("Could not clear ingest reservation"));
    return NextResponse.json({error:(e as Error).message}, {status:502});
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const job=u.searchParams.get("job"), vid=u.searchParams.get("vid"), token=u.searchParams.get("token");
  if (!job || !vid || !token) return NextResponse.json({error:"전사 작업 정보가 필요합니다."}, {status:400});
  try {
    const v = await getVideo(vid);
    if (!v || v.job !== job || v.ingest_token !== token) return NextResponse.json({error:"현재 전사 작업과 일치하지 않습니다."}, {status:409});
    const r = await poll(job);
    if (r.state === "working") return NextResponse.json({state:"working",vid,job,token});
    if (r.state === "failed") {
      await cancelIngest(vid,token);
      return NextResponse.json({state:"failed",error:r.error}, {status:502});
    }
    try {
      return NextResponse.json({state:"done",...(await save(vid,token,r.result,v.pending_lang ?? null))});
    } catch(e) {
      await cancelIngest(vid,token);
      throw e;
    }
  } catch(e) {
    return NextResponse.json({error:(e as Error).message}, {status:502});
  }
}
