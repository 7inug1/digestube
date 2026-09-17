import Link from "next/link";
import { notFound } from "next/navigation";
import VideoThumb from "@/components/VideoThumb";
import { libraryIds, statsOf, userByShare, videosByIds } from "@/lib/store";
import { readTime } from "@/lib/format";
import { meta, thumb } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/** 남의 라이브러리를 보는 화면. 읽기만 한다 — 빼기도, 담기도 없다.
 *  공유를 끄면 share_id 로 주인을 못 찾아 404 가 된다. */
export default async function Shared({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await userByShare(id);
  if (!owner) notFound();

  const ids = await libraryIds(owner);
  const videos = await videosByIds(ids);
  const stats = await statsOf(videos.map(v => v.id));
  const cards = await Promise.all(videos
    .filter(v => (stats[v.id]?.chunks ?? 0) > 0)
    .map(async v => {
      const [m, src] = await Promise.all([meta(v.id), thumb(v.id)]);
      return {
        id: v.id, src,
        title: m?.title ?? v.title ?? v.id,
        channel: m?.channel ?? "채널 미확인",
        seconds: stats[v.id]?.seconds ?? 0,
        note: `${readTime(v.chars ?? 0)} 분량`,
      };
    }));

  return (
    <div className="mx-auto max-w-[1320px]">
      <h1 className="mb-1 text-[22px] font-[660] tracking-[-.03em]">공유된 라이브러리</h1>
      <p className="mb-6 text-small text-mfg">
        누군가 읽으려고 모아 둔 영상이에요. 눌러서 바로 읽을 수 있어요.
      </p>

      {cards.length === 0 ? (
        <p className="py-10 text-small text-mfg">아직 담긴 영상이 없어요.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {cards.map(v => (
            <Link key={v.id} href={`/videos/${v.id}`} className="group block">
              <VideoThumb v={v} />
            </Link>
          ))}
        </div>
      )}

      <p className="mt-10 text-small text-mfg">
        <Link href="/" className="font-semibold underline">나도 영상을 글로 바꿔보기 →</Link>
      </p>
    </div>
  );
}
