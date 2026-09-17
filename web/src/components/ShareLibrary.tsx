"use client";

import { useEffect, useState } from "react";

/** 라이브러리 공유 켜고 끄기.
 *
 *  기본은 꺼짐이다 — 무엇을 읽는지는 알려지면 되돌릴 수 없는 정보라, 켜는 것이
 *  사용자의 행동이어야 한다. 끄면 그 주소는 바로 죽는다. */
export default function ShareLibrary() {
  const [shareId, setShareId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/library/share")
      .then(r => r.json())
      .then(d => { if (alive) { setShareId(d.shareId ?? null); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  async function toggle() {
    const on = Boolean(shareId);
    const r = await fetch("/api/library/share", { method: on ? "DELETE" : "POST" });
    const d = await r.json().catch(() => ({}));
    setShareId(on ? null : (d.shareId ?? null));
    setCopied(false);
  }

  if (!loaded) return null;
  const url = shareId ? `${location.origin}/l/${shareId}` : "";

  return (
    <div className="mb-6">
      {shareId ? (
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={url} onFocus={e => e.currentTarget.select()} aria-label="공유 주소"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3 text-[13px] outline-none" />
          <button onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); }}
            className="h-9 shrink-0 rounded-lg bg-fg px-3 text-[13px] font-semibold text-bg">
            {copied ? "복사됨" : "복사"}
          </button>
          <button onClick={toggle} className="h-9 shrink-0 rounded-lg border border-line px-3 text-[13px] font-medium">
            공유 끄기
          </button>
        </div>
      ) : (
        <button onClick={toggle} className="text-small font-semibold underline">
          라이브러리 공유 링크 만들기
        </button>
      )}
      {shareId && (
        <p className="mt-2 text-label text-mfg">
          이 주소를 아는 사람은 담은 영상 목록을 볼 수 있어요. 끄면 바로 막혀요.
        </p>
      )}
    </div>
  );
}
