import Link from "next/link";
import VideoCard, { type Card } from "@/components/VideoCard";
import { listVideos, statsOf } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { readTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Videos() {
  const videos = await listVideos();
  if (!videos.length) {
    return <p className="mx-auto max-w-[1320px]">아직 없다. <Link href="/" className="underline">넣으러 가기 →</Link></p>;
  }

  // 제목·채널은 유튜브에서, 문단 수와 길이는 저장소에서 한 번에
  const stats = await statsOf(videos.map((v) => v.id));
  const cards: Card[] = await Promise.all(videos.map(async (v) => {
    const m = await meta(v.id);
    return {
      id: v.id,
      title: m?.title ?? v.title ?? v.id,
      channel: m?.channel ?? "채널 미확인",
      status: v.status ?? "?",
      seconds: stats[v.id]?.seconds ?? 0,
      read: readTime(v.chars ?? 0),
      ready: (stats[v.id]?.chunks ?? 0) > 0,
    };
  }));

  return (
    <div className="mx-auto max-w-[1320px]">
      <h1 className="mb-6 text-[22px] font-[660] tracking-[-.03em]">라이브러리</h1>
      {/* 열 수를 정하지 않는다. 220px 이상 들어가는 만큼 채우고 남는 폭은 카드가 나눠 갖는다 —
          카드 폭을 못박아 두면 넓은 화면에서 오른쪽이 비고, 좁은 화면에서 한 줄에 하나만 남는다.
          폰에서만 두 열로 고정한다. auto-fill 로 두면 한 열이 돼 썸네일이 화면을 다 먹는다. */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {cards.map((v) => <VideoCard key={v.id} v={v} />)}
      </div>
    </div>
  );
}
