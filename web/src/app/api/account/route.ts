import { NextResponse } from "next/server";
import { currentUser, serverClient } from "@/lib/auth/server";
import { deleteAccountData } from "@/lib/store";
import { db } from "@/lib/supabase";
import { saySorry } from "@/lib/errors";

/** 탈퇴. 되돌릴 수 없다.
 *
 *  딸린 기록을 먼저 지우고 계정은 마지막에 지운다. 순서가 반대면 계정이 먼저 사라진 뒤
 *  기록 지우기가 실패했을 때, 주인 없는 기록이 남고 그걸 지울 방법도 없어진다.
 *  이 순서면 중간에 실패해도 계정이 남아 있어 다시 누르면 된다.
 *
 *  GET 이 아니라 DELETE 다 — 링크 미리보기 봇이 주소를 열기만 해도 탈퇴되면 안 된다. */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  try {
    await deleteAccountData(user.id);
    const { error } = await db().auth.admin.deleteUser(user.id);
    if (error) throw error;
    // 쿠키에 남은 세션도 지운다. 계정은 없는데 로그인된 것처럼 보이면 안 된다.
    await (await serverClient()).auth.signOut().catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: saySorry(e, "account-delete") }, { status: 502 });
  }
}
