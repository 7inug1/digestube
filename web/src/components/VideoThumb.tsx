import { dur } from "@/lib/format";

export type Thumb = {
  id: string; title: string; channel: string;
  /** 영상 길이(초). 0 이면 배지를 숨긴다 — 모르는 값을 지어내지 않는다. */
  seconds: number;
  /** 채널 옆에 붙는 한마디. 목록은 상태, 랜딩은 읽는 데 걸리는 시간을 넣는다. */
  note: string;
  /** 썸네일 주소. 큰 자리에 쓸 때만 넘긴다 — 없으면 목록용 기본 크기를 쓴다. */
  src?: string;
};

/** 썸네일 + 제목 + 한 줄 메타. 라이브러리 카드와 랜딩 샘플이 같은 모양을 써야
 *  "라이브러리에서 본 그것"으로 읽힌다. 링크·지우기 같은 행동은 감싸는 쪽이 붙인다. */
export default function VideoThumb({ v }: { v: Thumb }) {
  return (
    <>
      <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-xl bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={v.src ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" loading="lazy"
             className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
        {v.seconds > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white">
            {dur(v.seconds)}
          </span>
        )}
      </div>
      <h3 className="mb-1 line-clamp-2 text-small font-semibold leading-[1.4] tracking-[-.015em]">
        {v.title}
      </h3>
      <div className="flex items-center gap-2 text-label text-mfg">
        <span className="truncate">{v.channel}</span>
        <span className="shrink-0 opacity-40">·</span>
        <span className="shrink-0">{v.note}</span>
      </div>
    </>
  );
}
