"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 유튜브 영상이나 플레이리스트 주소를 넣는다.
 *
 *  서버리스는 한 요청이 60초를 넘을 수 없다. 그래서 단계마다 따로 부르고,
 *  이어 붙이는 일은 브라우저가 한다 — 요청이 나뉘면 각 단계가 60초를 따로 받는다.
 *  플레이리스트도 같은 이유로 목록만 받아 와서 한 편씩 돈다(배치는 유료 플랜).
 */
export default function IngestForm() {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function post(path: string, body: unknown) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? `${r.status}`);
    return d;
  }

  /** 한 편: 전사 → 벡터 → 목차 */
  async function one(videoUrl: string, note: (s: string) => void) {
    note("전사하는 중…");
    let d = await post("/api/ingest", { url: videoUrl });
    const t0 = Date.now();
    while (d.state === "working") {
      note(`받아쓰는 중… ${Math.round((Date.now() - t0) / 1000)}초`);
      await new Promise((s) => setTimeout(s, 5000));
      const r = await fetch(`/api/ingest?job=${d.job}&vid=${d.vid}`);
      const next = await r.json();
      if (!r.ok) throw new Error(next.error ?? `${r.status}`);
      d = next.state === "working" ? d : next;
    }
    const vid = d.vid as string;

    note(`문단 ${d.chunks}개 · 벡터 만드는 중…`);
    for (let i = 0; i < 10; i++) {
      const e = await post("/api/embed", { vid });
      if (!e.left) break;
    }
    note("목차 만드는 중…");
    await post("/api/outline", { vid }).catch(() => null);   // 목차는 덤이다
    return vid;
  }

  async function go() {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      if (/[?&]list=/.test(url)) {
        const { total, todo } = await post("/api/playlist", { url });
        if (!todo.length) { setMsg(`플레이리스트 ${total}편 — 이미 다 넣었다`); setBusy(false); return; }
        for (const [i, vid] of todo.entries()) {
          await one(`https://www.youtube.com/watch?v=${vid}`,
            (s) => setMsg(`${i + 1}/${todo.length}편 · ${s}`))
            .catch((e) => setMsg(`${i + 1}편 실패 — ${(e as Error).message}`));
        }
        setUrl("");
        router.push("/videos");
      } else {
        const vid = await one(url, setMsg);
        setUrl("");
        router.push(`/videos/${vid}`);
      }
    } catch (e) {
      setMsg("실패 — " + (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="유튜브 영상 또는 플레이리스트 주소"
          className="h-[46px] min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5
                     outline-none placeholder:text-mfg focus:border-fg focus:bg-bg"
        />
        <button onClick={go} disabled={!url.trim() || busy}
                className="h-[46px] shrink-0 rounded-lg bg-fg px-5 text-[13.5px] font-semibold
                           text-bg disabled:cursor-default disabled:opacity-35">
          {busy ? "넣는 중…" : "넣기"}
        </button>
      </div>
      {msg && <p className="mt-3 font-mono text-[12px] text-mfg">{msg}</p>}
    </div>
  );
}
