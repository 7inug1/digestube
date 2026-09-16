"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import VideoThumb from "./VideoThumb";

export type Card = {
  id: string; title: string; channel: string;
  status: string; seconds: number; read: string; ready: boolean;
};

/** 라이브러리 카드. 유튜브 라이브러리처럼 큰 썸네일이 위, 글은 아래.
 *
 *  지우기를 붙인 이유: 전사가 중간에 끊기면 문단이 없는 행이 남는데,
 *  그건 열어도 볼 것이 없어서 목록에서 치울 수 있어야 한다. */
export default function VideoCard({ v }: { v: Card }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function remove() {
    setBusy(true);
    await fetch(`/api/videos/${v.id}`, { method: "DELETE" });
    router.refresh();
  }

  const inner = (
    <VideoThumb v={{
      id: v.id, title: v.title, channel: v.channel, seconds: v.seconds,
      note: v.ready ? `${v.read} 분량` : v.status,
    }} />
  );

  return (
    <div className="group relative">
      {v.ready
        ? <Link href={`/videos/${v.id}`} className="block">{inner}</Link>
        : <div className="opacity-50">{inner}</div>}

      <button onClick={() => setAsking(true)} aria-label="라이브러리에서 빼기" title="라이브러리에서 빼기"
              className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-md
                         bg-black/60 text-[13px] leading-none text-white opacity-0 transition
                         hover:bg-black/80 group-hover:opacity-100">
        ✕
      </button>

      {/* 되돌릴 수 없는 일이라 물어본다. 브라우저 기본 창은 이 앱 생김새와
          따로 놀아서 뜬금없어 보인다 */}
      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-5 backdrop-blur-[3px]"
             onClick={() => !busy && setAsking(false)}>
          <div onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true"
               className="w-full max-w-[360px] rounded-xl border border-line bg-bg p-5 shadow-2xl">
            <h3 className="mb-1.5 text-[15px] font-semibold">라이브러리에서 뺄까요?</h3>
            <p className="mb-4 text-[13px] leading-[1.6] text-mfg">
              전사문·목차도 같이 지워집니다. 다시 넣으려면 전사를 새로 해야 합니다.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAsking(false)} disabled={busy}
                      className="h-8 rounded-md border border-line px-3 text-[12.5px] font-medium">
                취소
              </button>
              <button onClick={remove} disabled={busy}
                      className="h-8 rounded-md bg-red-500 px-3 text-[12.5px] font-medium text-white">
                {busy ? "지우는 중…" : "빼기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
