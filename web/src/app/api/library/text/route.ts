import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { getVideo, libraryIds } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { SAMPLE_IDS } from "@/lib/samples";
import type { IndexVideo } from "@/lib/keyword";

/** 검색 창이 열릴 때 한 번 받아 가는 내 라이브러리 전사문.
 *  입력하는 동안 글자가 맞는 대목을 브라우저에서 바로 찾으려고 쓴다 — 타자마다 서버에 묻지 않는다.
 *  범위는 검색(/api/search)과 같다: 로그인했으면 계정 목록, 아니면 브라우저가 보낸 ids, 그리고 맛보기. */
export async function GET(req: Request) {
  const user = await currentUser();
  const asked = new URL(req.url).searchParams.get("ids");
  const owned = user ? await libraryIds(user.id) : (asked ? asked.split(",").filter(Boolean) : []);
  const ids = [...new Set([...owned, ...SAMPLE_IDS])].slice(0, 200);
  const videos = (await Promise.all(ids.map(async (id): Promise<IndexVideo | null> => {
    const [v, m] = await Promise.all([getVideo(id), meta(id)]);
    if (!v?.chunks.length) return null;
    return {
      video_id: id,
      title: m?.title ?? v.title ?? id,
      chunks: v.chunks.map(c => ({ seq: c.seq, t: c.t, text: c.text })),
    };
  }))).filter((v): v is IndexVideo => Boolean(v));
  return NextResponse.json({ videos }, { headers: { "Cache-Control": "private, max-age=60" } });
}
