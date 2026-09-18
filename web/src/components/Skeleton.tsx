/** 기다리는 동안 들어올 것의 모양을 미리 그려 둔다.
 *
 *  "불러오는 중…" 은 무엇이 들어올지 말해 주지 않고, 글이 들어오는 순간 화면이 통째로
 *  덜컥 바뀐다. 같은 자리에 같은 모양의 회색을 깔아 두면 들어올 자리가 미리 잡혀
 *  화면이 밀리지 않고, 기다림도 짧게 느껴진다.
 *
 *  줄마다 시작 시각을 조금씩 어긋나게 둔다 — 한꺼번에 깜빡이면 화면 전체가 숨쉬는
 *  것처럼 보여 오히려 눈에 거슬린다.
 */
export function Bar({ w = "100%", h = 14, delay = 0 }: { w?: string; h?: number; delay?: number }) {
  return (
    <div className="animate-pulse rounded bg-muted"
         style={{ width: w, height: h, animationDelay: `${delay}ms` }} />
  );
}

/** 라이브러리 카드 한 장 — 썸네일, 제목 두 줄, 채널 한 줄. */
export function CardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div>
      <div className="mb-3 aspect-video w-full animate-pulse rounded-xl bg-muted"
           style={{ animationDelay: `${delay}ms` }} />
      <div className="grid gap-1.5">
        <Bar w="92%" delay={delay + 80} />
        <Bar w="64%" delay={delay + 160} />
        <Bar w="44%" h={11} delay={delay + 240} />
      </div>
    </div>
  );
}
