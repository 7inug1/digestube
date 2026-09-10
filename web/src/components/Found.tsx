"use client";

import Link from "next/link";
import { useState } from "react";

export type FoundHit = {
  video_id: string; seq: number; t: number; text: string; score: number;
  hl?: string; title: string; channel: string; duration: number;
};

const mm = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 찾은 결과 한 건.
 *
 *  접혀 있을 때는 걸린 문장만 크게 보여준다 — 검색 결과에서 사람이 실제로 읽는
 *  것은 그 한 줄이고, 문단 전체는 확인하고 싶을 때만 편다.
 *  뜻으로 찾은 것이라 글자가 겹치지 않을 수 있어, 걸린 문장은 색이 아니라
 *  굵기 + 밑줄로 나타낸다(형광펜은 우리가 남긴 표시에만 쓴다).
 */
export default function Found({ hit }: { hit: FoundHit }) {
  const [open, setOpen] = useState(false);
  const at = hit.duration ? hit.t / hit.duration : 0;
  const where = at < 0.34 ? "앞부분" : at < 0.67 ? "중간" : "뒷부분";
  const parts = hit.hl ? hit.text.split(hit.hl) : [];

  return (
    <article className="border-t border-line py-6 first:border-0 first:pt-0">
      <div className="mb-3 flex items-center gap-3">
        <img src={`https://i.ytimg.com/vi/${hit.video_id}/mqdefault.jpg`} alt="" loading="lazy"
             className="h-[36px] w-[64px] shrink-0 rounded-md bg-muted object-cover" />
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium">{hit.title}</div>
          <div className="text-[11px] text-mfg">{hit.channel}</div>
        </div>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-mfg">
          {hit.score.toFixed(3)}
        </span>
      </div>

      {open ? (
        <p className="max-w-[42ch] text-[15px] leading-[1.9] tracking-[-.012em] text-mfg">
          {parts.length > 1 ? (
            <>
              {parts[0]}
              <mark className="bg-transparent font-[650] text-fg underline decoration-[1.5px] underline-offset-[3px]">
                {hit.hl}
              </mark>
              {parts.slice(1).join(hit.hl)}
            </>
          ) : hit.text}
        </p>
      ) : (
        <p className="max-w-[38ch] text-[16.5px] leading-[1.85] tracking-[-.014em]">
          {hit.hl ? (
            <mark className="bg-transparent font-[650] text-inherit underline decoration-[1.5px] underline-offset-[3px]">
              {hit.hl}
            </mark>
          ) : hit.text.slice(0, 90) + "…"}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 text-[11px] text-mfg">
          <span className="font-mono">{mm(hit.t)}</span>
          {/* 영상 어디쯤인지 — 목록만 봐도 앞뒤를 가늠하게 */}
          <span className="relative block h-[3px] w-16 rounded bg-muted">
            <span className="absolute top-0 h-[3px] w-[3px] rounded bg-fg"
                  style={{ left: `${Math.min(97, at * 100)}%` }} />
          </span>
          {where}
        </span>
        <button onClick={() => setOpen(!open)} aria-expanded={open}
                title={open ? "앞뒤 접기" : "앞뒤 더 읽기"}
                className="grid h-8 w-8 place-items-center rounded border border-line text-mfg hover:bg-muted hover:text-fg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {open ? <><path d="m7 11 5-5 5 5" /><path d="m7 18 5 5 5-5" /></>
                  : <><path d="m7 6 5 5 5-5" /><path d="m7 23 5-5 5 5" /></>}
          </svg>
        </button>
        {/* 영상은 이 사이트 안에 그대로 붙어 있다. 유튜브로 내보내지 않는다 */}
        <Link href={`/videos/${hit.video_id}#ck${hit.seq}`}
              className="text-[12px] text-mfg hover:text-fg">
          이 대목 읽기
        </Link>
      </div>
    </article>
  );
}
