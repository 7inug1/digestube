"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import type { FoundHit } from "./Found";
import { saySorry } from "@/lib/errors";
import { splitLines } from "@/lib/search-stream";

const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
type Ask = { status: "writing" | "done" | "error"; text: string; declined: boolean; error: string };

/** 검색 결과 위의 AI 답. 결과가 확정된 뒤 따로 받아 흘려 보여 준다 — 결과는 먼저 읽을 수 있게.
 *  각주 [n] 은 n번째 근거 문단(= 아래 결과의 순서)으로, 누르면 그 영상의 그 문단·시각으로 간다. */
export default function AnswerCard({ q, hits }: { q: string; hits: FoundHit[] }) {
  const refs = hits.slice(0, 3);
  const [a, setA] = useState<Ask>({ status: "writing", text: "", declined: false, error: "" });

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const r = await fetch("/api/ask", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ q, hits: refs.map(h => ({ video_id: h.video_id, seq: h.seq })) }),
      });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        setA(x => ({ ...x, status: "error", error: d.error ?? "답을 만들지 못했어요." }));
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
        for (const line of lines) {
          const m = JSON.parse(line) as { t: string; text?: string; declined?: boolean; error?: string };
          if (m.t === "delta") setA(x => ({ ...x, text: x.text + (m.text ?? "") }));
          else if (m.t === "done") setA(x => ({ ...x, status: "done", text: m.text ?? x.text, declined: Boolean(m.declined) }));
          else if (m.t === "error") setA(x => ({ ...x, status: "error", error: m.error ?? "답을 만들지 못했어요." }));
        }
      }
      setA(x => (x.status === "writing" ? { ...x, status: x.text ? "done" : "error", error: x.text ? "" : "답을 만들지 못했어요." } : x));
    })().catch(e => {
      if (ctrl.signal.aborted) return;
      setA(x => ({ ...x, status: "error", error: saySorry(e, "ask") }));
    });
    return () => ctrl.abort();
    // 질문과 근거가 같으면 다시 부르지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, refs.map(h => `${h.video_id}:${h.seq}`).join()]);

  const cite = (n: number, key: string) => {
    const h = refs[n - 1];
    if (!h) return null;
    return (
      <Link key={key} href={`/videos/${h.video_id}#ck${h.seq}`} aria-label={`근거 ${n}: ${h.title} ${mm(h.t)}`}
            className="ml-0.5 inline-flex h-[17px] min-w-[17px] -translate-y-[1px] items-center justify-center rounded
                       bg-muted px-1 align-middle font-mono text-[10.5px] text-mfg no-underline hover:bg-fg hover:text-bg">
        {n}
      </Link>
    );
  };
  // 본문의 [n] 을 누를 수 있는 각주로 바꾼다. 쓰는 중에 반쯤 온 "[" 는 글자로 둔다.
  // 모델은 "말해요 [1]." 처럼 각주 앞에 빈칸을 둔다. 각주를 글자에 붙여 "말해요¹."처럼 읽히게 빈칸을 뗀다.
  const parts = a.text.split(/(\[\d+\])/g);
  const body = parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) return cite(Number(m[1]), `c${i}`);
    const text = /^\[\d+\]$/.test(parts[i + 1] ?? "") ? part.replace(/\s+$/, "") : part;
    return <Fragment key={`t${i}`}>{text}</Fragment>;
  });
  // 근거 목록은 영상별로 묶는다 — 같은 영상 제목이 세 번 줄지어 나오면 읽기 어렵다
  const groups = refs.reduce<{ video_id: string; title: string; items: { n: number; h: FoundHit }[] }[]>((acc, h, i) => {
    const g = acc.find(x => x.video_id === h.video_id);
    if (g) g.items.push({ n: i + 1, h }); else acc.push({ video_id: h.video_id, title: h.title, items: [{ n: i + 1, h }] });
    return acc;
  }, []);

  return (
    <section aria-label="AI 답" className="mt-6 rounded-xl border border-line bg-muted/30 p-4 sm:p-5">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.12em] text-mfg">
        <span>답</span>
        {a.status === "writing" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg" aria-hidden />}
      </div>
      <div aria-live="polite" aria-busy={a.status === "writing"}>
        {a.status === "error" ? (
          <p className="text-small text-mfg">{a.error} 아래 문단은 그대로 볼 수 있어요.</p>
        ) : a.declined ? (
          <p className="text-[15px] leading-[1.8]">찾은 문단만으로는 답하기 어려워요. 아래 문단을 직접 확인해 보세요.</p>
        ) : a.text ? (
          <p className="text-[15px] leading-[1.85] tracking-[-.01em]">{body}</p>
        ) : (
          <p className="text-small text-mfg">찾은 문단을 읽고 답을 쓰는 중…</p>
        )}
      </div>
      {!a.declined && a.status !== "error" && (
        <ul className="mt-3 grid gap-1 text-[12px] text-mfg">
          {groups.map(g => (
            <li key={g.video_id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 truncate">{g.title}</span>
              {g.items.map(({ n, h }) => (
                <Link key={n} href={`/videos/${h.video_id}#ck${h.seq}`} aria-label={`${n}번 근거로 이동, ${mm(h.t)}`}
                      className="shrink-0 font-mono hover:text-fg">[{n}] {mm(h.t)}</Link>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] text-mfg">AI가 아래 문단만 근거로 썼어요. 중요한 내용은 원문에서 확인해 주세요.</p>
    </section>
  );
}
