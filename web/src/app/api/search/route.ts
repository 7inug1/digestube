import { saySorry } from "@/lib/errors";
import { NextResponse } from "next/server";
import { findFirst, refine, type Found } from "@/lib/search";
import { currentUser } from "@/lib/auth/server";
import { libraryIds, statsOf } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { SAMPLE_IDS } from "@/lib/samples";
import { ndjson } from "@/lib/ndjson";

export const maxDuration = 60;

/** 제목·채널·길이를 붙인다 — 화면이 유튜브에 따로 물어보지 않게. */
async function decorate(hits: Found[]) {
  const vids = [...new Set(hits.map(h => h.video_id))];
  const [metas, stats] = await Promise.all([
    Promise.all(vids.map(async v => [v, await meta(v)] as const)),
    statsOf(vids),
  ]);
  const by = Object.fromEntries(metas);
  return hits.map(h => ({
    ...h,
    title: by[h.video_id]?.title ?? h.video_id,
    channel: by[h.video_id]?.channel ?? "",
    duration: stats[h.video_id]?.seconds ?? 0,
  }));
}

/** 내 라이브러리 안에서 찾는다. 로그인했으면 계정 목록, 아니면 브라우저가 보낸 ids.
 *  "내가 읽은 것 중에 찾기"가 이 기능의 뜻이라 전체 영상을 뒤지지 않는다.
 *
 *  stream=1: 벡터 결과를 먼저 보내고(약 1.7초), 리랭커가 순서를 바꾸면 한 번 더 보낸다.
 *    화면은 먼저 읽기 시작하고, 다듬어진 순서를 나중에 받는다. 리랭커가 5초 안에 못 오면
 *    처음 결과를 그대로 둔다.
 *  rerank=1: 다듬은 결과만 한 번에(평가 스크립트용). 둘 다 없으면 벡터 결과만(예전과 같음). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  const vid = u.searchParams.get("vid") ?? undefined;
  const k = Number(u.searchParams.get("k") ?? 3);
  const stream = u.searchParams.get("stream") === "1";
  const wantRerank = u.searchParams.get("rerank") === "1";

  const scope = async () => {
    const user = await currentUser();
    const asked = u.searchParams.get("ids");
    // 한 영상 안에서 찾을 때(읽기 화면)는 범위를 따로 좁히지 않는다
    const owned = user ? await libraryIds(user.id)
      : (asked ? asked.split(",").filter(Boolean) : []);
    // 맛보기는 라이브러리에 보이니 검색에서도 찾혀야 한다 — 목록에 있는데 안 찾히면
    // 검색이 고장 난 것으로 읽힌다
    return vid ? undefined : [...new Set([...owned, ...SAMPLE_IDS])];
  };

  if (stream) {
    return ndjson("search", async send => {
      const first = await findFirst(q, vid, k, await scope());
      if (!first || !first.hits.length) { send({ t: "hits", hits: [] }); send({ t: "done", reranked: false, reason: null }); return; }
      send({ t: "hits", hits: await decorate(first.hits) });
      const r = await refine(first, k);
      if (r.reranked) send({ t: "reranked", hits: await decorate(r.hits), model: r.model, ms: r.ms });
      send({ t: "done", reranked: r.reranked, reason: r.reason });
    });
  }

  try {
    const first = await findFirst(q, vid, k, await scope());
    if (!first || !first.hits.length) return NextResponse.json({ hits: [] });
    if (!wantRerank) return NextResponse.json({ hits: await decorate(first.hits) });
    const r = await refine(first, k);
    return NextResponse.json({ hits: await decorate(r.hits),
      rerank: { reranked: r.reranked, reason: r.reason, model: r.model, ms: r.ms } });
  } catch (e) {
    return NextResponse.json({ error: saySorry(e, "search") }, { status: 502 });
  }
}
