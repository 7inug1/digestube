"use client";

import Link from "next/link";
import { useState } from "react";

export type FoundHit = {
  video_id: string; seq: number; t: number; text: string; score: number;
  hl?: string; title: string; channel: string; duration: number;
};

const mm = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 관련 문장 앞뒤를 함께 읽을 수 있는 짧은 원문 조각. */
function excerpt(text: string, highlight?: string, around = 48) {
  if (!highlight) return { text: text.slice(0, 190), clipped: text.length > 190 };
  const at = text.indexOf(highlight);
  if (at < 0) return { text: text.slice(0, 190), clipped: text.length > 190 };
  const from = Math.max(0, at - around);
  const to = Math.min(text.length, at + highlight.length + around);
  return { text: text.slice(from, to), clipped: from > 0 || to < text.length };
}

function Highlighted({text, highlight}: {text:string; highlight?:string}) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <>{text}</>;
  return <>{text.slice(0,at)}<mark className="rounded-[3px] bg-keep/55 px-0.5 font-semibold text-fg
    decoration-fg/70 decoration-[1.5px] underline underline-offset-[3px]">{highlight}</mark>{text.slice(at+highlight.length)}</>;
}

/** 찾은 결과 한 건.
 *
 *  관련 문장만 떼면 왜 나온 결과인지 이해하기 어렵다. 기본 화면에도 앞뒤 문맥을
 *  함께 보여주고, 관련 문장은 형광펜과 밑줄로 구분한다.
 */
export default function Found({ hit }: { hit: FoundHit }) {
  const [open, setOpen] = useState(false);
  const at = hit.duration ? hit.t / hit.duration : 0;
  const where = at < 0.34 ? "앞부분" : at < 0.67 ? "중간" : "뒷부분";
  const preview = excerpt(hit.text, hit.hl);
  const shown = open ? hit.text : preview.text;

  return (
    <article className="rounded-xl border border-line p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <img src={`https://i.ytimg.com/vi/${hit.video_id}/mqdefault.jpg`} alt="" loading="lazy"
             className="h-[42px] w-[74px] shrink-0 rounded-md bg-muted object-cover" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{hit.title}</div>
          <div className="mt-0.5 text-[11px] text-mfg">{hit.channel}</div>
        </div>
      </div>

      <p className="mb-1.5 text-[11px] font-medium text-mfg">관련 대목</p>
      <p className="text-[15px] leading-[1.9] tracking-[-.012em] text-fg">
        {!open && preview.clipped && preview.text !== hit.text.slice(0,preview.text.length) && "…"}
        <Highlighted text={shown} highlight={hit.hl} />
        {!open && preview.clipped && "…"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
        <span className="flex items-center gap-2 text-[11px] text-mfg" title={`영상 ${where}`}>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono tabular-nums">{mm(hit.t)}</span>
          {/* 영상 어디쯤인지 — 목록만 봐도 앞뒤를 가늠하게 */}
          <span className="relative block h-[3px] w-16 rounded bg-muted">
            <span className="absolute top-0 h-[3px] w-[3px] rounded bg-fg"
                  style={{ left: `${Math.min(97, at * 100)}%` }} />
          </span>
          {where}
        </span>
        {preview.clipped && <button onClick={() => setOpen(!open)} aria-expanded={open}
                className="text-[12px] text-mfg underline underline-offset-2 hover:text-fg">
          {open ? "문단 접기" : "문단 전체 보기"}
        </button>}
        {/* 영상은 이 사이트 안에 그대로 붙어 있다. 유튜브로 내보내지 않는다 */}
        <Link href={`/videos/${hit.video_id}#ck${hit.seq}`}
              className="text-[12px] text-mfg hover:text-fg">
          전사문에서 보기 →
        </Link>
      </div>
    </article>
  );
}
