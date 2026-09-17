import { saySorry } from "@/lib/errors";
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

/** 관리용 문이다. 문단을 다시 나누면 목차와 벡터가 무효가 되고, 그걸 다시 만드는 데
 *  값이 든다 — 즉 아무나 부르면 남의 영상을 망가뜨리면서 우리 돈을 쓴다.
 *  ADMIN_TOKEN 이 없으면 아예 닫는다. 실수로 열린 채 배포되는 쪽이 더 나쁘다. */
function allowed(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  return req.headers.get("x-admin-token") === token;
}

export async function POST(req: Request) {
  if (!allowed(req)) return NextResponse.json({error:"권한이 없습니다."}, {status:403});
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
    return NextResponse.json({ error: saySorry(e, "rechunk") }, { status: 502 });
  }
}
