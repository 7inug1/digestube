import { NextResponse } from "next/server";
import { serverClient } from "@/lib/auth/server";

/** 메일의 링크가 여기로 온다. code 를 세션으로 바꾸고 원래 가려던 곳으로 보낸다. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const next = u.searchParams.get("next") ?? "/";
  if (code) {
    const { error } = await (await serverClient()).auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, u.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", u.origin));
}
