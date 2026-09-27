/** 라이브러리 전체 문단을 문맥 줄(영상 제목·채널·요지·목차)을 붙인 글로 다시 임베딩한다.
 *
 *    node --env-file=.env.local --import tsx scripts/reembed-context.ts <백업 파일 경로>
 *
 *  2026-09-27 검색 개선(src/lib/context.ts) 때 한 번 돌린다. 새로 들어오는 영상은 /api/embed 가 같은 글로 만든다.
 *  덮어쓰기 전에 지금 벡터를 백업 파일에 모두 적는다 — 되돌릴 때 이 파일을 다시 넣으면 된다.
 */
import { writeFileSync } from "node:fs";
import { db } from "../src/lib/supabase";
import { embed } from "../src/lib/embed";
import { searchText } from "../src/lib/context";
import { getVideo, putEmbeddings } from "../src/lib/store.supabase";

const backup = process.argv[2];
if (!backup) throw new Error("백업 파일 경로가 필요하다");

const { data: rows, error } = await db().from("chunk").select("video_id,seq,embedding").order("video_id").order("seq");
if (error) throw error;
writeFileSync(backup, JSON.stringify(rows));
const vids = [...new Set((rows ?? []).map(r => r.video_id as string))];
console.log(`백업 ${rows?.length}문단 · 영상 ${vids.length}편 → ${backup}`);

for (const vid of vids) {
  const v = await getVideo(vid);
  if (!v || !v.chunks.length) continue;
  const ctx = { title: v.title, channel: v.channel, tldr: v.tldr, outline: v.outline };
  const vectors: { seq: number; vector: number[] }[] = [];
  for (let i = 0; i < v.chunks.length; i += 16) {
    const batch = v.chunks.slice(i, i + 16);
    const out = await embed(batch.map(c => searchText(ctx, c)));
    batch.forEach((c, j) => vectors.push({ seq: c.seq, vector: out[j] }));
  }
  await putEmbeddings(vid, vectors);
  console.log(`${vid} ${vectors.length}문단 · 목차 ${v.outline.length} · 요지 ${v.tldr?.length ?? 0}`);
}
console.log("끝");
