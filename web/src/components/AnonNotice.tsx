"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

const KEY = "digestube.anonNoticeClosed";

/** 로그인하지 않은 사람에게 한 번 알린다 — 이 영상은 지금 이 브라우저에서만 다시 찾을 수 있다.
 *
 *  "사라진다"고 쓰지 않는다. 영상은 서버에 남고, 못 찾는 것은 목록이 브라우저에만
 *  있기 때문이다. 겁주는 문구는 그 순간 먹히지만 틀린 말이라 오래 못 간다.
 *  읽는 것을 막지 않게 띠 하나로 두고, 닫으면 이 브라우저에서는 다시 뜨지 않는다. */
export default function AnonNotice() {
  // localStorage 는 React 밖의 저장소다. 효과 안에서 setState 로 읽어 오면
  // 렌더가 한 번 더 도는데, useSyncExternalStore 는 그 없이 읽는다.
  // 서버에서는 "닫힘"으로 본다 — 서버는 이 브라우저 사정을 모르고,
  // 잠깐 떴다 사라지는 것보다 늦게 뜨는 편이 덜 거슬린다.
  const closed = useSyncExternalStore(
    () => () => {},
    () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } },
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  if (closed || dismissed) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-line bg-muted/40 px-4 py-3 text-small">
      <p className="flex-1 leading-[1.6]">
        이 영상은 지금 이 브라우저에서만 다시 찾을 수 있어요.{" "}
        <Link href="/login" className="font-semibold underline">로그인</Link>하면 어느 기기에서든 볼 수 있어요.
      </p>
      <button onClick={() => { try { localStorage.setItem(KEY, "1"); } catch {} setDismissed(true); }}
              aria-label="닫기" className="shrink-0 px-1 text-mfg hover:text-fg">✕</button>
    </div>
  );
}
