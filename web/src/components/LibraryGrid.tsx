"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import VideoThumb from "./VideoThumb";
import { forget, mine } from "@/lib/mine";
import type { Card } from "@/app/api/library/route";

/** 내 라이브러리. 로그인했으면 계정 목록을, 아니면 이 브라우저 목록을 보여준다.
 *  어느 쪽이든 /api/library 가 같은 모양으로 돌려주므로 화면은 구분하지 않는다.
 *  브라우저 목록은 서버가 모르니 화면이 뜬 뒤에 가져온다. */
export default function LibraryGrid({ signedIn }: { signedIn: boolean }) {
  const [cards, setCards] = useState<Card[] | null>(null);

  useEffect(() => {
    let alive = true;
    // 브라우저 목록(localStorage)은 서버가 모른다. 화면이 뜬 뒤에 실어 보낸다.
    const qs = signedIn ? "" : `?ids=${encodeURIComponent(mine().join(","))}`;
    fetch(`/api/library${qs}`)
      .then(r => r.json())
      .then(d => { if (alive) setCards(d.cards ?? []); })
      .catch(() => { if (alive) setCards([]); });
    return () => { alive = false; };
  }, [signedIn]);

  async function remove(id: string) {
    await fetch(`/api/library?vid=${id}`, { method: "DELETE" });
    forget(id); // 로그인해도 지운다 — 예전에 이 브라우저에 남았을 수 있다
    setCards(c => (c ?? []).filter(v => v.id !== id));
  }

  if (cards === null) return <p className="text-small text-mfg">불러오는 중…</p>;

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
      {cards.map(v => <Item key={v.id} v={v} onRemove={() => remove(v.id)} />)}
    </div>
  );
}

function Item({ v, onRemove }: { v: Card; onRemove: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const inner = (
    <VideoThumb v={{ id: v.id, src: v.src, title: v.title, channel: v.channel,
                     seconds: v.seconds, note: v.ready ? v.note : "변환이 끝나지 않았어요" }} />
  );
  return (
    <div className="group relative">
      {v.ready
        ? <Link href={`/videos/${v.id}`} className="block">{inner}</Link>
        : <div className="opacity-50">{inner}</div>}

      {/* 맛보기는 누구에게나 보이는 것이라 뺄 수 없다. 표를 달아 내 것과 구분한다 */}
      {v.sample && (
        <span className="absolute left-2 top-2 rounded-md bg-bg/85 px-2 py-0.5
                         text-label font-semibold backdrop-blur">
          샘플
        </span>
      )}

      {!v.sample && <button onClick={() => setAsking(true)} aria-label="라이브러리에서 빼기" title="라이브러리에서 빼기"
              className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-md
                         bg-black/60 text-[13px] leading-none text-white opacity-0 transition
                         hover:bg-black/80 group-hover:opacity-100 focus-visible:opacity-100">
        ✕
      </button>}

      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-5 backdrop-blur-[3px]"
             onClick={() => !busy && setAsking(false)}>
          <div onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true"
               className="w-full max-w-[360px] rounded-xl border border-line bg-bg p-5 shadow-2xl">
            <h3 className="mb-1.5 text-[15px] font-semibold">라이브러리에서 뺄까요?</h3>
            {/* 예전엔 "전사문도 지워집니다" 였다. 이제 목록에서만 빠진다 —
                다시 담으면 변환 없이 바로 열린다. 겁줄 이유가 없어졌다. */}
            <p className="mb-4 text-[13px] leading-[1.6] text-mfg">
              내 목록에서만 빠져요. 다시 담으면 변환 없이 바로 볼 수 있어요.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAsking(false)} disabled={busy}
                      className="h-8 rounded-md border border-line px-3 text-[12.5px] font-medium">
                취소
              </button>
              <button onClick={() => { setBusy(true); onRemove(); }} disabled={busy}
                      className="h-8 rounded-md bg-fg px-3 text-[12.5px] font-medium text-bg">
                {busy ? "빼는 중…" : "빼기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
