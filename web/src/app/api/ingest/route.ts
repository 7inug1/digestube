import { NextResponse } from "next/server";
import { beginIngest, cancelIngest, finishIngest, getVideo, setIngestJob } from "@/lib/store";
import { poll, start, videoId, settings, type Result } from "@/lib/supadata";
import { transcribe } from "@/lib/gemini";
import { provider } from "@/lib/transcript-provider";
import { prepareTranscript } from "@/lib/transcript";
import { saveTranscriptSource } from "@/lib/transcript-source";
import { meta } from "@/lib/youtube";

// Gemini 전사는 영상 길이의 10~15% 가 걸린다(실측: 10.9분 영상 96초).
// fluid compute 가 켜진 Hobby 플랜의 상한이 300초다.
export const maxDuration = 300;

async function save(vid: string, token: string, r: Result, lang: string | null) {
  const prepared = prepareTranscript(r, lang);
  const m = await meta(vid);
  await saveTranscriptSource(vid, token, r, lang);
  await finishIngest(vid, token, {
    id:vid, title:m?.title ?? null, channel:m?.channel ?? null, lang:r.lang ?? null,
    pieces:prepared.pieces, chars:prepared.chars, raw:prepared.raw,
  }, prepared.chunks);
  return {vid, chunks:prepared.chunks.length, chars:prepared.chars};
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
    if (usable && body.replace !== true) return NextResponse.json({
      code:"VIDEO_EXISTS", error:"이미 등록된 영상입니다.", vid, title:existing!.title,
    }, {status:409});
    const source = provider();
    // Gemini 는 언어를 고르지 않는다 — 영상의 언어 그대로 받아쓴다.
    const config = source === "gemini" ? {mode: "gemini" as const, lang: null} : settings();
    const state = await beginIngest(vid, body.replace === true || existing?.status === "실패", token, config.mode, config.lang);
    if (state !== "started") return NextResponse.json({code:state === "busy" ? "INGEST_BUSY" : "VIDEO_EXISTS",
      error:state === "busy" ? "이미 처리 중입니다. 잠시 후 다시 확인해 주세요." : "이미 등록된 영상입니다.", vid}, {status:409});
    reserved = true;
    const url = `https://www.youtube.com/watch?v=${vid}`;
    if (source === "gemini") {
      return NextResponse.json({state:"done",...(await save(vid,token,await transcribe(url),null))});
    }
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
