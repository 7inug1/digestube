import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Digestube",
  description: "유튜브 영상을 목차·스크립트로 정리해 읽고, 내용을 바로 물어볼 수 있는 서비스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen text-[15px] leading-[1.7]">
        {/* 헤더와 본문이 같은 max-width 를 써야 화면이 넓을 때 왼쪽 시작선이 맞는다 */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1320px] items-center gap-4 px-5 py-3">
            <Link href="/" className="shrink-0 text-[19px] font-bold tracking-[-.01em]">
              Digestube
            </Link>
            <Link href="/search" className="ml-auto text-[13.5px] text-mfg hover:text-fg">
              검색
            </Link>
            <Link href="/videos" className="text-[13.5px] text-mfg hover:text-fg">
              라이브러리
            </Link>
          </div>
        </header>
        {/* 폭은 화면마다 다르다 — 영상 화면은 2단이라 더 넓다 */}
        <main className="px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
