import { saySorry } from "@/lib/errors";
import { NextResponse } from "next/server";
import { find } from "@/lib/search";
import { currentUser } from "@/lib/auth/server";
import { libraryIds, statsOf } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { SAMPLE_IDS } from "@/lib/samples";

export const maxDuration = 60;

/** 내 라이브러리 안에서 찾는다. 로그인했으면 계정 목록, 아니면 브라우저가 보낸 ids.
 *  "내가 읽은 것 중에 찾기"가 이 기능의 뜻이라 전체 영상을 뒤지지 않는다.
 *  제목·채널·길이도 여기서 붙인다 — 화면이 유튜브에 따로 물어보지 않게. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  const vid = u.searchParams.get("vid") ?? undefined;
  const k = Number(u.searchParams.get("k") ?? 3);
  try {
    const user = await currentUser();
    const asked = u.searchParams.get("ids");
    // 한 영상 안에서 찾을 때(읽기 화면)는 범위를 따로 좁히지 않는다
    const owned = user ? await libraryIds(user.id)
      : (asked ? asked.split(",").filter(Boolean) : []);
    // 맛보기는 라이브러리에 보이니 검색에서도 찾혀야 한다 — 목록에 있는데 안 찾히면
    // 검색이 고장 난 것으로 읽힌다
    const ids = vid ? undefined : [...new Set([...owned, ...SAMPLE_IDS])];
    const hits = await find(q, vid, k, ids);
    if (!hits.length) return NextResponse.json({ hits: [] });
    const vids = [...new Set(hits.map(h => h.video_id))];
    const [metas, stats] = await Promise.all([
      Promise.all(vids.map(async v => [v, await meta(v)] as const)),
      statsOf(vids),
    ]);
    const by = Object.fromEntries(metas);
    return NextResponse.json({
      hits: hits.map(h => ({
        ...h,
        title: by[h.video_id]?.title ?? h.video_id,
        channel: by[h.video_id]?.channel ?? "",
        duration: stats[h.video_id]?.seconds ?? 0,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: saySorry(e, "search") }, { status: 502 });
  }
}
