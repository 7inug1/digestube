import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { addToLibrary, libraryIds, removeFromLibrary, statsOf, videosByIds } from "@/lib/store";
import { readTime } from "@/lib/format";
import { meta, thumb } from "@/lib/youtube";
import { SAMPLE_IDS } from "@/lib/samples";

/** 라이브러리 = 내가 담은 영상. 로그인했으면 계정 것을, 아니면 브라우저가 보낸
 *  아이디 목록(localStorage)을 쓴다. 화면은 이 차이를 몰라도 된다. */
export async function GET(req: Request) {
  const user = await currentUser();
  const asked = new URL(req.url).searchParams.get("ids");
  const owned = user ? await libraryIds(user.id) : (asked ? asked.split(",").filter(Boolean) : []);
  // 맛보기는 뒤에 붙인다 — 내가 담은 것이 먼저다. 이미 담았으면 겹치지 않게 뺀다.
  const samples = SAMPLE_IDS.filter(id => !owned.includes(id));
  const all = await cards([...owned, ...samples]);
  return NextResponse.json({
    cards: all.map(c => (samples.includes(c.id) ? { ...c, sample: true } : c)),
  });
}

/** 로그인 직후 브라우저에 있던 목록을 계정으로 옮긴다. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const vids = Array.isArray(body?.vids) ? body.vids.filter((v: unknown) => typeof v === "string") : [];
  await addToLibrary(user.id, vids.slice(0, 200));
  return NextResponse.json({ ok: true, merged: vids.length });
}

/** 내 목록에서만 뺀다. 영상과 문단은 남는다 — 다른 사람이 보고 있을 수 있고,
 *  다시 담으면 변환 없이 바로 열린다. */
export async function DELETE(req: Request) {
  const vid = new URL(req.url).searchParams.get("vid");
  if (!vid) return NextResponse.json({ error: "영상을 지정해 주세요." }, { status: 400 });
  const user = await currentUser();
  if (user) await removeFromLibrary(user.id, vid);
  // 로그인하지 않았으면 지울 것이 서버에 없다 — 브라우저가 자기 목록에서 뺀다
  return NextResponse.json({ ok: true, vid });
}

export type Card = {
  id: string; src: string; title: string; channel: string;
  seconds: number; note: string; ready: boolean;
  /** 누구에게나 보이는 맛보기. 내 것이 아니라 뺄 수 없다. */
  sample?: boolean;
};

async function cards(ids: string[]): Promise<Card[]> {
  const videos = await videosByIds(ids);
  if (!videos.length) return [];
  const stats = await statsOf(videos.map(v => v.id));
  return Promise.all(videos.map(async v => {
    const [m, src] = await Promise.all([meta(v.id), thumb(v.id)]);
    return {
      id: v.id, src,
      title: m?.title ?? v.title ?? v.id,
      channel: m?.channel ?? "채널 미확인",
      seconds: stats[v.id]?.seconds ?? 0,
      note: `${readTime(v.chars ?? 0)} 분량`,
      // 문단이 없으면 열어도 볼 것이 없다. 목록에는 두되 눌리지 않게 한다.
      ready: (stats[v.id]?.chunks ?? 0) > 0,
    };
  }));
}
