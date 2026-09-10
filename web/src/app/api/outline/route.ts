import { NextResponse } from "next/server";
import { label } from "@/lib/outline";
import { getVideo, refreshVideoStatus, saveOutlineBatch } from "@/lib/store";

// Four paragraphs at a time, each with at most two 20-second calls.
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const {vid} = await req.json();
    if (typeof vid !== "string") return NextResponse.json({error:"영상 번호가 필요합니다."}, {status:400});
    const v = await getVideo(vid);
    if (!v) return NextResponse.json({error:"없는 영상입니다."}, {status:404});
    if (!v.chunks.length) return NextResponse.json({error:"문단이 없습니다."}, {status:400});
    const completed = new Set(v.outline.map(o=>o.seq));
    const todo = v.chunks.filter(c=>!completed.has(c.seq));
    const items = await Promise.all(todo.slice(0,4).map(c=>label(c)));
    if (items.length) await saveOutlineBatch(vid,v.revision ?? null,items);
    await refreshVideoStatus(vid,v.revision ?? null);
    return NextResponse.json({vid,n:v.chunks.length,done:items.length,kept:completed.size+items.length,
      left:Math.max(0,todo.length-items.length),fallback:items.filter(o=>o.source === "fallback").length});
  } catch(e) {
    return NextResponse.json({error:(e as Error).message}, {status:502});
  }
}
