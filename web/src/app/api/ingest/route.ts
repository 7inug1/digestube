import { saySorry } from "@/lib/errors";
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
import { addToLibrary, recordFailure } from "@/lib/store";
import { describe, type FailureStage } from "@/lib/failure";
import { ndjson } from "@/lib/ndjson";

// Gemini 전사는 영상 길이의 10~15% 가 걸린다(실측: 10.9분 영상 96초).
// fluid compute 가 켜진 Hobby 플랜의 상한이 300초다.
export const maxDuration = 300;
/** 이 시각 안에 끝낸다(한도 300초에서 10초 여유). 안쪽 호출 타임아웃을 여기에 맞춘다 —
 *  전사 280초 + 문단 나누기 240초를 그대로 두면 합이 한도를 넘어, 느린 날엔 서버가 먼저
 *  끊겨 문장 경계 폴백에도 못 간다. */
const BUDGET_MS = 290_000;
/** 전사가 끝난 뒤 문단 나누기·저장에 남겨 둘 시간. */
const SAVE_RESERVE_MS = 25_000;
/** 문단 나누기가 끝난 뒤 제목 조회·원본 보관·저장에 남겨 둘 시간. */
const STORE_RESERVE_MS = 8_000;

/** 등록을 되돌리고 무엇이 어디서 실패했는지 남긴다. 기록이 실패해도 응답은 막지 않는다. */
async function fail(vid: string, token: string, e: unknown, stage: FailureStage) {
  await cancelIngest(vid, token).catch(() => console.error("Could not clear ingest reservation"));
  await recordFailure(vid, describe(e, stage)).catch(err => console.error(`실패 기록 실패: ${(err as Error).message}`));
}

async function save(vid: string, token: string, r: Result, lang: string | null, until?: number) {
  const prepared = prepareTranscript(r, lang);
  // 전사는 발화 조각까지만 만든다. 읽기 화면의 문단은 주제 경계 모델이
  // 고르고, 모델 호출이 실패하면 topicChunk 내부에서 기존 코드 방식으로
  // 되돌아간다. 새로 등록하는 영상과 재구축한 코퍼스가 같은 경로를 쓴다.
  const topic = await topicChunk(prepared.raw, until === undefined ? undefined : until - STORE_RESERVE_MS);
  const m = await meta(vid);
  await saveTranscriptSource(vid, token, r, lang);
  await finishIngest(vid, token, {
    id:vid, title:m?.title ?? null, channel:m?.channel ?? null, lang:r.lang ?? null,
    pieces:prepared.pieces, chars:prepared.chars, raw:prepared.raw,
  }, topic.chunks);
  // 다시 등록해서 성공했으면 지난 실패 기록을 지운다
  await recordFailure(vid, null).catch(err => console.error(`실패 기록 정리 실패: ${(err as Error).message}`));
  return {
    vid, chunks:topic.chunks.length, chars:prepared.chars,
    chunking:topic.source, chunkModel:topic.model,
  };
}

export async function POST(req: Request) {
  const until = Date.now() + BUDGET_MS;
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
    return ndjson("ingest-stream", async send => {
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
      // 열쇠를 고르려면 로그인 여부가 먼저 필요하다. 아래에서 담을 때도 다시 쓴다.
      const me = await currentUser();
      const keys = quotaKeys(req, me?.id);
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

      let stage: FailureStage = "transcribe";
      try {
        const url = `https://www.youtube.com/watch?v=${vid}`;
        const range = total > SLICE_SECONDS ? { from, to } : undefined;
        const { result } = await transcribeStream(url, seg => send({ t: "seg", start: seg.start, text: seg.text }), range,
          until - SAVE_RESERVE_MS);
        stage = "spend_quota";
        // Gemini 는 늘 조각 배열을 준다. Result 의 content 는 옛 제공자 때문에 문자열도
        // 될 수 있는 타입이라 여기서 한 번 좁힌다.
        const got = Array.isArray(result.content) ? result.content : [];
        // 받아쓴 만큼 그때그때 센다. 중간에 그만둬도 거기까지는 값이 나갔다.
        await spendQuota(keys, slice);

        const last = !range || to >= total;
        if (!last) {
          // 여기까지 받은 것을 남긴다. 다음 구간에서 끊겨도 처음부터 다시 하지 않는다.
          stage = "save_slice";
          await appendRaw(vid, got);
          send({ t: "slice", vid, token: mark, from, to, total, next: to });
          return;
        }
        // 마지막 구간. 앞서 쌓아 둔 것과 합쳐서 문단·목차로 넘긴다.
        stage = "save";
        const before = range ? ((await getRaw(vid)) ?? []) : [];
        const whole = { lang: result.lang, content: [...before, ...got] };
        const done = await save(vid, mark, whole, null, until);
        if (me) await addToLibrary(me.id, [vid]);
        send({ t: "done", ...done });
      } catch (e) {
        await fail(vid, mark, e, stage);
        send({ t: "error", error: saySorry(e, "ingest-slice") });
      }
    });
  }

  let reserved = false;
  let stage: FailureStage = "transcribe";
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
      const r = await transcribe(url, until - SAVE_RESERVE_MS);
      stage = "spend_quota";
      // 전사가 돌아온 뒤에 센다. 그 전에 세면 구글이 503 으로 튕긴 것도 깎인다 —
      // 실제로 그랬다. 전사 뒤 저장이 실패하는 건 드물고, 그때는 비용이 나갔으니 깎는 게 맞다.
      await spendQuota(keys, video.seconds);
      stage = "save";
      const done = await save(vid,token,r,null,until);
      const me = await currentUser();
      if (me) await addToLibrary(me.id, [vid]);
      return NextResponse.json({state:"done",...done});
    }
    stage = "spend_quota";
    await spendQuota(keys, video.seconds);
    stage = "supadata_start";
    const r = await start(url, settings());
    if (r.state === "working") {
      await setIngestJob(vid, token, r.job);
      return NextResponse.json({state:"working",vid,job:r.job,token});
    }
    stage = "save";
    return NextResponse.json({state:"done",...(await save(vid,token,r.result,config.lang,until))});
  } catch (e) {
    if (reserved) await fail(vid, token, e, stage);
    return NextResponse.json({error: saySorry(e, "ingest")}, {status:502});
  }
}

export async function GET(req: Request) {
  const until = Date.now() + BUDGET_MS;
  const u = new URL(req.url);
  const job=u.searchParams.get("job"), vid=u.searchParams.get("vid"), token=u.searchParams.get("token");
  if (!job || !vid || !token) return NextResponse.json({error:"전사 작업 정보가 필요합니다."}, {status:400});
  try {
    const v = await getVideo(vid);
    if (!v || v.job !== job || v.ingest_token !== token) return NextResponse.json({error:"현재 전사 작업과 일치하지 않습니다."}, {status:409});
    const r = await poll(job);
    if (r.state === "working") return NextResponse.json({state:"working",vid,job,token});
    if (r.state === "failed") {
      await fail(vid, token, new Error(String(r.error ?? "전사 작업 실패")), "supadata_poll");
      return NextResponse.json({state:"failed",error:r.error}, {status:502});
    }
    try {
      return NextResponse.json({state:"done",...(await save(vid,token,r.result,v.pending_lang ?? null,until))});
    } catch(e) {
      await fail(vid, token, e, "save");
      throw e;
    }
  } catch(e) {
    return NextResponse.json({error: saySorry(e, "ingest")}, {status:502});
  }
}
