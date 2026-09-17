import { notFound } from "next/navigation";
import { getVideo } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { readTime } from "@/lib/format";
import Reader from "@/components/Reader";
import AnonNotice from "@/components/AnonNotice";
import { currentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/* 링크로 건네는 페이지라 미리보기가 떠야 한다. 서버에서 제목을 채운다. */
export async function generateMetadata({ params }: { params: Promise<{ vid: string }> }) {
  const { vid } = await params;
  const m = await meta(vid);
  return { title: m ? `${m.title} · Digestube` : "Digestube" };
}

export default async function Video({ params }: { params: Promise<{ vid: string }> }) {
  const { vid } = await params;
  const [v, m, user] = await Promise.all([getVideo(vid), meta(vid), currentUser()]);
  if (!v) notFound();

  return (
    <>
      {!user && <AnonNotice />}
      <Reader
      vid={vid}
      chunks={v.chunks}
      outline={v.outline ?? []}
      meta={{
        title: m?.title ?? v.title ?? vid,
        channel: m?.channel ?? "채널 미확인",
        seconds: v.chunks.at(-1)?.t_end ?? 0,
        read: readTime(v.chars ?? 0),
        mode: v.mode, lang: v.lang,
      }}
      />
    </>
  );
}
