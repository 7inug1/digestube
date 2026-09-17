"use client";

import { createBrowserClient } from "@supabase/ssr";

/** 브라우저에서 쓰는 Supabase. anon 키는 공개해도 되는 키다 — 행 수준 보안(RLS)이
 *  막아 주고, 우리 테이블은 정책이 없어서 anon 으로는 아무것도 못 읽는다.
 *  로그인(매직링크 보내기)에만 쓴다. */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
