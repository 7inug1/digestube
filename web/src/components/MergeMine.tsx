"use client";

import { useEffect } from "react";
import { clearMine, mine } from "@/lib/mine";

/** 로그인 직후, 이 브라우저에 쌓아 둔 목록을 계정으로 옮긴다.
 *  옮긴 뒤 브라우저 목록은 비운다 — 두 곳에 두면 어느 쪽이 맞는지 알 수 없다. */
export default function MergeMine({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) return;
    const vids = mine();
    if (!vids.length) return;
    fetch("/api/library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vids }),
    }).then(r => { if (r.ok) clearMine(); }).catch(() => {});
  }, [signedIn]);
  return null;
}
