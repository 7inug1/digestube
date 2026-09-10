import { NextResponse } from "next/server";
import { label } from "@/lib/outline";
import { getVideo, putOutline, upsertVideo } from "@/lib/store";
import { check } from "@/lib/verify";

/* 목차는 전사와 따로 부른다. 문단마다 한 번씩 부르는 구조라 영상이 길면
   서버리스 60초 제한을 넘는다(문단 50개 × 약 2초). 넣기와 붙여 두면
   전사까지 같이 실패하므로 여기서만 다룬다. */
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { vid } = await req.json();
    const v = await getVideo(vid);
    if (!v) return NextResponse.json({ error: "없는 영상" }, { status: 404 });
    if (!v.chunks.length) return NextResponse.json({ error: "문단이 없다" }, { status: 400 });

    // 한꺼번에 보내면 한도에 걸린다. 몇 개씩 나눠 부른다.
    const items = [];
    for (let i = 0; i < v.chunks.length; i += 4) {
      const part = await Promise.all(v.chunks.slice(i, i + 4).map(label));
      items.push(...part);
    }

    // 근거가 원문에 없는 항목은 버린다
    const { kept, stats } = check(items, v.chunks);
    await putOutline(vid, kept.map(({ seq, t, label, quote }) => ({ seq, t, label, quote })));
    await upsertVideo({ id: vid, status: "완료" });

    return NextResponse.json({ vid, ...stats });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
