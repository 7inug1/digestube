"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { mine } from "@/lib/mine";

const KEY = "digestube.anonNoticeClosed";

/** 로그인하지 않은 사람에게 알린다 — 담은 영상은 지금 이 브라우저에서만 다시 찾을 수 있다.
 *
 *  읽기 화면에만 뒀다가 모든 화면 위로 옮겼다. 라이브러리·검색에서도 같은 사실이
 *  걸려 있고, 한 화면에서만 말하면 그 화면을 안 거친 사람은 끝내 모른다.
 *
 *  담은 게 하나도 없으면 띄우지 않는다 — 아직 잃을 것이 없는 사람에게 하는 경고는
 *  잔소리다. 닫으면 이 브라우저에서는 다시 뜨지 않는다.
 *
 *  "사라진다"고 쓰지 않는다. 영상은 서버에 남고, 못 찾는 것은 목록이 브라우저에만
 *  있기 때문이다. 겁주는 문구는 그 순간 먹히지만 틀린 말이라 오래 못 간다.
 *
 *  폭은 화면마다 다르다(랜딩 620 · 검색 720 · 라이브러리 1320). 어느 폭에 맞춰도
 *  나머지와 어긋나므로, 띠는 화면 끝까지 늘리고 글만 가운데 둔다 — 페이지 내용이
 *  아니라 시스템이 하는 말로 읽힌다.
 */
export default function AnonNotice() {
  const state = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        if (localStorage.getItem(KEY) === "1") return "hide";
        return mine().length > 0 ? "show" : "hide";
      } catch { return "hide"; }
    },
    () => "hide", // 서버는 이 브라우저 사정을 모른다. 깜빡였다 사라지는 것보다 늦게 뜨는 편이 낫다
  );
  const [dismissed, setDismissed] = useState(false);

  if (state === "hide" || dismissed) return null;
  return (
    <div className="border-b border-line bg-muted/50">
      <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-5 py-2.5 text-label">
        <p className="flex-1 text-center leading-[1.6]">
          라이브러리의 영상은 현재 브라우저에만 저장돼요.{" "}
          <Link href="/login" className="font-semibold underline">로그인</Link>해서 어디서든 라이브러리 영상을 감상해보세요!
        </p>
        <button onClick={() => { try { localStorage.setItem(KEY, "1"); } catch {} setDismissed(true); }}
                aria-label="닫기" className="shrink-0 px-1 text-mfg hover:text-fg">✕</button>
      </div>
    </div>
  );
}
