import Link from "next/link";
import { currentUser } from "@/lib/auth/server";

/** 헤더 오른쪽 끝. 로그인 전엔 "로그인", 후엔 이메일과 로그아웃. */
export default async function AuthNav() {
  const user = await currentUser();
  const cls = "text-[14px] font-semibold text-fg/65 transition-colors hover:text-fg";
  if (!user) return <Link href="/login" className={cls}>로그인</Link>;
  return (
    <span className="flex items-center gap-3">
      <span className="hidden max-w-[180px] truncate text-[13px] text-mfg sm:inline" title={user.email ?? ""}>
        {user.email}
      </span>
      <form action="/auth/signout" method="post">
        <button type="submit" className={cls}>로그아웃</button>
      </form>
    </span>
  );
}
