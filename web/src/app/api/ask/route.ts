import { NextResponse } from "next/server";
import { ndjson } from "@/lib/ndjson";
import { currentUser } from "@/lib/auth/server";
import { getVideo } from "@/lib/store";
import { meta } from "@/lib/youtube";
import { checkAsk, quotaKeys, spendAsk } from "@/lib/limits";
import { citations, cleanCitations, isDecline, streamAnswer, type Passage } from "@/lib/answer";

export const maxDuration = 60;

/** 검색 결과(최대 3개)를 근거로 답을 흘려보낸다. 화면이 "답이 있다"고 판단된 검색에서만 부른다.
 *  문단 본문은 화면이 보낸 글을 믿지 않고 DB 에서 다시 읽는다 — 근거가 조작되면 각주가 거짓말이 된다. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { q?: unknown; hits?: unknown } | null;
  const q = typeof body?.q === "string" ? body.q.trim() : "";
  const refs = Array.isArray(body?.hits) ? (body!.hits as { video_id?: unknown; seq?: unknown }[]).slice(0, 3) : [];
  if (!q || q.length > 300 || !refs.length || refs.some(r => typeof r.video_id !== "string" || typeof r.seq !== "number")) {
    return NextResponse.json({ error: "질문과 근거 문단이 필요해요." }, { status: 400 });
  }
  const me = await currentUser();
  const keys = quotaKeys(req, me?.id);
  const ok = await checkAsk(keys);
  if (!ok.ok) return NextResponse.json({ error: ok.error, code: ok.code }, { status: ok.status });

  return ndjson("ask", async send => {
    const passages: Passage[] = [];
    for (const r of refs as { video_id: string; seq: number }[]) {
      const v = await getVideo(r.video_id);
      const c = v?.chunks.find(x => x.seq === r.seq);
      if (!v || !c) continue;
      passages.push({ title: v.title ?? (await meta(r.video_id))?.title ?? r.video_id, t: c.t, text: c.text });
    }
    if (!passages.length) { send({ t: "error", error: "근거 문단을 찾지 못했어요." }); return; }
    // 모델을 부르기 전에 센다 — 도중에 끊겨도 비용은 나간다
    await spendAsk(keys);
    const all = await streamAnswer(q, passages, text => send({ t: "delta", text }), AbortSignal.timeout(30000));
    const text = cleanCitations(all.trim(), passages.length);
    send({ t: "done", text, cites: citations(text, passages.length), declined: isDecline(text) });
  });
}
