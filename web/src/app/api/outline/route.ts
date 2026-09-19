import { saySorry } from "@/lib/errors";
import { NextResponse } from "next/server";
import { label } from "@/lib/outline";
import { outlineWhole } from "@/lib/outline-whole";
import { getVideo, refreshVideoStatus, saveOutlineBatch, replaceOutline } from "@/lib/store";

// Four paragraphs at a time, each with at most two 20-second calls.
/** 아무나 부를 수 있지만 남은 일이 있을 때만 모델을 부른다 — 목차가 다 차 있으면
 *  todo 가 비어 아무 값도 들지 않는다. 그래서 따로 잠그지 않았다.
 *  값이 드는 문(다시 전사·다시 나누기)은 /api/ingest 와 /api/rechunk 쪽이다. */
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const {vid} = await req.json();
    if (typeof vid !== "string") return NextResponse.json({error:"영상 번호가 필요합니다."}, {status:400});
    const v = await getVideo(vid);
    if (!v) return NextResponse.json({error:"없는 영상입니다."}, {status:404});
    if (!v.chunks.length) return NextResponse.json({error:"문단이 없습니다."}, {status:400});
    if (v.outline_complete) {
      await refreshVideoStatus(vid, v.revision ?? null);
      return NextResponse.json({vid,n:v.chunks.length,done:0,kept:v.outline.length,left:0});
    }
    // 목차는 전사문 전체를 한 번에 보고 만든다(notes/30). 문단마다 부르면
    // 앞뒤 맥락을 못 봐서 제목이 겹치고 개수도 문단 수에 묶인다.
    if (!v.outline.length) {
      try {
        const whole = await outlineWhole(v.chunks);
        if (whole.items.length >= 2) {
          await replaceOutline(vid,v.revision ?? null,whole.items,whole.tldr);
          // 요약은 목차와 같은 호출에서 왔다. 여기서 같이 저장한다 — 따로 부르면 값이 두 배다.

          await refreshVideoStatus(vid,v.revision ?? null);
          return NextResponse.json({vid,n:v.chunks.length,done:whole.items.length,
            kept:whole.items.length,left:0,dropped:whole.dropped.length});
        }
      } catch (e) {
        console.error(`목차 전체 방식 실패: ${(e as Error).message}`);
      }
    }
    // 되돌림: 문단별로 네 개씩 이어서 만든다.
    const completed = new Set(v.outline.map(o=>o.seq));
    const todo = v.chunks.filter(c=>!completed.has(c.seq));
    const tried = todo.slice(0,4);
    const items = await Promise.all(tried.map(c=>label(c)));
    // 확인이 안 되면 원문 첫 문장으로 채우고 source=fallback 으로 구분한다 — 줄이 비면
    // 그 대목으로 건너뛸 길이 사라진다. 폴백 수를 세어 품질 지표로 돌려준다.
    if (items.length) await saveOutlineBatch(vid,v.revision ?? null,items);
    await refreshVideoStatus(vid,v.revision ?? null);
    return NextResponse.json({vid,n:v.chunks.length,done:items.length,kept:completed.size+items.length,
      left:Math.max(0,todo.length-tried.length),fallback:items.filter(o=>o.source==="fallback").length});
  } catch(e) {
    return NextResponse.json({error: saySorry(e, "outline")}, {status:502});
  }
}
