"use client";

import { useEffect, useState } from "react";
import { mine } from "./mine";
import { saySorry } from "./errors";
import { EMPTY, splitLines, step, type Line, type SearchState } from "./search-stream";

/** 검색을 한 번 흘려 받아 상태로 만든다. 검색 화면과 검색 창(팔레트)이 같이 쓴다.
 *  q 가 비면 아무것도 하지 않는다. q 가 바뀌면 이전 요청을 끊고 새로 받는다. */
export function useSearchStream(q: string, { vid, signedIn }: { vid?: string; signedIn: boolean }): SearchState {
  // 결과를 검색어와 함께 들고 있다가, 검색어가 바뀌면 빈 상태를 보여 준다(효과 안에서 되돌리지 않는다)
  const [held, setHeld] = useState<{ q: string; s: SearchState }>({ q: "", s: EMPTY });
  const setS = (f: (x: SearchState) => SearchState) => setHeld(h => ({ q, s: f(h.q === q ? h.s : EMPTY) }));
  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    const p = new URLSearchParams({ q, stream: "1" });
    if (vid) p.set("vid", vid);
    if (!signedIn && !vid) p.set("ids", mine().join(","));
    (async () => {
      const r = await fetch(`/api/search?${p}`, { signal: ctrl.signal });
      // 오류 응답은 한 번에 오는 JSON 이다
      if (!r.ok || !r.body || !(r.headers.get("content-type") ?? "").includes("ndjson")) {
        const d = await r.json();
        setS(x => ({ ...x, hits: d.hits ?? [], failed: d.error ?? "", done: true }));
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { lines, rest } = splitLines(buf + dec.decode(value, { stream: true }));
        buf = rest;
        for (const line of lines) setS(x => step(x, JSON.parse(line) as Line));
      }
      setS(x => ({ ...x, refining: false, done: true }));
    })().catch(e => {
      if (ctrl.signal.aborted) return;
      setS(x => step(x, { t: "error", error: saySorry(e, "search") }));
    });
    return () => ctrl.abort();
    // setS 는 q 를 잡는 작은 함수라 매 렌더 새로 생기지만, q 가 의존성에 있어 같은 값이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, vid, signedIn]);
  return held.q === q ? held.s : EMPTY;
}
