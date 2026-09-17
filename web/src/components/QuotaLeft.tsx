"use client";

import { useEffect, useState } from "react";

/** 오늘 남은 무료 시간.
 *
 *  입력창 바로 아래에 둔다 — 쓰기 직전이 이 숫자가 필요한 순간이고, FAQ 에만
 *  적어 두면 거절당하고 나서야 상한을 알게 된다.
 *  고정 문구("하루 60분까지")로 적지 않는 이유는 남은 양이 사람마다 다르기 때문이다.
 *  못 읽으면 아무 말도 하지 않는다 — 틀린 숫자보다 없는 편이 낫다.
 */
export default function QuotaLeft({ done }: { done?: boolean }) {
  const [left, setLeft] = useState<number | null>(null);
  const [max, setMax] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/quota")
      .then(r => r.json())
      .then(d => { if (alive) { setLeft(d.left ?? null); setMax(d.max ?? 0); } })
      .catch(() => {});
    return () => { alive = false; };
    // 변환이 끝나면 다시 읽는다 — 줄어든 숫자가 바로 보여야 한다
  }, [done]);

  if (left === null) return null;
  const m = Math.floor(left / 60);
  return (
    <p className="mt-3 text-label text-mfg">
      {m > 0
        ? `오늘 ${m}분 더 변환할 수 있어요`
        : `오늘 몫(${max / 60}분)을 다 썼어요. 내일 다시 채워져요`}
    </p>
  );
}
