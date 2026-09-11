"use client";

import { useState } from "react";
import YouTube from "./YouTube";

type Chunk = { seq: number; t: number; t_end: number; text: string };
type Outline = { seq: number; t: number; label: string };
type Meta = { title: string; channel: string; seconds: number; read: string; mode?: string | null; lang?: string | null };

const mm = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** 영상 화면 — v1 의 2단 배치를 그대로 쓴다.
 *
 *  왼쪽에 영상·제목·목차를 붙여 두고 오른쪽에서 글을 읽는다. 유튜브 시청 화면의
 *  순서(제목 · 채널 · 설명 상자)를 따르고, 설명 상자 안에 목차를 넣어
 *  "이 영상이 무슨 얘기인지"와 "어디로 갈 수 있는지"를 한 덩어리로 묶는다.
 *
 *  왼쪽이 붙어 있으려면(sticky) 바깥 칸이 오른쪽 높이만큼 늘어나 있어야 한다.
 *  칸이 내용 높이로 줄어들면 붙어 있을 공간이 없어 그냥 같이 밀려 올라간다.
 */
export default function Reader({ vid, chunks, outline, meta }: {
  vid: string; chunks: Chunk[]; outline: Outline[]; meta: Meta;
}) {
  const [seek, setSeek] = useState(chunks[0]?.t ?? 0);
  // 같은 시각을 다시 눌러도 움직이게 하는 값
  const [nonce, setNonce] = useState(0);
  const [selectedSeq, setSelectedSeq] = useState(chunks[0]?.seq);

  function jump(t: number, seq?: number) {
    setSeek(t);
    setNonce((n) => n + 1);
    if (seq !== undefined) {
      setSelectedSeq(seq);
      document.getElementById(`ck${seq}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 md:grid-cols-[560px_1fr] md:gap-14">
      <aside className="md:h-full">
        <div className="grid gap-4 md:sticky md:top-[76px]">
          <div className="-mx-5 md:mx-0">
            <YouTube videoId={vid} seek={seek} nonce={nonce} autoplay={nonce > 0} />
          </div>

          <div>
            <h1 className="text-[17px] font-[680] leading-[1.38] tracking-[-.03em]">
              {meta.title}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[10px] font-bold text-mfg">
                {meta.channel.slice(0, 1)}
              </span>
              <span className="text-[12.5px] font-medium">{meta.channel}</span>
              <span className="text-[11.5px] text-mfg">· {mm(meta.seconds)} · {meta.read} 분량</span>
              <a href={`https://youtu.be/${vid}`} target="_blank" rel="noreferrer"
                 className="ml-auto text-[11.5px] text-mfg underline underline-offset-2 hover:text-fg">
                유튜브에서 보기
              </a>
            </div>
          </div>

          <p className="text-[11.5px] text-mfg">
            {meta.mode === "native" ? "기존 자막 · 번역 자막일 수 있음" : meta.mode === "generate" ? "음성 받아쓰기" : "자막 수집 방식 미기록"}
            {meta.lang ? ` · ${meta.lang}` : ""}
          </p>

          {outline.length > 0 && (
            <div className="rounded-xl bg-muted/60 p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[.12em] text-mfg">목차</div>
              <div className="md:max-h-[34vh] md:overflow-y-auto">
                <ol className="grid">
                  {outline.map((o, i) => (
                    <li key={o.seq}>
                      <button onClick={() => jump(o.t, o.seq)}
                              className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-bg">
                        <span className="w-4 shrink-0 font-mono text-[11px] text-mfg">{i + 1}</span>
                        <span className="text-[13px] leading-[1.6]">{o.label}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-mfg">{mm(o.t)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div>
        {chunks.map((c) => {
          const on = selectedSeq === c.seq;
          return (
            <section key={c.seq} id={`ck${c.seq}`} className="scroll-mt-24 border-b border-line py-5 last:border-0">
              <button onClick={() => jump(c.t, c.seq)}
                      className={`mb-2 rounded px-1.5 py-0.5 font-mono text-[11px] ${
                        on ? "bg-fg text-bg" : "bg-muted text-mfg hover:text-fg"}`}>
                {mm(c.t)}
              </button>
              <p className="text-[17px] leading-[1.9] tracking-[-.014em]">{c.text}</p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
