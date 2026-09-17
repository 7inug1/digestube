"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef, useState } from "react";

export type Shot = { src: StaticImageData; alt: string; label: string };

/** 지금 시각. 컴포넌트 안에서 Date.now 를 직접 부르면 린트가 막는다(순수하지 않은 호출). */
const tick = () => Date.now();

/** 랜딩에서 화면 캡처를 한 장씩 돌려 보여준다.
 *
 *  한 장만 걸면 "영상 하나 읽는 것"으로만 읽힌다. 읽기·검색·라이브러리를
 *  차례로 보여줘야 무엇을 받는지가 다 전해진다.
 *
 *  누르는 물건이 아니라 보는 물건이라 그림에는 링크를 걸지 않는다 — 4초마다
 *  목적지가 바뀌는 링크는 누를 수 없다. 누르는 자리는 아래 카드가 맡는다.
 */
export default function ShotCarousel({ shots, ms = 4500 }: { shots: Shot[]; ms?: number }) {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);

  /** 이 장에 남은 시간. 멈췄다 다시 돌 때 처음부터 세면 막대(멈춘 자리에서 이어짐)와
   *  어긋난다 — 막대는 절반인데 4.5초를 또 기다리게 된다. */
  const left = useRef(ms);
  const from = useRef(0);
  const turned = useRef(false);

  const jump = (n: number) => { left.current = ms; setI(n); };

  useEffect(() => {
    if (held || shots.length < 2) return;
    // 움직임을 꺼 둔 사람에게는 돌리지 않는다. 막대 쪽은 CSS 가 같이 멈춘다
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    from.current = tick();
    const t = setTimeout(() => {
      turned.current = true;
      setI(n => (n + 1) % shots.length);
    }, left.current);
    return () => {
      clearTimeout(t);
      // 넘어가서 끝난 거면 다음 장은 처음부터, 손이 올라와 멈춘 거면 남은 만큼만
      if (turned.current) { turned.current = false; left.current = ms; }
      else left.current = Math.max(0, left.current - (tick() - from.current));
    };
  }, [i, held, ms, shots.length]);

  return (
    // 마우스를 올린 동안은 멈춘다. 읽는 중에 장이 넘어가면 다시 찾아 돌아와야 한다.
    // 키보드로 점에 닿았을 때도 같다.
    <div onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
         onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      {/* 장마다 세로 길이가 다르다. 한 틀에 겹쳐 놓고 위를 기준으로 잘라야
          넘어갈 때 아래 내용이 들썩이지 않는다. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-muted">
        {shots.map((s, n) => (
          <Image key={s.label} src={s.src} alt={s.alt} priority={n === 0}
                 sizes="(min-width: 640px) 620px, 100vw"
                 className={`absolute inset-0 h-full w-full object-cover object-top
                             transition-all duration-700 ease-out
                             ${n === i ? "scale-100 opacity-100" : "scale-[1.03] opacity-0"}`} />
        ))}

        {/* 막대는 그림 안쪽에 얹는다. 밖에 두면 그림과 따로 노는 부품이 되고,
            안에 얹으면 "이 그림이 넘어간다"는 게 한 덩어리로 읽힌다.
            위가 아니라 아래다 — 캡처마다 제 헤더(로고·메뉴)가 위에 있어서
            위에 얹으면 그 줄과 겹쳐 둘 다 못 읽는다. 흰 띠를 깔아 어떤 장이 와도
            막대가 묻히지 않게 한다. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12
                                    bg-gradient-to-t from-bg/85 to-transparent" />
        <div className="absolute inset-x-2.5 bottom-1 flex gap-2">
          {shots.map((s, n) => (
            // 칸을 똑같이 나눠 가진다 — 몇 장짜리인지가 폭으로 보인다.
            // 보이는 굵기는 1px 로 두고 누르는 자리만 위아래로 키운다(py-2.5 = 20px 씩).
            // 손가락은 1px 막대를 못 맞춘다 — 모바일에서 눌러도 아무 일이 없던 이유다.
            <button key={s.label} onClick={() => jump(n)}
                    aria-label={`${s.label} 보기`} aria-current={n === i}
                    className="group/bar flex flex-1 items-center py-2.5">
              <span className="relative h-1 w-full overflow-hidden rounded-full bg-fg/20
                               transition-colors group-hover/bar:bg-fg/35">
                {n === i && (
                  <span key={i} aria-hidden
                        className="shot-bar absolute inset-0 origin-left rounded-full bg-fg/85"
                        style={{animation: `shot-fill ${ms}ms linear forwards`,
                                animationPlayState: held ? "paused" : "running"}} />
                )}
                {/* 지나간 장은 채운 채로 둔다 — 어디까지 봤는지가 남는다 */}
                {n < i && <span aria-hidden className="absolute inset-0 rounded-full bg-fg/45" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 장마다 바뀌는 이 한 줄이 그림을 받는 말이라 그림 바로 밑 가운데 둔다 */}
      <div className="flex flex-col items-center">
        {/* 그림 밑 캡션이다. 굵고 크게 두면 이 줄이 섹션 제목처럼 읽혀 위 머리말과
            싸운다. 작고 옅게, 가운데로 — 그림을 받쳐 주는 자리로 둔다. */}
        <p className="mt-3.5 max-w-[34rem] text-center text-label leading-[1.6] text-mfg"
           aria-live="polite">{shots[i].label}</p>
      </div>
    </div>
  );
}
