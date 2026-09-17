import { notFound } from "next/navigation";
import Link from "next/link";
import VideoThumb from "@/components/VideoThumb";
import IngestForm from "@/components/IngestForm";
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

  const ids = await libraryIds(owner.userId);
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
      {/* 이름을 정해 둔 사람만 이름이 보인다. 정하지 않았으면 이름 없이 둔다 —
          이메일을 대신 쓰지 않는다. 본인이 정한 적 없는 정보를 공개 페이지에 올리는 셈이다. */}
      <h1 className="mb-1 text-[22px] font-[660] tracking-[-.03em]">
        {owner.name ? `${owner.name}님의 라이브러리` : "공유된 라이브러리"}
      </h1>
      <p className="mb-6 text-small text-mfg">
        {owner.name
          ? `${owner.name}님이 읽으려고 모아 둔 영상이에요. 눌러서 바로 읽어보세요.`
          : "누군가 읽으려고 모아 둔 영상이에요. 눌러서 바로 읽어보세요."}
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

      {/* 여기 온 사람은 대개 이 서비스를 처음 본다. 남의 라이브러리를 보고 "나도 되나"
          하는 순간이 바로 이 자리에서 생기므로, 링크로 넘기지 않고 넣는 칸을 바로 둔다.
          내 라이브러리에는 두지 않는다 — 넣는 법을 이미 아는 사람이고, 구경하는 자리에
          권유가 섞이면 목록이 목록으로 안 읽힌다. */}
      <div className="mx-auto mt-16 max-w-[520px] border-t border-line pt-10 text-center">
        <p className="mb-5 text-[19px] font-[740] leading-[1.4] tracking-[-.03em] sm:text-[22px]">
          이런 라이브러리 한 번 만들어보실래요?
        </p>
        <IngestForm />
      </div>
    </div>
  );
}
