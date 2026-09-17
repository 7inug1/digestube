import { NextResponse } from "next/server";
import { embed } from "@/lib/embed";
import { chunksWithoutEmbedding, getVideo, refreshVideoStatus, saveEmbeddingBatch } from "@/lib/store";

/** outline 과 같다 — 벡터가 없는 문단만 처리하므로 반복해 불러도 총량이 영상 하나
 *  분량을 넘지 않는다. 그래서 잠그지 않았다. */
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const {vid} = await req.json();
    if (typeof vid !== "string") return NextResponse.json({error:"영상 번호가 필요합니다."}, {status:400});
    const v = await getVideo(vid);
    if (!v) return NextResponse.json({error:"없는 영상입니다."}, {status:404});
    const todo = (await chunksWithoutEmbedding(vid)).slice(0,16);
    if (todo.length) {
      const vectors = await embed(todo.map(c=>c.text));
      await saveEmbeddingBatch(vid,v.revision ?? null,todo.map((c,i)=>({seq:c.seq,vector:vectors[i]})));
    }
    await refreshVideoStatus(vid,v.revision ?? null);
    const left = (await chunksWithoutEmbedding(vid)).length;
    return NextResponse.json({vid,done:todo.length,left});
  } catch(e) {
    return NextResponse.json({error:(e as Error).message}, {status:502});
  }
}
