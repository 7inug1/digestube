"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchForm({ q }: { q: string }) {
  const [input, setInput] = useState(q);
  const router = useRouter();
  const go = () => input.trim() && router.push(`/search?q=${encodeURIComponent(input)}`);

  return (
    <div className="flex gap-2">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder="뜻으로 찾습니다 — 영상에 없는 표현으로 물어봐도 됩니다"
        className="h-[46px] min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5
                   outline-none placeholder:text-mfg focus:border-fg focus:bg-bg"
      />
      <button onClick={go} disabled={!input.trim()}
              className="h-[46px] shrink-0 rounded-lg bg-fg px-5 text-[13.5px] font-semibold
                         text-bg disabled:cursor-default disabled:opacity-35">
        찾기
      </button>
    </div>
  );
}
