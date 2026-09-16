import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  // 링크를 공유하면 제목·설명이 미리보기로 뜬다. 없으면 주소만 덩그러니 간다.
  metadataBase: new URL("https://digestube.vercel.app"),
  title: {default: "Digestube", template: "%s · Digestube"},
  description: "나중에 볼 동영상, 이제 읽어보세요. 유튜브 링크를 넣으면 목차가 붙은 글이 돼요.",
  openGraph: {
    type: "website", siteName: "Digestube", locale: "ko_KR",
    title: "Digestube — 나중에 볼 동영상, 이제 읽어보세요",
    description: "유튜브 링크를 넣으면 목차가 붙은 글이 돼요. 요약이 아니라 말한 그대로예요.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex min-h-screen flex-col text-[15px] leading-[1.7]">
        {/* 헤더와 본문이 같은 max-width 를 써야 화면이 넓을 때 왼쪽 시작선이 맞는다 */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1320px] items-center gap-4 px-5 py-3">
            <Link href="/" className="shrink-0 text-[21px] font-extrabold tracking-[-.03em]">
              Digestube
            </Link>
            <Link href="/search" className="ml-auto text-[14px] font-semibold text-fg/65 transition-colors hover:text-fg">
              검색
            </Link>
            <Link href="/videos" className="text-[14px] font-semibold text-fg/65 transition-colors hover:text-fg">
              라이브러리
            </Link>
          </div>
        </header>
        {/* 폭은 화면마다 다르다 — 영상 화면은 2단이라 더 넓다 */}
        <main className="flex-1 px-5 py-8">{children}</main>
        {/* 푸터는 저작권 한 줄뿐. 연도는 빌드 때 찍힌다 — 해가 바뀌면 배포 한 번으로 따라온다. */}
        <footer className="mt-16 border-t border-line">
          <p className="px-5 py-6 text-center text-label text-mfg">
            © {new Date().getFullYear()} Digestube
          </p>
        </footer>
      </body>
    </html>
  );
}
