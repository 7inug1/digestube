"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { remember } from "@/lib/mine";
import { clock, runIngest, type Made, type Stage } from "@/lib/ingest-client";
import YouTube from "./YouTube";
import { failureKind } from "./IngestProgress";
import { saySorry } from "@/lib/errors";

/** 만들어지는 중인 읽기 화면.
 *
 *  예전엔 랜딩의 작은 상자에서 세 줄씩 스쳐 보내고, 다 되면 이 주소로 튕겼다.
 *  받아쓴 글을 보여주고 버리는 셈이었다. 이제 처음부터 여기로 와서 본문 칸이
 *  위에서부터 차오른다 — 끝나도 화면이 바뀌지 않는다. 다 되면 그냥 읽으면 된다.
 *
 *  왼쪽에 영상·제목을 두는 배치는 완성된 읽기 화면과 같다. 다 됐을 때 글자가
 *  제자리로 옮겨 앉는 느낌이 없어야 한다.
 */
export default function Building({ vid, title, channel, avatar }: {
  vid: string; title: string; channel: string; avatar?: string | null;
}) {
  /** 받아쓴 말을 문단으로 묶어 쌓는다. 조각 하나는 "그렇지, 그렇지." 처럼 짧아서
   *  그대로 한 줄씩 쌓으면 완성된 읽기 화면(문단 340자)과 모양이 전혀 다르다 —
   *  다 됐을 때 글이 통째로 재배열되는 것처럼 보인다. 같은 모양으로 쌓아 둔다. */
  const [paras, setParas] = useState<{ at: number; text: string }[]>([]);
  const [stage, setStage] = useState<Stage>("전사");
  const [detail, setDetail] = useState("영상 소리를 받아쓰는 중…");
  const [ratio, setRatio] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  /** 다 됐을 때 잠깐 머무는 자리. 바로 넘기면 무슨 일이 끝났는지 모른 채 화면만 바뀐다. */
  const [made, setMade] = useState<Made | null>(null);
  /** 영상을 틀어 놨나. 보는 중에 화면을 갈아치우면 재생이 처음으로 돌아가므로,
   *  그때는 스스로 넘기지 않고 누를 자리를 준다. */
  const [watching, setWatching] = useState(false);
  const router = useRouter();
  const started = useRef(false);
  /** 효과 안에서 최신 값을 봐야 해서 따로 든다 — 상태만 쓰면 시작할 때 값에 묶인다. */
  const watchingRef = useRef(false);
  const tail = useRef<HTMLDivElement>(null);
  /** 받아쓴 글이 끝나는 자리. 아래에 회색 줄을 깔아 뒀으므로 "칸의 바닥"으로 따라가면
   *  글을 지나쳐 빈 회색만 보게 된다 — 실제로 그랬다. 이 표를 기준으로 따라간다. */
  const edge = useRef<HTMLDivElement>(null);

  // 아직 안 온 자리를 회색 줄로 미리 깔아 둔다. 글 길이는 영상 길이에 대충 비례하니
  // (실측 10분 영상이 문단 30개쯤) 남은 만큼만 남긴다. 다 받아쓰면 0 이 된다.
  const ghosts = total > 0
    ? Math.max(0, Math.round((total / 60) * 1.2) - paras.length)
    : Math.max(0, 6 - paras.length);

  useEffect(() => {
    // 새로고침·되돌아오기로 두 번 도는 일이 없게 한 번만 시작한다
    if (started.current) return;
    started.current = true;
    const at = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - at) / 1000)), 1000);

    runIngest(`https://www.youtube.com/watch?v=${vid}`, {
      onMeta: m => setTotal(m.seconds),
      onSegment: s => setParas(p => {
        const text = s.text.trim();
        if (!text) return p;
        const at = clock(s.start) ?? 0;
        const last = p[p.length - 1];
        // 문단이 어느 정도 차면 새로 연다. 260자는 완성된 문단(340자 안팎)보다
        // 조금 짧게 잡은 값이다 — 여기서 넘치면 다 됐을 때 줄이 크게 밀린다.
        // 시각은 문단을 연 조각의 것을 쓴다 — 완성된 화면에서 누르면 뛰는 그 지점이다.
        if (!last || last.text.length > 260) return [...p, { at, text }];
        return [...p.slice(0, -1), { at: last.at, text: `${last.text} ${text}` }];
      }),
      onStage: s => { setStage(s.stage); setDetail(s.detail); setRatio(s.ratio); },
    })
      .then(m => {
        remember(m.vid);
        setMade(m);
        // 잠깐 보여주고 넘긴다. 서버가 다시 그리면 이 자리에 완성된 읽기 화면이 온다.
        // 1.4초는 한 줄을 읽고 "아 됐구나" 하기까지의 시간이다 — 더 두면 기다리게 된다.
        // 영상을 보는 중이면 넘기지 않는다. 보던 것이 처음으로 돌아가면 뺏긴 기분이 든다.
        if (!watchingRef.current) setTimeout(() => router.refresh(), 1400);
      })
      .catch(e => setFailed(saySorry(e, "building")))
      .finally(() => clearInterval(tick));
    return () => clearInterval(tick);
  }, [vid, router]);

  // 새 줄이 오면 따라 내려간다. 사람이 위로 올려 읽는 중이면 따라가지 않는다 —
  // 읽던 자리가 끌려가면 글을 못 읽는다. 대신 아래로 갈 버튼을 띄운다.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (stuck) return;
    follow();
  }, [paras, stuck]);

  useEffect(() => {
    const box = tail.current;
    if (!box) return;
    const watch = () => {
      // 글 끝에서 한 화면쯤 떨어지면 "따라가지 않음"으로 본다. 살짝 흔들린 것까지
      // 멈춤으로 치면 버튼이 깜빡인다.
      setStuck(gap() > 240);
    };
    box.addEventListener("scroll", watch, { passive: true });
    return () => box.removeEventListener("scroll", watch);
  }, []);

  /** 글 끝이 보이는 자리에서 얼마나 떨어져 있나. 양수면 아직 아래에 더 있다는 뜻이다. */
  function gap(): number {
    const box = tail.current, end = edge.current;
    if (!box || !end) return 0;
    return end.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
  }

  function follow() {
    const box = tail.current;
    if (!box) return;
    box.scrollTop += gap() + 24;
  }

  if (failed) {
    const kind = failureKind(failed);
    return (
      <div className="mx-auto max-w-[620px] py-20 text-center">
        <p className="mb-2 text-[22px] font-[740] tracking-[-.03em]">{kind.icon} {kind.label}</p>
        <p className="mb-8 text-small leading-[1.7] text-mfg">{failed}</p>
        <Link href="/" className="rounded-lg bg-fg px-4 py-2.5 text-small font-semibold text-bg">
          다른 영상 넣어보기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 md:grid-cols-[560px_1fr] md:gap-14">
      <aside className="md:h-full">
        <div className="grid gap-4 md:sticky md:top-[76px]">
          {/* 기다리는 동안 볼 것이 있어야 한다. 받아쓰기는 유튜브가 아니라 우리 서버가
              하는 일이라, 영상을 틀어 놔도 전사가 느려지지 않는다.
              자동 재생은 하지 않는다 — 글을 읽으러 온 사람에게 소리부터 나오면 놀란다. */}
          <div className="-mx-5 md:mx-0">
            <YouTube videoId={vid} seek={0} autoplay={false} onPlay={() => { setWatching(true); watchingRef.current = true; }} />
          </div>
          <div>
            <h1 className="mb-2 text-body font-semibold leading-[1.4] tracking-[-.02em]">{title}</h1>
            {/* 완성된 읽기 화면과 같은 줄이다 — 다 됐을 때 이 자리가 흔들리지 않는다 */}
            <div className="flex items-center gap-2">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" loading="lazy"
                     className="h-6 w-6 shrink-0 rounded-full bg-muted object-cover" />
              ) : (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-mfg">
                  {channel.slice(0, 1)}
                </span>
              )}
              <span className="truncate text-[12.5px] font-medium">{channel}</span>
            </div>
          </div>

          {/* 다 되면 같은 자리에서 끝났다고 말한다. 상자가 사라졌다 생기면 화면이 덜컹거린다.
              "다 됐어요"만으로는 뭐가 생겼는지 모르니 문단·목차 수를 같이 적는다. */}
          <div className={`rounded-xl border p-4 transition-colors duration-300
                           ${made ? "border-fg bg-muted/40" : "border-line"}`}>
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <p className="text-small font-medium">
                {made ? "✓ 다 읽을 준비가 됐어요" : detail}
              </p>
              <span className="shrink-0 font-mono text-label text-mfg">
                {made ? 100 : pct(stage, ratio)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-fg transition-[width] duration-500 ease-out"
                   style={{ width: `${made ? 100 : pct(stage, ratio)}%` }} />
            </div>
            <p className="mt-2.5 text-label text-mfg">
              {made
                ? `문단 ${made.paragraphs}개 · 목차 ${made.outline}개`
                : left(total, elapsed)}
            </p>
            {made && watching && (
              <button onClick={() => router.refresh()}
                      className="mt-3 w-full rounded-lg bg-fg py-2.5 text-small font-semibold text-bg">
                읽으러 가기
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* 받아쓴 글이 여기 차오른다. 완성된 화면의 본문 칸과 같은 자리다.
          글이 차오르는 만큼 아래 회색 줄이 줄어든다 — 빈 화면이 채워지는 게 아니라
          이미 있는 글이 드러나는 것처럼 보여야 기다림이 짧게 느껴진다. */}
      <div className="relative">
        <div ref={tail}
             className="h-[60vh] overflow-y-auto pr-1 md:h-[calc(100vh-140px)]">
          {/* 완성된 읽기 화면과 같은 모양이다 — 시각 배지, 그 아래 본문.
              다 됐을 때 배지가 새로 생기면 글이 통째로 한 칸씩 밀려 내려간다. */}
          <div className="grid gap-7">
            {paras.map((para, i) => (
              <div key={i} className={i === paras.length - 1 ? "animate-[fade-up_.4s_ease-out]" : ""}>
                <span className="mb-2 inline-block rounded px-1.5 py-0.5 font-mono text-[11px] text-mfg
                                 bg-muted">
                  {mmss(para.at)}
                </span>
                <p className="text-[17px] leading-[1.9] tracking-[-.014em]">{para.text}</p>
              </div>
            ))}
          </div>
          <div ref={edge} />

          {/* 아직 안 온 자리. 남은 분량에 맞춰 줄 수를 줄인다 */}
          {ghosts > 0 && !made && (
            <div aria-hidden className={`grid gap-7 ${paras.length ? "mt-7" : ""}`}>
              {Array.from({ length: ghosts }, (_, i) => (
                <div key={i}>
                  {/* 시각 배지 자리도 비워 둔다. 글이 들어올 때 줄이 밀리지 않는다 */}
                  <div className="mb-2 h-[19px] w-9 animate-pulse rounded bg-muted"
                       style={{ animationDelay: `${i * 300}ms` }} />
                  <div className="space-y-2">
                    {[100, 96, 88, 62].map((w, j) => (
                      <div key={j} className="h-[15px] animate-pulse rounded bg-muted"
                           style={{ width: `${w}%`, animationDelay: `${(i * 4 + j) * 90}ms` }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 위로 올려 읽는 중일 때만. 받아쓰기는 계속 도는데 화면은 멈춰 있으니
            "지금 어디까지 왔나"로 돌아갈 길이 있어야 한다.
            문구는 짧게 — 글 위에 얹히는 것이라 길면 가리는 면적이 커진다. */}
        {stuck && (
          <button onClick={() => { setStuck(false); follow(); }}
                  className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5
                             rounded-full border border-line bg-bg/95 px-3.5 py-2 text-label
                             font-semibold shadow-lg backdrop-blur">
            맨 아래로 <span aria-hidden>↓</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** 초 → "0:00". 완성된 읽기 화면과 같은 표기다. */
function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** 단계마다 차지하는 몫. 받아쓰기가 제일 오래 걸린다. */
const WEIGHT: Record<Stage, [number, number]> = {
  전사: [0, 0.7], 목차: [0.7, 0.9], "검색 준비": [0.9, 1],
};

function pct(stage: Stage, ratio: number | null): number {
  const [from, to] = WEIGHT[stage];
  return Math.round((from + (to - from) * (ratio ?? 0)) * 100);
}

/** 받아쓰기는 실측으로 영상 길이의 15% 쯤 걸린다. 넉넉한 쪽으로 잡는다 —
 *  "1분"이라 해놓고 80초 걸리면 속은 기분이지만, 반대는 빨리 끝난 기분이다. */
function left(total: number, elapsed: number): string {
  if (!total) return `${elapsed}초째`;
  const whole = total * 0.15 + 25;
  const rest = Math.max(0, whole - elapsed);
  if (rest < 15) return "거의 다 됐어요";
  const m = Math.round(rest / 60);
  return m >= 1 ? `${m}분쯤 남았어요` : `${Math.round(rest / 10) * 10}초쯤 남았어요`;
}
