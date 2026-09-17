"use client";

import { useEffect, useRef, useState } from "react";
import YouTube from "./YouTube";
import SearchForm from "./SearchForm";

type Chunk = { seq: number; t: number; t_end: number; text: string };
type Outline = { seq: number; t: number; label: string };
type Meta = {
  title: string; channel: string; seconds: number; read: string;
  mode?: string | null; lang?: string | null;
  /** 유튜브에서 받아 온 것들. 없으면 없는 대로 그린다 — 꾸밈 때문에 읽기가 막히면 안 된다. */
  avatar?: string | null; published?: string | null; views?: string | null;
  /** 세 줄 요약. 목차 위에 둔다 — 목차보다 먼저 읽히는 것이 순서에 맞다. */
  tldr?: string[] | null;
};

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

  /* 목차가 가리키는 문단에 그 제목을 끼워 넣는다. 옆 목차만 있으면 눌러서 뛴 뒤
     "여기가 몇 번이었지"를 다시 옆에서 찾아야 하고, 그냥 읽어 내려갈 때는
     어디서 화제가 바뀌는지 전혀 보이지 않는다. */
  const heads = new Map(outline.map((o, i) => [o.seq, { n: i + 1, label: o.label }]));

  /* 좁은 화면에서 영상이 위로 사라지면 오른쪽 아래 작은 창으로 내려앉는다.
     화면 위에 계속 붙여두면 글 읽을 자리를 3분의 1이나 먹는다.
     iframe 은 그대로 두고 감싼 상자의 자리만 바꾼다 — 다시 만들면 재생이 끊긴다. */
  const marker = useRef<HTMLDivElement>(null);
  const [mini, setMini] = useState(false);
  useEffect(() => {
    const el = marker.current;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 768px)");
    // 보이는지(seen)와 좁은 화면인지(wide)를 따로 들고, 둘 중 하나가 바뀌면 다시 센다.
    // 예전엔 화면 폭이 바뀌어도 넓어질 때만 접힌 창을 껐다. 넓다가 좁히면 IntersectionObserver
    // 는 다시 울지 않으니(보이는 상태가 안 바뀌었으므로) 영상이 제자리에 없는 채로 남았다.
    let seen = true;
    const apply = () => setMini(!wide.matches && !seen);
    // 헤더 밑으로 가려진 것도 "안 보이는" 것으로 친다.
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; apply(); },
      {rootMargin: "-64px 0px 0px 0px"});
    io.observe(el);
    wide.addEventListener("change", apply);
    return () => { io.disconnect(); wide.removeEventListener("change", apply); };
  }, []);
  /* 접힌 창은 손잡이를 잡아 옮길 수 있다. iframe 위에서는 마우스 이벤트가
     유튜브로 먹혀서 재생 조작이 막히므로, 위쪽 손잡이에서만 끈다.
     놓은 자리는 브라우저에 기억해 다음에 열어도 그대로 둔다. */
  const [spot, setSpot] = useState<{x: number; y: number} | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem("digestube:mini-spot");
      return saved ? JSON.parse(saved) as {x: number; y: number} : null;
    } catch { return null; }  // 사생활 보호 모드 등에서 막힐 수 있다 — 기본 자리로 둔다
  });
  const panel = useRef<HTMLDivElement>(null);
  /* 접힌 창 크기. 왼쪽 아래 모서리를 끌어 바꾼다 — 버튼을 따로 두지 않는다. */
  const DEFAULT_SIZE = 200;
  const [size, setSize] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_SIZE;
    try {
      const saved = Number(JSON.parse(localStorage.getItem("digestube:mini-size") ?? "0"));
      return saved >= 120 && saved <= 2000 ? saved : DEFAULT_SIZE;
    } catch { return DEFAULT_SIZE; }
  });
  /** 누르는 순간 리스너를 붙인다. 효과에 맡기면 ref 변경이 효과를 다시 돌리지 않아
   *  손잡이를 잡아도 아무 일이 일어나지 않는다(크기 조절이 그렇게 안 먹었다). */
  function track(onMove: (e: PointerEvent) => void, onDone: () => void) {
    const move = (e: PointerEvent) => onMove(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onDone();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const remember = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 사생활 보호 모드 등 */ }
  };

  /** 놓으면 가장 가까운 모서리로 붙는다 — iOS PiP 가 그렇게 동작한다.
   *  자유 위치로 두면 글을 가리는 자리에 어중간하게 남는다. */
  const snap = (x: number, y: number) => {
    const box = panel.current?.getBoundingClientRect();
    const w = box?.width ?? size, h = box?.height ?? size * 0.5625, gap = 12;
    const left = gap, right = window.innerWidth - w - gap;
    const top = gap + 56, bottom = window.innerHeight - h - gap;   // 위쪽은 헤더를 피한다
    return {
      x: x + w / 2 < window.innerWidth / 2 ? left : right,
      y: Math.min(Math.max(top, y), bottom),
    };
  };

  /** 두 손가락으로 벌리고 오므려 크기를 바꾼다. 모서리를 집는 것보다 손에 익다. */
  function pinch(e: React.PointerEvent<HTMLDivElement>) {
    const points = new Map<number, {x: number; y: number}>();
    points.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    let startGap = 0, startSize = box.width, last = box.width;
    const gapOf = () => {
      const [a, b] = [...points.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const move = (ev: PointerEvent) => {
      if (!points.has(ev.pointerId)) return;
      points.set(ev.pointerId, {x: ev.clientX, y: ev.clientY});
      if (points.size < 2) return;
      const gap = gapOf();
      if (!startGap) { startGap = gap; startSize = last; return; }
      last = Math.round(Math.min(Math.max(120, startSize * (gap / startGap)), window.innerWidth * 0.92));
      setSize(last);
      setSpot(cur => cur ? snap(cur.x, cur.y) : cur);
    };
    const down = (ev: PointerEvent) => points.set(ev.pointerId, {x: ev.clientX, y: ev.clientY});
    const up = (ev: PointerEvent) => {
      points.delete(ev.pointerId);
      if (points.size) { startGap = 0; return; }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      remember("digestube:mini-size", last);
      setSpot(cur => { const next = cur ? snap(cur.x, cur.y) : cur; if (next) remember("digestube:mini-spot", next); return next; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }


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
        {/* 영상·제목·목차를 합치면 화면보다 길어진다. 붙여만 두면(sticky) 넘치는 만큼이
            화면 밖에 남아 목차 아래쪽에 닿을 방법이 없다 — 오른쪽 글을 끝까지 내려야
            겨우 보였다. 화면 높이로 잘라 두고 안에서 따로 구르게 한다.
            좁은 화면에서는 위아래로 쌓이므로 한 덩어리로 구른다. */}
        <div className="grid gap-4 md:sticky md:top-[76px] md:max-h-[calc(100vh-92px)]
                        md:overflow-y-auto md:pr-1">
          <div className="-mx-5 md:mx-0">
            {/* 바깥 상자는 접히든 말든 늘 같은 높이를 갖는다. 높이가 흔들리면
                마커가 화면 경계를 오가며 접힘·펼침이 반복된다. */}
            <div className="relative aspect-video w-full">
              <div ref={panel}
                // 접힌 창은 작아서 플레이어의 최소 높이(210px)를 풀어야 비율이 맞는다.
                className={mini
                  ? "fixed z-40 overflow-hidden rounded-xl bg-bg shadow-2xl ring-1 ring-line [&_[data-testid=youtube-player]]:min-h-0"
                  : "absolute inset-0"}
                onPointerDown={mini ? pinch : undefined}
                style={mini
                  ? {width: `min(${size}px, 92vw)`, ...(spot ? {left: spot.x, top: spot.y} : {right: 12, bottom: 12}),
                     transition: "left .18s ease-out, top .18s ease-out"}
                  : undefined}>
                {mini && (
                  <div onPointerDown={e => {
                         const box = panel.current?.getBoundingClientRect();
                         if (!box) return;
                         const dx = e.clientX - box.left, dy = e.clientY - box.top;
                         setSpot({x: box.left, y: box.top});   // 오른쪽 기준에서 좌표 기준으로 옮긴다
                         let last = {x: box.left, y: box.top};
                         track(ev => {
                           const w = panel.current?.offsetWidth ?? box.width;
                           const h = panel.current?.offsetHeight ?? box.height;
                           last = {
                             x: Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - w - 8),
                             y: Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - h - 8),
                           };
                           setSpot(last);
                         }, () => {
                           // 손을 떼면 가까운 모서리로 붙는다.
                           last = snap(last.x, last.y);
                           setSpot(last);
                           remember("digestube:mini-spot", last);
                         });
                       }}
                       className="flex h-7 cursor-grab touch-none items-center gap-1 bg-black/80 px-2 text-white active:cursor-grabbing">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
                      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                    </svg>
                    <button onClick={() => window.scrollTo({top: 0, behavior: "smooth"})}
                      aria-label="영상 원래 자리로"
                      className="ml-auto grid h-5 w-5 place-items-center rounded hover:bg-white/20">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 15 6-6 6 6" />
                      </svg>
                    </button>
                  </div>
                )}
                <YouTube videoId={vid} seek={seek} nonce={nonce} autoplay={nonce > 0} />
                {mini && (
                  <div onPointerDown={e => {
                         const box = panel.current?.getBoundingClientRect();
                         if (!box) return;
                         const from = {x: e.clientX, w: box.width, right: box.right, top: box.top};
                         setSpot({x: box.left, y: box.top});
                         let last = box.width;
                         track(ev => {
                           // 왼쪽으로 끌면 커진다. 오른쪽 변은 제자리에 둔다.
                           last = Math.round(Math.min(Math.max(120, from.w + (from.x - ev.clientX)), window.innerWidth * 0.9));
                           setSize(last);
                           setSpot({x: Math.max(8, from.right - last), y: from.top});
                         }, () => remember("digestube:mini-size", last));
                       }}
                       aria-label="창 크기 조절"
                       // 보이는 것은 두지 않는다. 커서만 바뀌어 잡을 수 있다는 걸 알린다.
                       className="absolute bottom-0 left-0 z-10 h-7 w-7 cursor-nesw-resize touch-none" />
                )}
              </div>
            </div>
            {/* 마커는 영상 자리 바로 아래 끝에 둔다. 위쪽 끝에 두면 영상 윗부분만
                가려져도 너무 일찍 접힌다. */}
            <div ref={marker} className="h-px w-full" />
          </div>

          <div>
            <h1 className="text-[17px] font-[680] leading-[1.38] tracking-[-.03em]">
              {meta.title}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              {/* 채널 사진이 오면 그걸 쓴다. 첫 글자만 넣은 동그라미는 "누가 한 말인지"를
                  알려주지 못하는데, 말한 사람이 누구인지가 이 글의 절반이다. */}
              {meta.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.avatar} alt="" loading="lazy"
                     className="h-6 w-6 shrink-0 rounded-full bg-muted object-cover" />
              ) : (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-mfg">
                  {meta.channel.slice(0, 1)}
                </span>
              )}
              <span className="truncate text-[12.5px] font-medium">{meta.channel}</span>
              <span className="shrink-0 text-[11.5px] text-mfg">· {mm(meta.seconds)} · {meta.read} 분량</span>
              <a href={`https://youtu.be/${vid}`} target="_blank" rel="noreferrer"
                 className="ml-auto text-[11.5px] text-mfg underline underline-offset-2 hover:text-fg">
                유튜브에서 보기
              </a>
            </div>
            {(meta.published || meta.views) && (
              <p className="mt-1.5 text-[11.5px] text-mfg">
                {[meta.published, meta.views && `조회 ${meta.views}회`].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>

          {/* 전사 방식은 읽는 사람에게 필요한 정보일 때만 적는다.
              기존 자막은 번역본이 섞일 수 있어 밝히고, 받아쓴 것은 그대로 읽으면 된다.
              출처를 모르는 옛 영상은 아무 말도 하지 않는다 — 빈 딱지는 방해만 된다. */}
          {meta.mode === "native" && (
            <p className="text-[11.5px] text-mfg">기존 자막 · 번역 자막일 수 있음</p>
          )}

          {/* 목차는 왼쪽이다. 한 번 읽고 마는 요약과 달리 읽는 내내 돌아오는 곳이라,
              글과 같이 흘러가면 매번 위로 되짚어 올라가야 한다.
              붙어 있는 칸(sticky)에 두면 언제든 손이 닿는다. */}
          {/* 읽다가 "그 얘기 어디서 했더라" 하는 순간이 이 화면에서 생긴다.
              그때 헤더를 찾아 누르고 새 화면으로 가게 두면 대개 그냥 넘긴다. */}
          <SearchForm q="" vid={vid} small />

          {outline.length > 0 && (
            <div className="rounded-xl bg-muted/60 p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[.12em] text-mfg">목차</div>
              <ol className="grid">
                  {outline.map((o, i) => (
                    <li key={o.seq}>
                      <button onClick={() => jump(o.t, o.seq)}
                              className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-bg">
                        <span className="w-4 shrink-0 font-mono text-[11px] text-mfg">{i + 1}</span>
                        <span className="flex-1 text-[13px] leading-[1.6]">{o.label}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-mfg">{mm(o.t)}</span>
                      </button>
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </div>
      </aside>

      <div>
        {/* 요약은 글 바로 위다. 읽기 시작하기 전에 한 번 보는 것이라, 왼쪽에 두면
            영상·제목 다음으로 밀리고 좁은 화면에서는 더 그렇다.
            한 번 읽고 마는 것이라 붙여 둘 이유도 없다 — 목차와 반대다. */}
        {meta.tldr && meta.tldr.length > 0 && (
          <div className="mb-6 rounded-xl bg-muted/60 p-4">
            <p className="mb-2 text-[11.5px] font-semibold text-mfg">세 줄 요약</p>
            <ul className="grid gap-1.5">
              {meta.tldr.map((line, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-[1.6]">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-mfg" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chunks.map((c) => {
          const on = selectedSeq === c.seq;
          const head = heads.get(c.seq);
          return (
            <section key={c.seq} id={`ck${c.seq}`}
                     className={`scroll-mt-24 border-b border-line last:border-0 ${
                       head ? "pb-5 pt-12 first:pt-5" : "py-5"}`}>
              {/* 제목은 본문(17px)보다 커야 제목으로 읽힌다. 전에는 15.5px 이라
                  본문보다 작아서 앞에 붙은 짧은 문장처럼 보였다.
                  번호는 색을 뒤집은 딱지로 제목과 한 줄에 둔다. 옆에 따로 선을 그으면
                  문단 사이 경계선과 겹쳐 가로줄이 둘로 보인다 — 위 여백이 이미 장이
                  바뀐다는 말을 하고 있어서 선은 더 필요 없다. */}
              {head && (
                <h2 className="mb-5 flex items-start gap-3 text-[21px] font-[720]
                               leading-[1.4] tracking-[-.03em] sm:text-[23px]">
                  <span className="mt-[3px] grid h-[26px] min-w-[26px] shrink-0 place-items-center
                                   rounded-md bg-fg px-1.5 font-mono text-[12px] font-semibold text-bg">
                    {head.n}
                  </span>
                  <span>{head.label}</span>
                </h2>
              )}
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
