import { NextResponse } from "next/server";
import { embed } from "@/lib/embed";
import { chunksWithoutEmbedding, putEmbeddings, upsertVideo } from "@/lib/store";

/* 임베딩은 전사와 따로 부른다. 모델이 잠들면 첫 호출이 4.5초 걸리고 문단 수만큼
   호출이 곱해져 서버리스 60초 제한을 넘는다. 넣기와 붙여 두면 전사까지 같이
   실패하므로 여기서만 다룬다. 다시 불러도 이미 만든 문단은 건너뛴다. */
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { vid } = await req.json();
    const todo = await chunksWithoutEmbedding(vid);
    if (!todo.length) return NextResponse.json({ vid, done: 0, left: 0 });

    const vectors = await embed(todo.map((c) => c.text));
    await putEmbeddings(vid, todo.map((c, i) => ({ seq: c.seq, vector: vectors[i] })));

    const left = (await chunksWithoutEmbedding(vid)).length;
    if (!left) await upsertVideo({ id: vid, status: "완료" });
    return NextResponse.json({ vid, done: todo.length, left });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
