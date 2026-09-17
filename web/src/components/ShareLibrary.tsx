"use client";

import { useEffect, useRef, useState } from "react";

/** 라이브러리 공유 — 제목 옆 아이콘 하나.
 *
 *  예전엔 "라이브러리 공유 링크 만들기"라는 글자 버튼이 목록 위 한 줄을 통째로 쓰고,
 *  켜면 주소창·복사·끄기가 또 한 줄로 늘어났다. 매일 쓰는 것도 아닌데 늘 자리를 차지했다.
 *  아이콘으로 접고, 눌렀을 때만 스위치와 주소를 편다.
 *
 *  스위치를 쓴 이유는 이것이 "켜짐/꺼짐"이기 때문이다. "만들기"라는 말은 한 번 하면
 *  끝나는 일처럼 들리는데, 공유는 언제든 되돌리는 것이고 그게 보여야 한다.
 */
export default function ShareLibrary() {
  const [open, setOpen] = useState(false);
  const [shareId, setShareId] = useState<string | null>(null);
  /** 공유 화면에 뜨는 이름. 메일 주소 앞부분으로 서버가 정한다 — 여기서 고치지 않는다. */
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/library/share").then(r => r.json())
      .then(d => { if (alive) { setShareId(d.shareId ?? null); setName(d.name ?? null); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const on = Boolean(shareId);

  async function toggle() {
    setBusy(true);
    const r = await fetch("/api/library/share", { method: on ? "DELETE" : "POST" });
    const d = await r.json().catch(() => ({}));
    setShareId(on ? null : (d.shareId ?? null));
    setName(on ? null : (d.name ?? null));
    setCopied(false);
    setBusy(false);
  }

  const url = shareId ? `${location.origin}/l/${shareId}` : "";

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}
              aria-label={on ? "공유 중 — 설정 열기" : "라이브러리 공유"}
              title={on ? "공유 중" : "라이브러리 공유"}
              className={`grid h-8 w-8 place-items-center rounded-lg transition
                          ${on ? "bg-fg text-bg" : "text-mfg hover:bg-muted hover:text-fg"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label="라이브러리 공유"
             className="absolute left-0 top-10 z-50 w-[300px] rounded-xl border border-line
                        bg-bg p-3.5 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-small font-semibold">라이브러리 공유</p>
              <p className="mt-0.5 text-label text-mfg">
                {on
                  ? `${name ?? "내"}님의 라이브러리로 보여요`
                  : "켜면 공유 링크가 생겨요"}
              </p>
            </div>
            {/* 스위치. 켜짐·꺼짐이 한눈에 보이고, 되돌릴 수 있다는 것도 모양이 말한다. */}
            <button onClick={toggle} disabled={busy} role="switch" aria-checked={on}
                    aria-label="라이브러리 공유"
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors
                                disabled:opacity-50 ${on ? "bg-fg" : "bg-line"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-bg shadow transition-[left]
                                ${on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>

          {on && (
            <>
            <div className="mt-3 flex gap-2">
              <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="공유 주소"
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-2.5
                           text-label outline-none" />
              <button onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); }}
                className="h-9 shrink-0 rounded-lg bg-fg px-3 text-label font-semibold text-bg">
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
