import { NextResponse } from "next/server";
import { appendRaw, beginIngest, cancelIngest, finishIngest, getRaw, getVideo, resetRaw, setIngestJob } from "@/lib/store";
import { poll, start, videoId, settings, type Result } from "@/lib/supadata";
import { transcribe, transcribeStream } from "@/lib/gemini";
import { provider } from "@/lib/transcript-provider";
import { prepareTranscript } from "@/lib/transcript";
import { topicChunk } from "@/lib/topic-chunker";
import { saveTranscriptSource } from "@/lib/transcript-source";
import { meta } from "@/lib/youtube";
import { checkQuota, checkVideo, quotaKeys, spendQuota, SLICE_SECONDS } from "@/lib/limits";
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

/** 받아쓰는 동안 한 줄씩 흘려보낸다. 줄마다 JSON 하나(NDJSON) —
 *  SSE 는 형식이 더 있지만 여기선 한쪽으로만 보내면 되니 줄바꿈이면 충분하다.
 *  결과와 값은 통짜 방식과 같다. 다른 것은 기다리는 동안 무엇이 보이느냐다. */
function streamed(run: (send: (o: unknown) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try { await run(send); }
      catch (e) { send({ t: "error", error: (e as Error).message }); }
      finally { controller.close(); }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // 중간 서버가 모아서 한 번에 보내면 스트리밍이 의미가 없어진다
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({error:"입력을 확인해 주세요."}, {status:400}); }
  const vid = typeof body?.url === "string" ? videoId(body.url) : null;
  if (!vid) return NextResponse.json({error:"유튜브 주소를 확인해 주세요."}, {status:400});
  const token = crypto.randomUUID();

  // 화면에서 넣을 때는 스트리밍으로 받는다. 플레이리스트처럼 여러 편을 도는 쪽은
  // 예전 방식(통짜 JSON)을 그대로 쓴다 — 화면에 보여줄 것이 없는 자리다.
  // 화면에서 넣을 때는 스트리밍으로 받는다. 긴 영상은 한 번에 못 끝내므로
  // 구간을 나눠 여러 번 부른다 — 이 함수는 구간 하나를 맡고, 다음 구간은 화면이 다시 부른다.
  // 목차(/api/outline)·검색 준비(/api/embed)가 이미 쓰는 방식과 같다.
  if (body.stream === true && provider() === "gemini") {
    const from = Number(body.from ?? 0) || 0;
    const first = from === 0;
    return streamed(async send => {
      const existing = await getVideo(vid);
      // "이미 있다"는 문단까지 만들어진 것만이다. status 로만 보면 만들다 만 영상도
      // 다 된 것으로 세어, 화면이 다시 그리고 다시 만들기를 반복한다.
      const ready = Boolean(existing?.chunks.length);
      if (first && ready && body.replace !== true) {
        const me = await currentUser();
        if (me) await addToLibrary(me.id, [vid]);
        send({ t: "added", vid, title: existing!.title });
        return;
      }
      const keys = quotaKeys(req);
      const video = await checkVideo(vid);
      if (!video.ok) { send({ t: "error", code: video.code, error: video.error, vid }); return; }

      const total = video.seconds;
      const to = total > 0 ? Math.min(total, from + SLICE_SECONDS) : from + SLICE_SECONDS;
      const slice = Math.max(1, to - from);
      // 남은 몫은 이번 구간만큼만 본다. 첫 구간에서 영상 전체를 재면,
      // 하루치보다 긴 영상은 한 구간도 못 받아쓰고 막힌다.
      const q = await checkQuota(keys, slice);
      if (!q.ok) { send({ t: "error", code: q.code, error: q.error, vid }); return; }

      // 첫 구간에서만 길이·제목을 알린다. 화면은 이걸로 전체 진행률과 남은 시간을 계산한다.
      if (first) send({ t: "meta", vid, seconds: total, title: (await meta(vid))?.title ?? null });

      // 자리를 잡는 건 첫 구간뿐이다. 이어지는 구간은 같은 표(token)를 그대로 쓴다.
      const mark = first ? token : String(body.token ?? "");
      if (first) {
        // 만들다 만 영상은 처음부터 다시 받아쓴다. 쌓아 둔 조각을 비우지 않으면
        // 지난번 것 뒤에 또 붙어 같은 말이 두 번 나온다.
        if (existing) await resetRaw(vid);
        const state = await beginIngest(vid, body.replace === true || Boolean(existing), mark, "gemini", null);
        if (state !== "started") {
          send({ t: "error", code: state === "busy" ? "INGEST_BUSY" : "VIDEO_EXISTS",
            error: state === "busy" ? "이미 처리 중입니다. 잠시 후 다시 확인해 주세요." : "이미 등록된 영상입니다.", vid });
          return;
        }
      }

      try {
        const url = `https://www.youtube.com/watch?v=${vid}`;
        const range = total > SLICE_SECONDS ? { from, to } : undefined;
        const { result } = await transcribeStream(url, seg => send({ t: "seg", start: seg.start, text: seg.text }), range);
        // Gemini 는 늘 조각 배열을 준다. Result 의 content 는 옛 제공자 때문에 문자열도
        // 될 수 있는 타입이라 여기서 한 번 좁힌다.
        const got = Array.isArray(result.content) ? result.content : [];
        // 받아쓴 만큼 그때그때 센다. 중간에 그만둬도 거기까지는 값이 나갔다.
        await spendQuota(keys, slice);

        const last = !range || to >= total;
        if (!last) {
          // 여기까지 받은 것을 남긴다. 다음 구간에서 끊겨도 처음부터 다시 하지 않는다.
          await appendRaw(vid, got);
          send({ t: "slice", vid, token: mark, from, to, total, next: to });
          return;
        }
        // 마지막 구간. 앞서 쌓아 둔 것과 합쳐서 문단·목차로 넘긴다.
        const before = range ? ((await getRaw(vid)) ?? []) : [];
        const whole = { lang: result.lang, content: [...before, ...got] };
        const done = await save(vid, mark, whole, null);
        const me = await currentUser();
        if (me) await addToLibrary(me.id, [vid]);
        send({ t: "done", ...done });
      } catch (e) {
        await cancelIngest(vid, mark).catch(() => console.error("Could not clear ingest reservation"));
        send({ t: "error", error: (e as Error).message });
      }
    });
  }

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
