import { NextResponse } from "next/server";
import { chunk } from "@/lib/chunker";
import { putChunks, upsertVideo } from "@/lib/store";
import { poll, start, toText, videoId, type Result } from "@/lib/supadata";
import { meta } from "@/lib/youtube";

/* 서버리스는 한 요청이 오래 못 간다. 전사가 바로 끝나면 그 자리에서 저장하고,
   작업 번호만 오면 브라우저가 되물어 그때 저장한다. */
export const maxDuration = 60;

/** 전사 결과를 문단으로 나눠 저장한다. 임베딩과 목차는 아직 붙이지 않았다. */
async function save(vid: string, r: Result) {
  const pieces = Array.isArray(r.content) ? r.content : [];
  const text = toText(r.content);
  const cs = chunk(pieces);
  const m = await meta(vid);

  await upsertVideo({
    id: vid,
    title: m?.title ?? null,
    channel: m?.channel ?? null,
    lang: r.lang ?? null,
    status: "문단완료",          // 벡터가 붙으면 "완료"
    job: null,
    pieces: pieces.length || 1,
    chars: text.length,
  });
  await putChunks(vid, cs);
  return { vid, chunks: cs.length, chars: text.length };
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    const vid = videoId(url ?? "");
    if (!vid) return NextResponse.json({ error: "유튜브 주소가 아니다" }, { status: 400 });

    const r = await start(url);
    if (r.state === "working") {
      // 아직 글이 없다. 자리만 만들어 두고 브라우저가 되묻게 한다.
      await upsertVideo({ id: vid, status: "전사중", job: r.job });
      return NextResponse.json({ state: "working", vid, job: r.job });
    }
    return NextResponse.json({ state: "done", ...(await save(vid, r.result)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const job = u.searchParams.get("job");
  const vid = u.searchParams.get("vid");
  if (!job || !vid) return NextResponse.json({ error: "job·vid 가 필요하다" }, { status: 400 });
  try {
    const r = await poll(job);
    if (r.state === "working") return NextResponse.json({ state: "working", vid, job });
    if (r.state === "failed") {
      await upsertVideo({ id: vid, status: "실패", job: null });
      return NextResponse.json({ state: "failed", error: r.error }, { status: 502 });
    }
    return NextResponse.json({ state: "done", ...(await save(vid, r.result)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
