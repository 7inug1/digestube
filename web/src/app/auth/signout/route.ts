import { NextResponse } from "next/server";
import { serverClient } from "@/lib/auth/server";

/** 로그아웃. GET 이 아니라 POST 다 — 링크 미리보기 봇이 주소를 열기만 해도
 *  로그아웃되면 안 된다. */
export async function POST(req: Request) {
  await (await serverClient()).auth.signOut();
  return NextResponse.redirect(new URL("/", new URL(req.url).origin), { status: 303 });
}
