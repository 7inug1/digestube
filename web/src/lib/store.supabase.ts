/** 저장소 — Supabase(Postgres + pgvector).
 *
 *  부르는 쪽을 고치지 않고 갈아끼우려고 이 파일 하나로 모은다.
 *  화면은 여기 있는 함수만 알고, 어느 DB 를 쓰는지는 모른다.
 */
import { db } from "./supabase";

import type { Chunk, Hit, NewChunk, Outline, Video } from "./types";

export async function listVideos(): Promise<Video[]> {
  const { data, error } = await db()
    .from("video").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getVideo(vid: string) {
  const s = db();
  const [v, c, o] = await Promise.all([
    s.from("video").select("*").eq("id", vid).maybeSingle(),
    s.from("chunk").select("video_id,seq,t,t_end,text").eq("video_id", vid).order("seq"),
    s.from("outline").select("video_id,seq,t,label,quote").eq("video_id", vid).order("t"),
  ]);
  if (v.error) throw v.error;
  if (!v.data) return null;
  return {
    ...(v.data as Video),
    chunks: (c.data ?? []) as Chunk[],
    outline: (o.data ?? []) as Outline[],
  };
}

/** 문단 수와 영상 길이 — 목록에서 쓰려고 한 번에 센다. */
export async function statsOf(vids: string[]) {
  const { data, error } = await db()
    .from("chunk").select("video_id,t_end").in("video_id", vids);
  if (error) throw error;
  const out: Record<string, { chunks: number; seconds: number }> = {};
  for (const r of data ?? []) {
    const s = (out[r.video_id] ??= { chunks: 0, seconds: 0 });
    s.chunks += 1;
    s.seconds = Math.max(s.seconds, r.t_end as number);
  }
  return out;
}

/** 질문 벡터와 가까운 문단. 비교는 DB 가 한다(schema.sql 의 search_chunks). */
export async function search(q: number[], k = 5, vid?: string): Promise<Hit[]> {
  const { data, error } = await db().rpc("search_chunks", {
    q: JSON.stringify(q), k, only_video: vid ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Hit[];
}

/** 영상 한 건을 만들거나 갱신한다. */
export async function upsertVideo(v: Video) {
  const { error } = await db().from("video").upsert(v);
  if (error) throw error;
}

/** 그 영상의 문단을 통째로 갈아 끼운다. 다시 넣어도 겹치지 않게. */
export async function putChunks(vid: string, chunks: NewChunk[]) {
  const s = db();
  const del = await s.from("chunk").delete().eq("video_id", vid);
  if (del.error) throw del.error;
  if (!chunks.length) return 0;
  const rows = chunks.map((c, i) => ({
    id: `${vid}:${i}`, video_id: vid, seq: i,
    t: c.t, t_end: c.t_end, text: c.text,
  }));
  const { error } = await s.from("chunk").insert(rows);
  if (error) throw error;
  return rows.length;
}

/** 그 영상의 목차를 통째로 갈아 끼운다. 문단과 같은 방식. */
export async function putOutline(vid: string, items: Omit<Outline, "video_id">[]) {
  const s = db();
  const del = await s.from("outline").delete().eq("video_id", vid);
  if (del.error) throw del.error;
  if (!items.length) return 0;
  const { error } = await s.from("outline")
    .insert(items.map((o) => ({ ...o, video_id: vid })));
  if (error) throw error;
  return items.length;
}

/** 문단마다 벡터를 채운다. 문단은 그대로 두고 embedding 만 갱신한다. */
export async function putEmbeddings(vid: string, vectors: { seq: number; vector: number[] }[]) {
  const s = db();
  for (const { seq, vector } of vectors) {
    const { error } = await s.from("chunk")
      .update({ embedding: JSON.stringify(vector) })
      .eq("video_id", vid).eq("seq", seq);
    if (error) throw error;
  }
  return vectors.length;
}

/** 벡터가 아직 없는 문단만. 다시 돌려도 이미 만든 것은 건너뛴다. */
export async function chunksWithoutEmbedding(vid: string) {
  const { data, error } = await db()
    .from("chunk").select("seq,text").eq("video_id", vid).is("embedding", null).order("seq");
  if (error) throw error;
  return (data ?? []) as { seq: number; text: string }[];
}

/** 영상 한 편을 지운다. 문단·목차는 외래키로 같이 지워진다. */
export async function removeVideo(vid: string) {
  const { error } = await db().from("video").delete().eq("id", vid);
  if (error) throw error;
}
