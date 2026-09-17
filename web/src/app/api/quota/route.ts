import { NextResponse } from "next/server";
import { ANON_DAY_SECONDS, quotaKeys, remaining } from "@/lib/limits";

/** 오늘 얼마나 남았나. 넣기 전에 보여주려고 둔다 —
 *  다 쓰고 나서 거절당하면 그때야 상한이 있다는 걸 알게 된다. */
export async function GET(req: Request) {
  return NextResponse.json({
    left: await remaining(quotaKeys(req)),
    max: ANON_DAY_SECONDS,
  });
}
