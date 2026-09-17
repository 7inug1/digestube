import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { setShareName, shareOf, startShare, stopShare } from "@/lib/store";

/** 공유 주소 한 조각을 만든다. 짧고, 훑어봐도 다음 주소를 못 지어내야 한다. */
function newShareId(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789"; // 헷갈리는 l·o·0·1 은 뺀다
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => abc[b % abc.length]).join("");
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ shareId: null, name: null });
  const now = await shareOf(user.id);
  if (!now) return NextResponse.json({ shareId: null, name: null });
  // 예전에 켜 둔 공유는 이름이 비어 있다. 읽을 때 채워 둔다 — 끄고 다시 켜게 하지 않는다.
  const name = now.name ?? defaultName(user.email);
  if (!now.name && name) await setShareName(user.id, name);
  return NextResponse.json({ shareId: now.shareId, name });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const shareId = await startShare(user.id, newShareId());
  // 이름은 메일 주소 앞부분으로 정해진다. 따로 묻지 않는다 — 공유를 켜려다 이름부터
  // 정하게 하면 손이 한 번 더 가고, 대부분은 어차피 그대로 둔다.
  // 주소 전체를 쓰지는 않는다 — 공유 주소는 누구나 열 수 있어서 메일 주소가 그대로
  // 공개되고 수집 봇도 긁어 간다. 앞부분만으로는 주소로 쓸 수 없다.
  const now = await shareOf(user.id);
  const name = now?.name ?? defaultName(user.email);
  if (!now?.name && name) await setShareName(user.id, name);
  return NextResponse.json({ shareId, name });
}

/** "7inug1@gmail.com" → "7inug1". 사람 이름처럼 보이지 않으면 비운다. */
function defaultName(email: string | null): string | null {
  const head = (email ?? "").split("@")[0].trim().slice(0, 20);
  return head.length >= 2 ? head : null;
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  await stopShare(user.id);
  return NextResponse.json({ ok: true });
}
