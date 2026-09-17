"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { runIngest, videoIdOf } from "@/lib/ingest-client";
import { saySorry } from "@/lib/errors";
import QuotaLeft from "./QuotaLeft";

/** 유튜브 주소를 받는 자리.
 *
 *  예전엔 여기서 전사를 끝까지 돌리고 진행 상자를 보여줬다. 받아쓴 글이 좁은 상자를
 *  스쳐 지나가고, 다 되면 읽기 화면으로 튕겼다 — 보여준 걸 그대로 버리는 셈이었다.
 *  이제 주소만 확인하고 바로 읽기 화면으로 보낸다. 글은 거기서 본문 칸에 차오른다.
 *
 *  플레이리스트는 화면에 보여줄 것이 없어서 예전처럼 여기서 돈다.
 */
export default function IngestForm() {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function go() {
    const input = url.trim();
    if (!input || busy) return;
    setMsg("");

    // 재생목록 안에서 영상을 보다가 주소를 복사하면 v= 와 list= 가 같이 붙는다.
    // list= 만 보고 재생목록으로 치면 한 편 넣으려던 사람이 수십 편을 돌리게 된다 —
    // 실제로 그래서 한 편이 전사되지 않았다. v= 가 있으면 그 한 편이다.
    const playlist = /[?&]list=/.test(input) && !videoIdOf(input);
    // 재생목록은 여러 편이라 한 화면으로 못 보낸다. 여기서 돌고 라이브러리로 간다.
    if (playlist) {
      setBusy(true);
      try {
        const r = await fetch("/api/playlist", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: input }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `${r.status}`);
        if (!d.todo.length) { setMsg(`플레이리스트 ${d.total}편 — 이미 모두 담겨 있어요.`); return; }
        const failed: string[] = [];
        for (const [i, vid] of (d.todo as string[]).entries()) {
          setMsg(`${i + 1}/${d.todo.length}편 처리 중…`);
          try { await runIngest(`https://www.youtube.com/watch?v=${vid}`); }
          catch (e) { failed.push(saySorry(e, "playlist-item")); }
        }
        if (failed.length) { setMsg(`${failed.length}편을 처리하지 못했어요. ${failed[0]}`); return; }
        router.push("/videos");
      } catch (e) {
        setMsg(saySorry(e, "playlist"));
      } finally { setBusy(false); }
      return;
    }

    const vid = videoIdOf(input);
    if (!vid) { setMsg("유튜브 영상 주소를 넣어주세요."); return; }
    setBusy(true);
    // convert=1 은 "랜딩에서 넣어서 왔다"는 표다. 이게 없으면 읽기 화면은 변환을
    // 시작하지 않는다 — 주소만 찍어 넣어 남의 지갑으로 모델을 돌리지 못하게.
    router.push(`/videos/${vid}?convert=1`);
  }

  return (
    <div>
      <div className="flex gap-2">
        <input value={url} disabled={busy} aria-label="유튜브 주소"
          onChange={e => { setUrl(e.target.value); setMsg(""); }}
          onKeyDown={e => e.key === "Enter" && go()}
          placeholder="유튜브 링크를 붙여넣어 주세요"
          className="h-[46px] min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5 outline-none placeholder:text-mfg focus:border-fg focus:bg-bg" />
        <button onClick={() => go()} disabled={!url.trim() || busy}
          className="h-[46px] shrink-0 whitespace-nowrap rounded-lg bg-fg px-4 text-small font-semibold text-bg disabled:opacity-35 sm:px-5">
          {busy ? "여는 중…" : "글로 변환하기"}
        </button>
      </div>
      {msg && <p role="status" className="mt-3 text-[13px] text-mfg">{msg}</p>}
      <QuotaLeft done={busy} />
    </div>
  );
}
