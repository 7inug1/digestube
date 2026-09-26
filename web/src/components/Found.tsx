"use client";

import Link from "next/link";

export type FoundHit = {
  video_id: string; seq: number; t: number; text: string; score: number;
  hl?: string; title: string; channel: string; duration: number;
  /** 질문과의 관련도(리랭커 점수). 받지 못했으면 없다 */
  rerank_score?: number;
};

const mm = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Highlighted({text, highlight}: {text:string; highlight?:string}) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <>{text}</>;
  return <>{text.slice(0,at)}<mark className="rounded-[3px] bg-keep/55 px-0.5 font-semibold text-fg
    decoration-fg/70 decoration-[1.5px] underline underline-offset-[3px]">{highlight}</mark>{text.slice(at+highlight.length)}</>;
}

/** 같은 영상에서 찾은 문단을 카드 하나에 모아 보여준다. */
export default function Found({ hits, showScore }: { hits: FoundHit[]; showScore?: boolean }) {
  const first = hits[0];
  if (!first) return null;

  return (
    <article className="rounded-xl border border-line p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <img src={`https://i.ytimg.com/vi/${first.video_id}/mqdefault.jpg`} alt="" loading="lazy"
             className="h-[42px] w-[74px] shrink-0 rounded-md bg-muted object-cover" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{first.title}</div>
          <div className="mt-0.5 text-[11px] text-mfg">{first.channel}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-5">
        {hits.map((hit, index) => {
          const at = hit.duration ? hit.t / hit.duration : 0;
          const where = at < 0.34 ? "앞부분" : at < 0.67 ? "중간" : "뒷부분";
          return <section key={`${hit.video_id}:${hit.seq}`}
                          className={index ? "border-t border-line pt-5" : ""}>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-mfg">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono tabular-nums">{mm(hit.t)}</span>
              <span>{where}</span>
              {showScore && hit.rerank_score !== undefined && <span>· 관련도 점수 {hit.rerank_score.toFixed(1)}</span>}
            </div>
            <p className="text-[15px] leading-[1.9] tracking-[-.012em] text-fg">
              <Highlighted text={hit.text} highlight={hit.hl} />
            </p>
            <Link href={`/videos/${hit.video_id}#ck${hit.seq}`}
                  className="mt-2.5 inline-block text-[12px] text-mfg hover:text-fg">
              전사문에서 보기 →
            </Link>
          </section>;
        })}
      </div>
    </article>
  );
}
