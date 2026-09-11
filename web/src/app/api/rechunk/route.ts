import { NextResponse } from "next/server";
import { chunk, stats } from "@/lib/chunker";
import { getRaw, rechunk } from "@/lib/store";

/** 저장된 원본으로 문단을 다시 나눈다.
 *
 *  전사를 다시 하지 않으므로 크레딧이 들지 않는다. 문단 나누는 방식을 고칠 때마다
 *  다시 전사하면 값이 드는데, 그 값 때문에 방식을 못 고치는 일이 없어야 한다.
 *
 *  문단이 바뀌면 목차와 벡터는 무효다. 저장소가 같이 지우고 revision 을 새로 주므로
 *  /api/embed 와 /api/outline 을 다시 불러야 한다. */
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { vid } = await req.json();
    if (typeof vid !== "string" || !vid) {
      return NextResponse.json({ error: "vid 가 필요하다" }, { status: 400 });
    }
    const raw = await getRaw(vid);
    if (!raw?.length) {
      return NextResponse.json(
        { error: "원본이 없다. 이 영상은 다시 전사해야 나눌 수 있다" }, { status: 409 });
    }
    const cs = chunk(raw);
    await rechunk(vid, crypto.randomUUID(), cs);
    return NextResponse.json({ vid, ...stats(cs) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
