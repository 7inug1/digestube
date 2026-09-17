import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** 서버 컴포넌트·라우트에서 쓰는 Supabase. 세션은 쿠키에 있다.
 *  service_role 이 아니라 anon 키다 — 데이터는 여전히 store.ts(service_role)가 읽고,
 *  이 클라이언트는 "지금 누가 로그인했나"만 안다. */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          // 서버 컴포넌트에서는 쿠키를 못 쓴다. 갱신은 proxy.ts 가 맡으니 여기선 삼킨다.
          try { list.forEach(({name, value, options}) => store.set(name, value, options)); } catch {}
        },
      },
    },
  );
}

export type User = { id: string; email: string | null };

/** 로그인한 사람. 없으면 null. getUser 는 토큰을 서버에서 검증한다 — getSession 은
 *  쿠키를 믿기만 해서 위조에 약하다. */
export async function currentUser(): Promise<User | null> {
  const { data } = await (await serverClient()).auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}
