"use client";

import { useEffect, useRef, useState } from "react";

/** 헤더 오른쪽 끝의 내 자리.
 *
 *  예전엔 이메일 전체와 "로그아웃"이 나란히 있었다. 주소가 길면 헤더가 그것만으로
 *  꽉 차고, 로그아웃은 하루에 한 번 쓸까 말까 한 것인데 늘 자리를 차지했다.
 *  동그라미 하나로 줄이고, 눌렀을 때만 주소와 로그아웃을 편다 — 자주 쓰는 것은 작게,
 *  가끔 쓰는 것은 한 번 더 눌러서.
 */
export default function UserMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const mark = (email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
              aria-label={email ?? "내 계정"}
              className="grid h-7 w-7 place-items-center rounded-full bg-fg text-[12px]
                         font-bold text-bg transition hover:opacity-80">
        {mark}
      </button>

      {open && (
        <div role="menu"
             className="absolute right-0 top-9 z-50 w-[220px] rounded-xl border border-line
                        bg-bg p-1.5 shadow-xl">
          {/* 주소는 누른 사람만 본다. 여기서도 한 줄로 자른다 — 긴 주소가 칸을 늘리면
              메뉴가 화면 밖으로 밀린다. */}
          <p className="truncate px-2.5 py-2 text-label text-mfg" title={email ?? ""}>{email}</p>
          <div className="my-1 h-px bg-line" />
          <form action="/auth/signout" method="post">
            <button type="submit" role="menuitem"
                    className="w-full rounded-lg px-2.5 py-2 text-left text-small font-medium
                               transition hover:bg-muted">
              로그아웃
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
