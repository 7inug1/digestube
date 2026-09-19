"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { type Controls } from "./YouTube";
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

/** 접힌 띠의 작은 조작 단추. 손가락이 닿는 크기(40px)로 두고 그림만 바꿔 끼운다. */
function Tap({ label, n, onClick, children }: {
  label: string; n?: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} aria-label={label}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-mfg
                       transition hover:bg-muted hover:text-fg">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
        {/* 숫자는 화살표 안쪽에 넣는다. 밖에 적으면 단추가 커지고 셋이 벌어진다 */}
        {/* 숫자는 고리 한가운데. 고리를 거의 온전한 원으로 그리고 화살촉은 모서리로 뺐다 —
            화살촉이 위로 솟으면 무게중심이 올라가 숫자가 아래로 처져 보인다.
            central 로 세로 가운데를 맞추고, 숫자는 아래 획이 없어 0.6 만큼 내린다. */}
        {n && <text x="12" y="12.6" textAnchor="middle" dominantBaseline="central" fontSize="7"
                    fontWeight="700" letterSpacing="-.3" fill="currentColor" stroke="none">{n}</text>}
      </svg>
    </button>
  );
}

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
  /** 접힌 창을 화면 아래 띠로 더 접는다. iframe 은 그대로 살려 둬서 소리는 계속 나온다 —
   *  글을 읽으며 듣는 사람에게는 그게 맞다.
   *
   *  동그라미로도 해 봤는데 글 위에 떠서 무언가를 늘 가렸다. 아래 띠는 자기 자리를
   *  가지므로 가리는 것이 없고, 좌우로 옮길 이유도 사라진다. */
  const [folded, setFolded] = useState(false);
  /** 접힌 띠에는 유튜브 제 컨트롤이 안 보인다. 재생·정지·앞뒤 감기를 우리가 놓는다. */
  const controls = useRef<Controls | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 접힌 띠에 그릴 진행 위치. 띠를 보고 있을 때만 재고, 펴면 멈춘다 —
   *  영상이 제 컨트롤을 보여 주는 동안에는 우리가 잴 이유가 없다. */
  const [at, setAt] = useState({ now: 0, whole: 0 });
  useEffect(() => {
    if (!(mini && folded)) return;
    const tick = () => setAt(controls.current?.at() ?? { now: 0, whole: 0 });
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [mini, folded]);
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

  /** 접힘이 풀리면 직접 쓴 인라인 값을 비운다.
   *
   *  끄고 크기를 바꾸는 동안 style 을 직접 썼는데, 원래 자리로 돌아갈 때 React 의
   *  style 속성은 undefined 라 React 는 아무것도 지우지 않는다 — 자기가 쓴 값이
   *  아니기 때문이다. 그래서 줄여 둔 폭이 그대로 남아 큰 화면에서도 작게 나왔다. */
  useEffect(() => {
    // 접어 둔 상태는 유지한다. 최소화한 건 본인 뜻이고, 다시 내려왔을 때 제멋대로
    // 커져 있으면 읽던 자리를 가린다. 되돌리려면 동그라미를 한 번 누르면 된다.
    if (!mini) panel.current?.removeAttribute("style");
  }, [mini]);

  /** 끄는 동안에는 React 를 거치지 않는다. 전환도 꺼서 손가락을 그대로 따라오게 한다. */
  const hold = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => {
    el.style.transition = "none";
    Object.assign(el.style, style);
  };
  /** 손을 떼면 다시 React 가 그리게 둔다.
   *
   *  폭은 지우지 않고 제자리로 돌려놓는다. React 는 렌더 사이에 값이 같으면 다시 쓰지
   *  않는데, 우리가 직접 지워 버리면 React 는 그대로인 줄 알고 손대지 않는다 —
   *  폭이 사라져 창이 내용 크기(300px)로 벌어졌다. 왼쪽·위는 값이 달라지므로 React 가
   *  다시 쓴다. 오른쪽·아래는 style 객체에서 빠지므로 React 가 지운다. */
  const release = (el: HTMLElement, width: number) => {
    el.style.transition = "";
    el.style.width = `min(${width}px, 92vw)`;
  };

  const remember = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 사생활 보호 모드 등 */ }
  };

  /** 화면 안으로 되돌린다. 예전엔 가장 가까운 좌우 모서리로 붙였는데(자석) 뺐다 —
   *  크기를 바꿀 수 있게 된 뒤로는, 붙는 동작이 방금 잡아 놓은 자리를 자꾸 되돌려
   *  손이 한 번 더 가야 했다. 붙이든지 크기를 주든지 둘 중 하나여야 한다.
   *  화면 밖으로 나가는 것만 막는다. */
  const inside = (x: number, y: number) => {
    const box = panel.current?.getBoundingClientRect();
    const w = box?.width ?? size, h = box?.height ?? size * 0.5625, gap = 8;
    return {
      x: Math.min(Math.max(gap, x), Math.max(gap, window.innerWidth - w - gap)),
      y: Math.min(Math.max(gap + 56, y), Math.max(gap + 56, window.innerHeight - h - gap)),
    };
  };




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
                className={mini && folded
                  // 화면 아래 띠. 영상은 띠 뒤에 가려 있고 소리만 난다.
                  ? "fixed inset-x-0 bottom-0 z-40 h-16 overflow-hidden bg-bg shadow-[0_-4px_16px_rgba(0,0,0,.08)] [&_[data-testid=youtube-player]]:min-h-0 [&>div>p]:hidden"
                  : mini
                  // 접힌 창에서는 플레이어 아래 안내문("자동 재생이 차단됐어요")을 숨긴다.
                  // 작은 창에 글이 붙으면 창이 영상보다 길어지고, 그 글이 아래 모서리의
                  // 크기 손잡이를 덮어 잡을 수 없게 된다.
                  ? "fixed z-40 overflow-hidden rounded-xl bg-bg shadow-2xl ring-1 ring-line [&_[data-testid=youtube-player]]:min-h-0 [&>div>p]:hidden"
                  : "absolute inset-0"}
                style={mini && folded
                  // 끌던 중에 직접 쓴 값이 남아 있을 수 있어 여기서 못박는다
                  ? {left: 0, right: 0, top: "auto", bottom: 0, width: "auto"}
                  : mini
                  ? {width: `min(${size}px, 92vw)`, ...(spot ? {left: spot.x, top: spot.y} : {right: 12, bottom: 12}),
                     transition: "left .18s ease-out, top .18s ease-out"}
                  : undefined}>
                {mini && folded && (
                  // 영상 위를 덮는다. 뒤의 iframe 은 그대로 돌아가고 소리만 들린다.
                  <div className="absolute inset-0 z-20 flex items-center gap-3 bg-bg px-3 pt-[3px]">
                    {/* 진행 막대는 띠의 맨 윗변 그 자체다. 위에 테두리를 따로 두면 선이 둘로
                        보이므로 테두리를 없애고, 이 막대의 바탕(bg-line)이 경계선 노릇을 한다.
                        보이는 굵기는 3px, 누르는 자리는 아래로 넓힌다 — 손가락은 3px 를 못 맞춘다. */}
                    <button aria-label="재생 위치 이동"
                            onClick={e => {
                              const box = e.currentTarget.getBoundingClientRect();
                              if (at.whole) controls.current?.goTo(at.whole * ((e.clientX - box.left) / box.width));
                            }}
                            // button 은 안의 내용을 세로 가운데 둔다. 그대로 두면 16px 누르는 자리
                            // 한가운데에 막대가 떠서 위로 6.5px 빈틈이 생긴다 — 맨 위에 붙인다.
                            className="group/seek absolute inset-x-0 top-0 z-10 flex h-4 cursor-pointer items-start">
                      <span className="block h-[3px] w-full bg-line transition-[height] group-hover/seek:h-1.5">
                        <span className="block h-full bg-fg transition-[width] duration-500 ease-linear"
                              style={{width: `${at.whole ? Math.min(100, (at.now / at.whole) * 100) : 0}%`}} />
                      </span>
                    </button>

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`} alt=""
                         className="h-8 w-14 shrink-0 rounded-md bg-muted object-cover" />

                    {/* 제목은 넓을 때만. 좁은 화면에서는 시간이 더 쓸모 있다 —
                        무엇을 듣는지는 이미 알고, 어디쯤인지가 궁금하다. */}
                    <div className="min-w-0 flex-1">
                      <p className="hidden truncate text-[13px] font-medium sm:block">{meta.title}</p>
                      <p className="font-mono text-[11.5px] tabular-nums text-mfg">
                        {mm(at.now)} <span className="opacity-50">/ {mm(at.whole || meta.seconds)}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tap label="10초 뒤로" n="10" onClick={() => controls.current?.nudge(-10)}>
                        <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M6.7 3v3.7h3.7" />
                      </Tap>
                      <button onClick={() => playing ? controls.current?.pause() : controls.current?.play()}
                              aria-label={playing ? "일시정지" : "재생"}
                              className="mx-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full
                                         bg-fg text-bg transition hover:opacity-85">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l11-6.5z" />}
                        </svg>
                      </button>
                      <Tap label="10초 앞으로" n="10" onClick={() => controls.current?.nudge(10)}>
                        <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M17.3 3v3.7h-3.7" />
                      </Tap>
                    </div>

                    <button onClick={() => setFolded(false)} aria-label="영상 다시 보기"
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg
                                       text-mfg transition hover:bg-muted hover:text-fg">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m6 15 6-6 6 6" />
                      </svg>
                    </button>
                  </div>
                )}
                {mini && !folded && (
                  <div onPointerDown={e => {
                         const el = panel.current;
                         const box = el?.getBoundingClientRect();
                         if (!el || !box) return;
                         const dx = e.clientX - box.left, dy = e.clientY - box.top;
                         // 끄는 동안에는 React 를 거치지 않고 style 을 직접 쓴다. 상태를 매번
                         // 바꾸면 손가락이 움직일 때마다 화면 전체가 다시 그려져 버벅인다.
                         // 전환(transition)도 끈다 — 켜 두면 손가락을 따라오다 뒤늦게 미끄러진다.
                         // 폭을 지금 값으로 못박는다. 안 박아 두면 창이 화면 가장자리에
                         // 닿을 때 min(…, 92vw) 이 다시 계산돼 끄는 중에 크기가 변한다.
                         // 브라우저 자체 제스처(확대·당겨서 새로고침)도 여기서 막는다.
                         e.preventDefault();
                         (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                         hold(el, {left: `${box.left}px`, top: `${box.top}px`,
                                   right: "auto", bottom: "auto", width: `${box.width}px`});
                         let last = {x: box.left, y: box.top};
                         track(ev => {
                           last = {
                             x: Math.min(Math.max(8, ev.clientX - dx), window.innerWidth - el.offsetWidth - 8),
                             y: Math.min(Math.max(8, ev.clientY - dy), window.innerHeight - el.offsetHeight - 8),
                           };
                           el.style.left = `${last.x}px`;
                           el.style.top = `${last.y}px`;
                         }, () => {
                           // 손을 떼면 가까운 모서리로 붙는다. 이때 다시 React 에 맡긴다.
                           release(el, size);
                           last = inside(last.x, last.y);
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
                    {/* 동그라미로 접는다. 닫지 않는 이유는 소리를 계속 듣는 사람이 있어서다 —
                        닫아 버리면 재생이 끊기고 처음부터 다시 틀어야 한다. */}
                    <button onClick={() => setFolded(true)} aria-label="영상 최소화"
                      className="ml-auto grid h-5 w-5 place-items-center rounded hover:bg-white/20">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           strokeWidth="2.4" strokeLinecap="round">
                        <path d="M5 12h14" />
                      </svg>
                    </button>
                    <button onClick={() => window.scrollTo({top: 0, behavior: "smooth"})}
                      aria-label="영상 원래 자리로"
                      className="grid h-5 w-5 place-items-center rounded hover:bg-white/20">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 15 6-6 6 6" />
                      </svg>
                    </button>
                  </div>
                )}
                <YouTube videoId={vid} seek={seek} nonce={nonce} autoplay={nonce > 0}
                                 onControls={c => { controls.current = c; }}
                                 onPlaying={setPlaying} />
                {mini && !folded && (
                  <div onPointerDown={e => {
                         const el = panel.current;
                         const box = el?.getBoundingClientRect();
                         if (!el || !box) return;
                         const from = {x: e.clientX, w: box.width, right: box.right, top: box.top};
                         e.preventDefault();
                         (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                         hold(el, {left: `${box.left}px`, top: `${box.top}px`, right: "auto", bottom: "auto"});
                         let last = box.width;
                         track(ev => {
                           // 왼쪽으로 끌면 커진다. 오른쪽 변은 제자리에 둔다.
                           last = Math.round(Math.min(Math.max(140, from.w + (from.x - ev.clientX)), window.innerWidth * 0.92));
                           el.style.width = `${last}px`;
                           el.style.left = `${Math.max(8, from.right - last)}px`;
                         }, () => {
                           release(el, last);
                           setSize(last);
                           const at = inside(Math.max(8, from.right - last), from.top);
                           setSpot(at);
                           remember("digestube:mini-spot", at);
                           remember("digestube:mini-size", last);
                         });
                       }}
                       aria-label="창 크기 조절"
                       // 보이게 둔다. 예전엔 커서로만 알렸는데, 손가락에는 커서가 없어서
                       // 모바일에서는 이런 것이 있는 줄도 몰랐다. 손가락이 닿는 크기(44px)로 키운다.
                       className="absolute bottom-0 left-0 z-10 grid h-11 w-11 cursor-nesw-resize
                                  touch-none place-items-end justify-items-start p-1.5">
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden
                         className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]">
                      <path d="M1 13h12M1 13V1" stroke="none" />
                      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <path d="M2 12h10" opacity=".9" /><path d="M2 12V2" opacity=".9" />
                        <path d="M2 12 8 6" opacity=".55" />
                      </g>
                    </svg>
                  </div>
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

      {/* 한 줄이 너무 길면 눈이 다음 줄 첫 글자를 못 찾는다. 넓은 화면에서 오른쪽 칸은
          700px 를 넘는데, 한글 17px 기준 한 줄에 45자가 넘어간다. 종이책이 대개 35~40자다.
          폭을 잡고 가운데 두면 화면이 넓어져도 읽는 리듬이 그대로다. */}
      {/* 아래 띠가 떠 있을 때는 글 끝에 그만큼 자리를 비운다 — 마지막 문단이 띠에 가린다 */}
      <div className={`mx-auto w-full max-w-[40rem] ${mini && folded ? "pb-20" : ""}`}>
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
