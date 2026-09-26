"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Found, { type FoundHit } from "./Found";
import { mine } from "@/lib/mine";
import { saySorry } from "@/lib/errors";
import { Bar } from "./Skeleton";
import { EMPTY, splitLines, step, type Line, type SearchState } from "@/lib/search-stream";
import { warmReranker } from "@/lib/warm";

/** 검색 결과. 범위가 "내 라이브러리"라 로그인하지 않은 사람은 이 브라우저 목록을
 *  같이 보내야 한다 — 그건 서버가 모르니 화면이 뜬 뒤에 물어본다. */

export default function SearchResults({ q, vid, signedIn }: { q: string; vid?: string; signedIn: boolean }) {
  // 처리가 다 끝난 뒤 최종 결과만 보여 준다. 먼저 보여 줬다가 다듬은 순서로 바꾸지 않는다 —
  // 다듬기는 사용자가 신경 쓸 일이 아니다(2026-09-26). 기다림은 최대 리랭커 제한 5초만큼 는다.
  const [s, setS] = useState<SearchState>(EMPTY);
  const [peek, setPeek] = useState(false);

  // 검색 화면을 열면 리랭커를 깨워 둔다. 잠든 채 첫 검색이 오면 판단을 건너뛴다.
  useEffect(() => { warmReranker(); }, []);

  // q 가 바뀌면 key 로 이 컴포넌트를 새로 만든다 — 효과 안에서 상태를 되돌리지 않아도 된다.
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
  }, [q, vid, signedIn]);

  const { hits, failed, weak } = s;

  if (!q) {
    return (
      <p className="mt-6 text-small text-mfg">
        글자가 아니라 뜻으로 찾아요. 영상에서 쓴 표현을 몰라도 돼요.
      </p>
    );
  }
  if (failed) return <p className="mt-6 text-small text-mfg">검색에 실패했어요 — {failed}</p>;
  // 결과 카드와 같은 모양(썸네일·제목·문단 두 덩이)으로 자리를 잡아 둔다
  if (!s.done || hits === null) {
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
      <div className="mt-3 grid gap-3">
        {/* 그리드 칸은 기본으로 내용 폭만큼 넓어진다. 한 줄로 자르는 긴 제목이 칸을 밀어 휴대폰 화면이
            옆으로 넘치지 않게 칸이 줄어들 수 있게 한다 */}
        {groups.map(g => <div key={g[0].video_id} data-key={g[0].video_id} className="min-w-0"><Found hits={g} /></div>)}
      </div>
    </>
  );
}
