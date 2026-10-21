import { notFound } from "next/navigation";
import { getVideo } from "@/lib/store";
import { about, countText, meta, whenText } from "@/lib/youtube";
import { readTime } from "@/lib/format";
import Reader from "@/components/Reader";
import Building from "@/components/Building";
import KeepInBrowser from "@/components/KeepInBrowser";
import { currentUser } from "@/lib/auth/server";
import { addToLibrary } from "@/lib/store";
import { keepOnOpen } from "@/lib/keep";

export const dynamic = "force-dynamic";

/* 링크로 건네는 페이지라 미리보기가 떠야 한다. 서버에서 제목을 채운다. */
export async function generateMetadata({ params }: { params: Promise<{ vid: string }> }) {
  const { vid } = await params;
  const m = await meta(vid);
  return { title: m ? `${m.title} · Digestube` : "Digestube" };
}

export default async function Video({
  params, searchParams,
}: {
  params: Promise<{ vid: string }>;
  searchParams: Promise<{ convert?: string }>;
}) {
  const { vid } = await params;
  const { convert } = await searchParams;
  const [v, m, a] = await Promise.all([getVideo(vid), meta(vid), about(vid)]);

  // 아직 문단이 없으면 만들어지는 중이다. 랜딩에서 넘어온 길(convert=1)이거나
  // 이미 자리를 잡아 둔 영상일 때만 시작한다 — 주소만 찍어 넣는다고 변환이
  // 시작되면 누구나 남의 지갑으로 모델을 돌릴 수 있다.
  const building = !v?.chunks.length;
  if (building && !(convert === "1" || v)) notFound();
  if (building) {
    if (!m) notFound(); // 유튜브에 없는 영상
    return <Building vid={vid} title={a?.title ?? m.title} channel={a?.channel ?? m.channel}
                     avatar={a?.avatar ?? null} />;
  }

  // 랜딩에서 넣은 완성된 영상은 여기서 담는다. 변환을 거치지 않으니 담는 곳이 여기뿐이다.
  const user = convert === "1" ? await currentUser() : null;
  const keep = keepOnOpen({ convert, ready: true, signedIn: Boolean(user) });
  // 담기에 실패해도 읽기는 막지 않는다. 다음에 다시 넣으면 그때 담긴다.
  if (keep === "account" && user) await addToLibrary(user.id, [vid]).catch(e => console.error("addToLibrary failed:", e));

  return (
    <>
    {keep === "browser" && <KeepInBrowser vid={vid} />}
    <Reader
      vid={vid}
      chunks={v!.chunks}
      outline={v!.outline ?? []}
      meta={{
        title: m?.title ?? v!.title ?? vid,
        channel: m?.channel ?? "채널 미확인",
        seconds: v!.chunks.at(-1)?.t_end ?? 0,
        read: readTime(v!.chars ?? 0),
        mode: v!.mode, lang: v!.lang,
        avatar: a?.avatar ?? null,
        published: a?.published ? whenText(a.published) : null,
        views: a?.views ? countText(a.views) : null,
        tldr: v!.tldr ?? null,
      }}
    />
    </>
  );
}
