import { saySorry } from "@/lib/errors";
import { NextResponse } from "next/server";
import { playlistId, playlistVideos } from "@/lib/supadata";
import { listVideos } from "@/lib/store";

export const maxDuration = 60;

/** 플레이리스트 주소 → 아직 안 넣은 영상 번호 목록.
 *  전사는 브라우저가 한 편씩 이어서 부른다 — 여러 편을 한 요청에 처리하면
 *  60초를 넘고, 배치 기능은 유료 플랜에서만 된다. */
export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    const id = playlistId(url ?? "");
    if (!id) return NextResponse.json({ error: "플레이리스트 주소가 아니다" }, { status: 400 });

    const ids = await playlistVideos(id);
    const have = new Set((await listVideos()).map((v) => v.id));
    return NextResponse.json({
      total: ids.length,
      todo: ids.filter((v) => !have.has(v)),
    });
  } catch (e) {
    return NextResponse.json({ error: saySorry(e, "playlist") }, { status: 502 });
  }
}
