import Link from "next/link";
import { currentUser } from "@/lib/auth/server";
import UserMenu from "./UserMenu";

/** 헤더 오른쪽 끝. 로그인 전엔 "로그인", 후엔 이메일과 로그아웃. */
export default async function AuthNav() {
  const user = await currentUser();
  const cls = "text-[14px] font-semibold text-fg/65 transition-colors hover:text-fg";
  if (!user) return <Link href="/login" className={cls}>로그인</Link>;
  return <UserMenu email={user.email} />;
}
