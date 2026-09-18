"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 검색칸.
 *
 *  예전엔 검색 화면에만 있었다. 그런데 "그 얘기 어디서 했더라"는 읽는 중에 생기는
 *  생각이고, 그때 화면에는 검색이 없었다 — 헤더 글자를 찾아 누르고 새 화면으로 가야 했다.
 *  이제 라이브러리 위와 읽기 화면에도 같은 칸을 둔다. 필요한 자리에 있어야 쓴다.
 *
 *  vid 를 주면 그 영상 안에서만 찾는다.
 */
export default function SearchForm({ q, vid, small }: { q: string; vid?: string; small?: boolean }) {
  const [input, setInput] = useState(q);
  const router = useRouter();
  const go = () => {
    if (!input.trim()) return;
    const p = new URLSearchParams({ q: input });
    if (vid) p.set("vid", vid);
    router.push(`/search?${p}`);
  };
  const h = small ? "h-9" : "h-[46px]";

  return (
    <div className="flex gap-2">
      <input
        aria-label="검색어"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder={vid ? "이 영상에서 궁금한 내용을 찾아보세요" : "뜻으로 찾아요 — 영상에 없는 표현으로 물어봐도 돼요"}
        className={`${h} min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5
                   text-[13.5px] outline-none placeholder:text-mfg focus:border-fg focus:bg-bg`}
      />
      <button onClick={go} disabled={!input.trim()}
              className={`${h} shrink-0 rounded-lg bg-fg px-4 text-[13.5px] font-semibold
                         text-bg disabled:cursor-default disabled:opacity-35`}>
        찾기
      </button>
    </div>
  );
}
