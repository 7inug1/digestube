import { NextResponse } from "next/server";
import { beginIngest, cancelIngest, finishIngest, getVideo, setIngestJob } from "@/lib/store";
import { poll, start, videoId, settings, type Result } from "@/lib/supadata";
import { prepareTranscript } from "@/lib/transcript";
import { meta } from "@/lib/youtube";

export const maxDuration = 60;

async function save(vid: string, token: string, r: Result, lang: string | null) {
  const prepared = prepareTranscript(r, lang);
  const m = await meta(vid);
  await finishIngest(vid, token, {
    id:vid, title:m?.title ?? null, channel:m?.channel ?? null, lang:r.lang ?? null,
    pieces:prepared.pieces, chars:prepared.chars,
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
    if (existing && body.replace !== true) return NextResponse.json({
      code:"VIDEO_EXISTS", error:"이미 등록된 영상입니다.", vid, title:existing.title,
    }, {status:409});
    const config = settings();
    const state = await beginIngest(vid, body.replace === true, token, config.mode, config.lang);
    if (state !== "started") return NextResponse.json({code:state === "busy" ? "INGEST_BUSY" : "VIDEO_EXISTS",
      error:state === "busy" ? "이미 처리 중입니다. 잠시 후 다시 확인해 주세요." : "이미 등록된 영상입니다.", vid}, {status:409});
    reserved = true;
    const r = await start(`https://www.youtube.com/watch?v=${vid}`, config);
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
