import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { shareOf, startShare, stopShare } from "@/lib/store";

/** 공유 주소 한 조각을 만든다. 짧고, 훑어봐도 다음 주소를 못 지어내야 한다. */
function newShareId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789"; // 헷갈리는 l·o·0·1 은 뺀다
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => abc[b % abc.length]).join("");
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ shareId: null });
  return NextResponse.json({ shareId: await shareOf(user.id) });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  return NextResponse.json({ shareId: await startShare(user.id, newShareId()) });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  await stopShare(user.id);
  return NextResponse.json({ ok: true });
}
