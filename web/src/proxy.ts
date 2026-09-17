import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { BROWSER_COOKIE } from "@/lib/limits";

/** 요청마다 세션 쿠키를 갱신한다. 액세스 토큰은 한 시간이면 만료되는데, 서버 컴포넌트는
 *  쿠키를 못 쓰니 여기서 새 토큰을 받아 응답 쿠키에 실어 보낸다.
 *  Next 16 부터 middleware 가 proxy 로 이름이 바뀌었다 — 하는 일은 같다. */
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({name, value}) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({name, value, options}) => res.cookies.set(name, value, options));
        },
      },
    },
  );
  // 부르기만 해도 만료된 토큰이 갱신된다. 결과는 안 쓴다.
  await supabase.auth.getUser();

  // 하루 상한을 셀 때 쓸 브라우저 표시. IP 만으로 세면 VPN 이나 데이터 껐다 켜기로
  // 초기화되고, 이것만으로 세면 쿠키를 지우면 그만이다. 둘 다 넘지 않아야 통과시킨다.
  // 사람을 알아보는 장치가 아니다 — 흔한 남용과 실수를 막는 선이고, 진짜 신원은 로그인이다.
  if (!req.cookies.get(BROWSER_COOKIE)) {
    res.cookies.set(BROWSER_COOKIE, crypto.randomUUID(), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export const config = {
  // 정적 파일과 이미지는 세션이 필요 없다
  matcher: ["/((?!_next/static|_next/image|shots/|icon|apple-icon|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
