"use client";

import { useEffect, useRef, useState } from "react";
import { saySorry } from "@/lib/errors";
import { EMPTY, splitLines, stageOf, STAGE_TEXT, step, type Line, type SearchState } from "@/lib/search-stream";
import { warmReranker } from "@/lib/warm";

const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 읽기 화면의 검색. 이 영상 안에서만 찾고, 화면을 떠나지 않는다.
 *
 *  예전에는 검색 화면으로 넘어갔다. 읽던 자리를 잃고, 거기서 다시 찾으면 "이 영상 안에서"
 *  조건이 말없이 풀려 라이브러리 전체를 뒤졌다. "그 얘기 어디서 했더라"는 읽는 중에 생기는
 *  질문이라 답도 읽는 자리에서 보여 준다. 결과를 누르면 목차처럼 그 문단과 시각으로 간다.
 */
export default function VideoSearch({ vid, onJump }: { vid: string; onJump: (t: number, seq: number) => void }) {
  const [input, setInput] = useState("");
  const [asked, setAsked] = useState("");
  const [s, setS] = useState<SearchState>(EMPTY);
  const ctrl = useRef<AbortController | null>(null);
  // 맞는 대목이 없어 보일 때 접어 둔 가까운 대목을 펼쳤는가
  const [peek, setPeek] = useState(false);

  // 읽는 동안 리랭커를 깨워 둔다. 첫 검색에서도 "맞는 대목 없음"을 판단할 수 있게.
  useEffect(() => { warmReranker(); }, []);

  const go = async () => {
    const q = input.trim();
    if (!q) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setAsked(q);
    setS(EMPTY);
    setPeek(false);
    try {
      const r = await fetch(`/api/search?${new URLSearchParams({ q, vid, stream: "1" })}`, { signal: c.signal });
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
    } catch (e) {
      if (c.signal.aborted) return;
      setS(x => step(x, { t: "error", error: saySorry(e, "search") }));
    }
  };

  const close = () => { ctrl.current?.abort(); setAsked(""); setS(EMPTY); };

  return (
    <div>
      <div className="flex gap-2">
        <input
          aria-label="이 영상에서 찾기"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && go()}
          placeholder="이 영상에서 궁금한 내용을 찾아보세요"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5 text-[13.5px]
                     outline-none placeholder:text-mfg focus:border-fg focus:bg-bg"
        />
        <button onClick={go} disabled={!input.trim()}
                className="h-9 shrink-0 rounded-lg bg-fg px-4 text-[13.5px] font-semibold text-bg
                           disabled:cursor-default disabled:opacity-35">
          찾기
        </button>
      </div>

      {asked && (
        <div className="mt-3 rounded-xl border border-line p-3">
          <div className="mb-2 flex items-baseline gap-2">
            <p className="min-w-0 flex-1 truncate text-[11.5px] text-mfg">{`“${asked}”`}</p>
            <button onClick={close} className="shrink-0 text-[11.5px] text-mfg underline underline-offset-2 hover:text-fg">
              닫기
            </button>
          </div>

          {s.failed ? <p className="text-[12.5px] text-mfg">검색에 실패했어요 — {s.failed}</p>
          : !s.done || s.hits === null
            ? <p className="text-[12.5px] text-mfg" role="status" aria-live="polite">
                {STAGE_TEXT[stageOf(s) === "check" ? "check" : "find"]}
              </p>
          : !s.hits.length ? <p className="text-[12.5px] text-mfg">이 영상에서 가까운 대목을 못 찾았어요.</p>
          : s.weak && !peek ? (
              // 결과를 지우지는 않는다. 기준값은 개발 질문 12개로 정한 값이라 틀릴 수 있다 —
              // 틀렸을 때 버튼 한 번이면 답을 볼 수 있어야 한다.
              <div role="status" aria-live="polite">
                <p className="text-[13.5px] font-semibold">이 영상에서 이 질문에 맞는 내용을 찾지 못했어요.</p>
                <button onClick={() => setPeek(true)}
                        className="mt-1.5 text-[12px] text-mfg underline underline-offset-2 hover:text-fg">
                  그래도 가까운 대목 보기
                </button>
              </div>
            )
          : <>
              {s.weak && <div className="mb-2"><WeakReason top={s.top} cut={s.cut} /></div>}
              <ol aria-label="이 영상에서 찾은 대목" className="grid gap-1">
                {s.hits.map(h => (
                  <li key={h.seq}>
                    <button onClick={() => onJump(h.t, h.seq)}
                            className="flex w-full items-baseline gap-2 rounded px-1 py-1.5 text-left hover:bg-muted/60">
                      <span className="shrink-0 font-mono text-[10.5px] text-mfg">{mm(h.t)}</span>
                      <span className="line-clamp-2 flex-1 text-[13px] leading-[1.6]">{h.hl ?? h.text}</span>
                      {s.weak && h.rerank_score !== undefined &&
                        <span className="shrink-0 font-mono text-[10.5px] text-mfg">{`관련도 점수 ${h.rerank_score.toFixed(1)}`}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </>}
        </div>
      )}
    </div>
  );
}

/** 펼쳤을 때 왜 "못 찾았다"고 했는지. 점수를 받지 못했으면 말하지 않는다. */
export function WeakReason({ top, cut }: { top: number | null; cut: number | null }) {
  if (top === null || cut === null) return null;
  return (
    <p className="text-[12px] text-mfg">
      {`가장 높은 관련도 점수 ${top.toFixed(1)} · 기준 ${cut} 미만이라 질문에 맞는 대목이 없다고 판단했어요.`}
    </p>
  );
}
