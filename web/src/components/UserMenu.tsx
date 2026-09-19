"use client";

import { useEffect, useRef, useState } from "react";
import { clearMine } from "@/lib/mine";

/** 헤더 오른쪽 끝의 내 자리.
 *
 *  예전엔 이메일 전체와 "로그아웃"이 나란히 있었다. 주소가 길면 헤더가 그것만으로
 *  꽉 차고, 로그아웃은 하루에 한 번 쓸까 말까 한 것인데 늘 자리를 차지했다.
 *  동그라미 하나로 줄이고, 눌렀을 때만 주소와 로그아웃을 편다 — 자주 쓰는 것은 작게,
 *  가끔 쓰는 것은 한 번 더 눌러서.
 */
export default function UserMenu({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  /** 탈퇴를 묻는 창. 메뉴와 따로 둔다 — 되돌릴 수 없는 일이라 한 번 더 멈춰 세운다. */
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function leave() {
    setBusy(true); setErr("");
    const r = await fetch("/api/account", { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErr(d.error ?? "탈퇴하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      setBusy(false);
      return;
    }
    // 이 브라우저에 남은 목록도 비운다 — 탈퇴했는데 목록이 그대로 보이면 안 지워진 줄 안다
    clearMine();
    location.href = "/";
  }
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
          {/* 탈퇴는 맨 아래, 옅게. 자주 누를 일이 아니고 실수로 누르면 안 되지만,
              찾을 수 없게 숨기면 그건 또 다른 문제다. */}
          <button onClick={() => { setOpen(false); setAsking(true); }} role="menuitem"
                  className="w-full rounded-lg px-2.5 py-2 text-left text-label text-mfg
                             transition hover:bg-muted hover:text-red-500">
            탈퇴하기
          </button>
        </div>
      )}

      {asking && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 px-5 backdrop-blur-[3px]"
             onClick={() => !busy && setAsking(false)}>
          <div onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true"
               aria-labelledby="leave-title"
               className="w-full max-w-[360px] rounded-xl border border-line bg-bg p-5 shadow-2xl">
            <h3 id="leave-title" className="mb-2 text-[15px] font-semibold">탈퇴할까요?</h3>
            {/* 무엇이 지워지고 무엇이 남는지 둘 다 말한다. "모든 데이터가 삭제됩니다"는
                겁만 주고 실제로 무슨 일이 일어나는지는 알려주지 않는다. */}
            <ul className="mb-4 grid gap-1 text-[13px] leading-[1.6] text-mfg">
              <li>· 계정과 담아 둔 목록, 공유 링크가 지워져요</li>
              <li>· 되돌릴 수 없어요. 같은 이메일로 다시 가입할 수는 있어요</li>
            </ul>
            {err && <p role="alert" className="mb-3 text-[13px] text-red-500">{err}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAsking(false)} disabled={busy}
                      className="h-9 rounded-lg border border-line px-3.5 text-[13px] font-medium">
                취소
              </button>
              <button onClick={leave} disabled={busy}
                      className="h-9 rounded-lg bg-red-500 px-3.5 text-[13px] font-semibold text-white
                                 disabled:opacity-60">
                {busy ? "지우는 중…" : "탈퇴하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
