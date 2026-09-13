import SearchForm from "@/components/SearchForm";
import Found, { type FoundHit } from "@/components/Found";
import { find } from "@/lib/search";
import { statsOf } from "@/lib/store";
import { meta } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export default async function Search({
  searchParams,
}: { searchParams: Promise<{ q?: string; vid?: string }> }) {
  const { q = "", vid } = await searchParams;

  let hits: FoundHit[] = [];
  let failed = "";
  if (q) {
    try {
      const raw = await find(q, vid);
      const vids = [...new Set(raw.map((h) => h.video_id))];
      // 제목·채널은 유튜브에서, 영상 길이는 저장소에서
      const [metas, stats] = await Promise.all([
        Promise.all(vids.map(async (v) => [v, await meta(v)] as const)),
        statsOf(vids),
      ]);
      const byVid = Object.fromEntries(metas);
      hits = raw.map((h) => ({
        ...h,
        title: byVid[h.video_id]?.title ?? h.video_id,
        channel: byVid[h.video_id]?.channel ?? "",
        duration: stats[h.video_id]?.seconds ?? 0,
      }));
    } catch (e) {
      failed = (e as Error).message;
    }
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <SearchForm q={q} />

      {!q && (
        <p className="mt-6 text-[13px] text-mfg">
          글자가 아니라 뜻으로 찾습니다. 영상에서 쓴 표현을 몰라도 됩니다.
        </p>
      )}
      {failed && <p className="mt-6 text-[13px] text-mfg">검색에 실패했습니다 — {failed}</p>}
      {q && !failed && (
        <p className="mt-6 text-[13px] text-mfg">
          “{q}”와 가장 가까운 대목 {hits.length}개{vid ? " · 이 영상 안에서" : ""}
        </p>
      )}

      <div className="mt-5 grid gap-3">
        {hits.map((h) => <Found key={`${h.video_id}:${h.seq}`} hit={h} />)}
      </div>
    </div>
  );
}
