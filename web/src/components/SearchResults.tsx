"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Found, { type FoundHit } from "./Found";
import { mine } from "@/lib/mine";

/** 검색 결과. 범위가 "내 라이브러리"라 로그인하지 않은 사람은 이 브라우저 목록을
 *  같이 보내야 한다 — 그건 서버가 모르니 화면이 뜬 뒤에 물어본다. */
export default function SearchResults({ q, vid, signedIn }: { q: string; vid?: string; signedIn: boolean }) {
  const [hits, setHits] = useState<FoundHit[] | null>(null);
  const [failed, setFailed] = useState("");

  // q 가 바뀌면 결과를 버리고 다시 찾는다. key 로 이 컴포넌트를 새로 만들면
  // 효과 안에서 상태를 되돌리지 않아도 된다 — 아래 useEffect 가 그래서 단순하다.
  useEffect(() => {
    if (!q) return;
    let alive = true;
    const p = new URLSearchParams({ q });
    if (vid) p.set("vid", vid);
    if (!signedIn && !vid) p.set("ids", mine().join(","));
    fetch(`/api/search?${p}`)
      .then(r => r.json())
      .then(d => { if (!alive) return; if (d.error) setFailed(d.error); setHits(d.hits ?? []); })
      .catch(e => { if (alive) { setFailed((e as Error).message); setHits([]); } });
    return () => { alive = false; };
  }, [q, vid, signedIn]);

  if (!q) {
    return (
      <p className="mt-6 text-small text-mfg">
        글자가 아니라 뜻으로 찾아요. 영상에서 쓴 표현을 몰라도 돼요.
      </p>
    );
  }
  if (failed) return <p className="mt-6 text-small text-mfg">검색에 실패했어요 — {failed}</p>;
  if (hits === null) return <p className="mt-6 text-small text-mfg">찾는 중…</p>;

  const grouped = new Map<string, FoundHit[]>();
  for (const h of hits) grouped.set(h.video_id, [...(grouped.get(h.video_id) ?? []), h]);
  const groups = [...grouped.values()];

  if (!groups.length) {
    return (
      <div className="mt-6">
        <p className="mb-3 text-small text-mfg">
          {`“${q}”와 가까운 대목을 내 라이브러리에서 못 찾았어요.`}
        </p>
        <Link href="/" className="text-small font-semibold underline">영상 변환하러 가기 →</Link>
      </div>
    );
  }

  return (
    <>
      <p className="mt-6 text-small text-mfg">
        {`“${q}”와 가까운 영상 ${groups.length}편 · 관련 문단 ${hits.length}개`}
        {vid ? " · 이 영상 안에서" : ""}
      </p>
      <div className="mt-5 grid gap-3">
        {groups.map(g => <Found key={g[0].video_id} hits={g} />)}
      </div>
    </>
  );
}
