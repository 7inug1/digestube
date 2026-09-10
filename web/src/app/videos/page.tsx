import Link from "next/link";
import VideoCard, { type Card } from "@/components/VideoCard";
import { listVideos, statsOf } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { readTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Videos() {
  const videos = await listVideos();
  if (!videos.length) {
    return <p className="mx-auto max-w-[1040px]">아직 없다. <Link href="/" className="underline">넣으러 가기 →</Link></p>;
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
    <div className="mx-auto max-w-[1040px]">
      <h1 className="mb-6 text-[22px] font-[660] tracking-[-.03em]">라이브러리</h1>
      <div className="flex flex-wrap gap-x-5 gap-y-8">
        {cards.map((v) => <VideoCard key={v.id} v={v} />)}
      </div>
    </div>
  );
}
