"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Found, { type FoundHit } from "./Found";
import { mine } from "@/lib/mine";
import { saySorry } from "@/lib/errors";
import { Bar } from "./Skeleton";
import type { Line } from "@/lib/search-stream";
import { warmReranker } from "@/lib/warm";

/** 검색 결과. 범위가 "내 라이브러리"라 로그인하지 않은 사람은 이 브라우저 목록을
 *  같이 보내야 한다 — 그건 서버가 모르니 화면이 뜬 뒤에 물어본다. */

export default function SearchResults({ q, vid, signedIn }: { q: string; vid?: string; signedIn: boolean }) {
  const [hits, setHits] = useState<FoundHit[] | null>(null);
  const [failed, setFailed] = useState("");
  // 결과는 먼저 보여 주고, 리랭커가 "질문에 답하는가"로 다시 세운 순서를 나중에 받는다.
  const [refining, setRefining] = useState(false);
  const [settled, setSettled] = useState(false);
  // 읽거나 누르려는 중에 카드가 움직이면 거슬린다. 그때는 순서를 바꾸지 않고 버튼으로 제안한다.
  const [pending, setPending] = useState<FoundHit[] | null>(null);
  // 가장 가까운 결과도 질문과 거리가 멀면 알린다. 결과는 그대로 둔다 — 기준값이 틀려도 답이 사라지지 않게.
  const [weak, setWeak] = useState(false);
  const [peek, setPeek] = useState(false);

  // 검색 화면을 열면 리랭커를 깨워 둔다. 잠든 채 첫 검색이 오면 판단을 건너뛴다.
  useEffect(() => { warmReranker(); }, []);
  const touched = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);

  /** 순서를 바꾸기 전 자리를 기억해 두고 바꾼다. 바뀐 뒤 제자리에서 새 자리로 미끄러지게 한다. */
  const apply = useCallback((next: FoundHit[]) => {
    const rects = new Map<string, DOMRect>();
    list.current?.querySelectorAll<HTMLElement>("[data-key]").forEach(el => rects.set(el.dataset.key!, el.getBoundingClientRect()));
    before.current = rects;
    setHits(next);
  }, []);

  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (!rects || !list.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    list.current.querySelectorAll<HTMLElement>("[data-key]").forEach(el => {
      const old = rects.get(el.dataset.key!);
      if (!old) { el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" }); return; }
      const dy = old.top - el.getBoundingClientRect().top;
      if (!dy) return;
      el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }, [hits]);

  // 결과가 뜬 뒤 사용자가 먼저 움직였는지 본다(누르기·굴리기·끌기·키보드). 마우스를 올리기만 한 것은 세지 않는다.
  useEffect(() => {
    if (!refining) return;
    const mark = () => { touched.current = true; };
    const kinds = ["pointerdown", "wheel", "touchmove", "keydown"] as const;
    kinds.forEach(k => window.addEventListener(k, mark, { passive: true }));
    return () => kinds.forEach(k => window.removeEventListener(k, mark));
  }, [refining]);

  // q 가 바뀌면 결과를 버리고 다시 찾는다. key 로 이 컴포넌트를 새로 만들면
  // 효과 안에서 상태를 되돌리지 않아도 된다 — 아래 useEffect 가 그래서 단순하다.
  useEffect(() => {
    if (!q) return;
    const ctrl = new AbortController();
    const p = new URLSearchParams({ q, stream: "1" });
    if (vid) p.set("vid", vid);
    if (!signedIn && !vid) p.set("ids", mine().join(","));

    const handle = (m: Line) => {
      if (m.t === "hits") { setHits(m.hits); if (m.hits.length) setRefining(true); }
      else if (m.t === "reranked") { if (touched.current) setPending(m.hits); else apply(m.hits); }
      else if (m.t === "done") {
        setRefining(false);
        setWeak(m.weak === true);
        if (m.reranked && !touched.current) { setSettled(true); setTimeout(() => setSettled(false), 2200); }
      }
      else if (m.t === "error") { setFailed(m.error); setHits(h => h ?? []); setRefining(false); }
    };

    (async () => {
      const r = await fetch(`/api/search?${p}`, { signal: ctrl.signal });
      // 오류 응답은 한 번에 오는 JSON 이다
      if (!r.ok || !r.body || !(r.headers.get("content-type") ?? "").includes("ndjson")) {
        const d = await r.json();
        if (d.error) setFailed(d.error);
        setHits(d.hits ?? []);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) handle(JSON.parse(line) as Line);
        }
      }
      setRefining(false);
    })().catch(e => {
      if (ctrl.signal.aborted) return;
      setFailed(saySorry(e, "search")); setHits(h => h ?? []); setRefining(false);
    });
    return () => ctrl.abort();
  }, [q, vid, signedIn, apply]);

  if (!q) {
    return (
      <p className="mt-6 text-small text-mfg">
        글자가 아니라 뜻으로 찾아요. 영상에서 쓴 표현을 몰라도 돼요.
      </p>
    );
  }
  if (failed) return <p className="mt-6 text-small text-mfg">검색에 실패했어요 — {failed}</p>;
  // 결과 카드와 같은 모양(썸네일·제목·문단 두 덩이)으로 자리를 잡아 둔다
  if (hits === null) {
    return (
      <div className="mt-6 grid gap-3">
        {[0, 1].map(c => (
          <article key={c} className="rounded-xl border border-line p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="h-[42px] w-[74px] shrink-0 animate-pulse rounded-md bg-muted"
                   style={{ animationDelay: `${c * 120}ms` }} />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Bar w="56%" h={12} delay={c * 120 + 80} />
                <Bar w="32%" h={10} delay={c * 120 + 160} />
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {[100, 96, 72].map((w, i) => <Bar key={i} w={`${w}%`} delay={c * 120 + 240 + i * 80} />)}
            </div>
          </article>
        ))}
      </div>
    );
  }

  const grouped = new Map<string, FoundHit[]>();
  for (const h of hits) grouped.set(h.video_id, [...(grouped.get(h.video_id) ?? []), h]);
  const groups = [...grouped.values()];

  if (!groups.length) {
    return (
      <div className="mt-6">
        <p className="mb-3 text-small text-mfg">
          {`“${q}”와 가까운 대목을 내 라이브러리에서 못 찾았어요.`}
        </p>
        <Link href="/" className="text-small font-semibold underline">영상 변환하러 가기 →</Link>
      </div>
    );
  }

  if (weak && !peek) {
    // 결과는 지우지 않는다 — 기준값이 틀렸을 때 버튼 한 번이면 볼 수 있어야 한다.
    return (
      <div className="mt-6" role="status" aria-live="polite">
        <p className="text-[15px] font-semibold">
          {vid ? "이 영상에서" : "라이브러리에서"} 이 질문에 맞는 내용을 찾지 못했어요.
        </p>
        <button type="button" onClick={() => setPeek(true)}
                className="mt-2 text-small text-mfg underline underline-offset-4 hover:text-fg">
          그래도 가까운 대목 보기
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="mt-6 text-small text-mfg">
        {`“${q}”와 가까운 영상 ${groups.length}편 · 관련 문단 ${hits.length}개`}
        {vid ? " · 이 영상 안에서" : ""}
      </p>
      {weak && <p className="mt-3 text-small text-mfg">질문과 딱 맞지는 않지만 가장 가까운 대목이에요.</p>}
      <Refining refining={refining} settled={settled} pending={pending}
                onApply={() => { if (pending) { apply(pending); setPending(null); } }} />
      <div ref={list} className="mt-3 grid gap-3">
        {/* 그리드 칸은 기본으로 내용 폭만큼 넓어진다. 한 줄로 자르는 긴 제목이 칸을 밀어 휴대폰 화면이
            옆으로 넘치지 않게 칸이 줄어들 수 있게 한다 */}
        {groups.map(g => <div key={g[0].video_id} data-key={g[0].video_id} className="min-w-0"><Found hits={g} /></div>)}
      </div>
    </>
  );
}

/** 결과 위 한 줄. 다시 정리하는 중 → 정리했어요(잠깐) / 읽는 중이었다면 → 정리한 순서 보기 버튼.
 *  리랭커가 늦거나 실패하면 아무 말 없이 사라진다 — 처음 결과가 그대로 남는다. */
function Refining({ refining, settled, pending, onApply }:
  { refining: boolean; settled: boolean; pending: FoundHit[] | null; onApply: () => void }) {
  if (pending) {
    return (
      <button type="button" onClick={onApply}
              className="mt-3 text-small font-semibold underline underline-offset-4">
        더 관련 있는 순서로 보기
      </button>
    );
  }
  if (refining) {
    return (
      <div className="mt-3" role="status" aria-live="polite">
        <p className="text-small text-mfg">질문에 더 맞는 대목을 앞으로 정리하는 중…</p>
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded bg-line" />
        </div>
      </div>
    );
  }
  if (settled) {
    return <p className="mt-3 text-small text-mfg" role="status" aria-live="polite">질문에 더 맞는 순서로 정리했어요</p>;
  }
  return null;
}
