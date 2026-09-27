import { saySorry } from "@/lib/errors";
import { NextResponse } from "next/server";
import { embed } from "@/lib/embed";
import { searchText } from "@/lib/context";
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
      // 문맥 줄(영상 제목·채널·요지·목차)을 붙여 임베딩한다. 목차·요약은 이 단계 전에 만들어진다(ingest-client 순서)
      const vectors = await embed(todo.map(c=>searchText({title:v.title,channel:v.channel,tldr:v.tldr,outline:v.outline},c)));
      await saveEmbeddingBatch(vid,v.revision ?? null,todo.map((c,i)=>({seq:c.seq,vector:vectors[i]})));
    }
    await refreshVideoStatus(vid,v.revision ?? null);
    const left = (await chunksWithoutEmbedding(vid)).length;
    return NextResponse.json({vid,done:todo.length,left});
  } catch(e) {
    return NextResponse.json({error: saySorry(e, "embed")}, {status:502});
  }
}
