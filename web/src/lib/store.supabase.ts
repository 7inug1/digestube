/** 저장소 — Supabase(Postgres + pgvector).
 *
 *  부르는 쪽을 고치지 않고 갈아끼우려고 이 파일 하나로 모은다.
 *  화면은 여기 있는 함수만 알고, 어느 DB 를 쓰는지는 모른다.
 */
import { db } from "./supabase";

import type { Chunk, Hit, NewChunk, Outline, Video } from "./types";

/** 라이브러리에 내보낼 영상.
 *
 *  2026-09-13: Gemini 전사·모델 청킹·목차가 모두 끝난 8편만 남기고 나머지는
 *  DB 에서 뺐다(백업은 data/evals/removed-2026-09-13/). 그래서 목록에 거르는
 *  조건은 "목차가 있는가" 하나면 된다.
 *
 *  전에 있던 길이 추정(최장 문단 340자 초과 = 모델 청킹)은 지웠다.
 *  짧은 영상은 모델이 나눠도 문단이 짧아서 NtHSSWC04Do(최장 227자)가
 *  코드 청킹으로 잘못 걸러졌다. 길이로 출처를 맞히는 건 성립하지 않는다.
 *
 *  검색은 이 필터를 보지 않고 DB 의 모든 문단을 뒤진다. 목록과 검색이 같은
 *  영상을 보게 하려면 DB 자체를 정리해야 한다 — 그래서 위처럼 뺐다.
 */
export async function listVideos(): Promise<Video[]> {
  const { data, error } = await db()
    .from("video").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  if (process.env.LIBRARY_ALL === "1") return rows;
  // 목차가 없으면 열어도 볼 것이 반쯤 비어 있다.
  const counts = await outlineCounts(rows.map(v => v.id));
  return rows.filter(v => (counts[v.id] ?? 0) > 0);
}

/** 내가 담은 영상 아이디. 최근에 담은 것이 앞에 온다. */
export async function libraryIds(userId: string): Promise<string[]> {
  const { data, error } = await db()
    .from("library").select("video_id").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => r.video_id as string);
}

/** 담은 게 하나라도 있나. 목록을 다 읽지 않고 세기만 한다. */
export async function libraryCount(userId: string): Promise<number> {
  const { count, error } = await db()
    .from("library").select("*", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

/** 담는다. 이미 있으면 아무 일도 없다 — 같은 영상을 두 번 담아도 오류가 아니다. */
export async function addToLibrary(userId: string, vids: string[]) {
  if (!vids.length) return;
  const { error } = await db()
    .from("library").upsert(vids.map(v => ({ user_id: userId, video_id: v })), { onConflict: "user_id,video_id" });
  if (error) throw error;
}

/** 내 목록에서만 뺀다. 영상 자체는 남는다. */
export async function removeFromLibrary(userId: string, vid: string) {
  const { error } = await db().from("library").delete().eq("user_id", userId).eq("video_id", vid);
  if (error) throw error;
}

/** 공유 주소 한 조각. 지금 공유 중이면 share_id, 아니면 null. */
export async function shareOf(userId: string): Promise<{shareId: string; name: string | null} | null> {
  const { data, error } = await db()
    .from("library_share").select("share_id,name").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? {shareId: data.share_id, name: data.name ?? null} : null;
}

/** 공유 화면에 띄울 이름. 비우면 이름 없이 보인다. */
export async function setShareName(userId: string, name: string | null) {
  const { error } = await db().from("library_share").update({ name }).eq("user_id", userId);
  if (error) throw error;
}

/** 공유를 켠다. 이미 켜져 있으면 쓰던 주소를 그대로 돌려준다 —
 *  켤 때마다 주소가 바뀌면 남에게 준 링크가 조용히 죽는다. */
export async function startShare(userId: string, shareId: string): Promise<string> {
  const now = await shareOf(userId);
  if (now) return now.shareId;
  const { error } = await db().from("library_share").insert({ user_id: userId, share_id: shareId });
  if (error) throw error;
  return shareId;
}

export async function stopShare(userId: string) {
  const { error } = await db().from("library_share").delete().eq("user_id", userId);
  if (error) throw error;
}

/** 공유 주소로 주인을 찾는다. 없으면 null — 공유를 껐거나 없는 주소다. */
export async function userByShare(shareId: string): Promise<{userId: string; name: string | null} | null> {
  const { data, error } = await db()
    .from("library_share").select("user_id,name").eq("share_id", shareId).maybeSingle();
  if (error) throw error;
  return data ? {userId: data.user_id, name: data.name ?? null} : null;
}

/** 아이디로 영상을 가져온다. 넘긴 순서를 지킨다 — 담은 순서가 목록 순서다. */
export async function videosByIds(ids: string[]): Promise<Video[]> {
  if (!ids.length) return [];
  const { data, error } = await db().from("video").select("*").in("id", ids);
  if (error) throw error;
  const by = new Map((data ?? []).map(v => [v.id, v as Video]));
  return ids.map(id => by.get(id)).filter((v): v is Video => Boolean(v));
}

export async function getVideo(vid: string) {
  const s = db();
  const [v, c, o] = await Promise.all([
    s.from("video").select("*").eq("id", vid).maybeSingle(),
    s.from("chunk").select("video_id,seq,t,t_end,text").eq("video_id", vid).order("seq"),
    s.from("outline").select("*").eq("video_id", vid).order("seq"),
  ]);
  if (v.error) throw v.error;
  if (c.error) throw c.error;
  if (o.error) throw o.error;
  if (!v.data) return null;
  return {
    ...(v.data as Video),
    chunks: (c.data ?? []) as Chunk[],
    outline: (o.data ?? []) as Outline[],
  };
}

/** 목차가 몇 개 붙어 있는지 — 랜딩에서 "읽을 준비가 끝난" 영상만 고르려고 센다. */
export async function outlineCounts(vids: string[]) {
  const { data, error } = await db()
    .from("outline").select("video_id").in("video_id", vids);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.video_id] = (out[r.video_id] ?? 0) + 1;
  return out;
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
export async function search(q: number[], k = 5, vid?: string, ids?: string[]): Promise<Hit[]> {
  const { data, error } = await db().rpc("search_chunks", {
    q: JSON.stringify(q), k, only_video: vid ?? null, only_videos: ids ?? null,
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

async function mutation(name: string, params: Record<string, unknown>) {
  const { data, error } = await db().rpc(name, params);
  if (error) throw error;
  return data;
}
export async function beginIngest(vid: string, replace: boolean, token: string, mode: string, lang: string | null): Promise<"started" | "exists" | "busy"> {
  return mutation("begin_ingest", {p_vid:vid,p_replace:replace,p_token:token,p_mode:mode,p_lang:lang});
}
export async function setIngestJob(vid: string, token: string, job: string) {
  if (!await mutation("set_ingest_job", {p_vid:vid,p_token:token,p_job:job})) throw new Error("전사 작업이 변경됐다. 다시 확인해 주세요.");
}
export async function cancelIngest(vid: string, token: string) {
  await mutation("cancel_ingest", {p_vid:vid,p_token:token});
}
export async function finishIngest(vid: string, token: string, meta: Video, chunks: NewChunk[]) {
  if (!await mutation("finish_ingest", {p_vid:vid,p_token:token,p_meta:meta,p_chunks:chunks})) throw new Error("전사 작업이 변경됐다. 다시 확인해 주세요.");
}
export async function saveOutlineBatch(vid: string, revision: string | null, items: Omit<Outline,"video_id">[]) {
  if (!await mutation("save_outline_batch", {p_vid:vid,p_revision:revision,p_items:items})) throw new Error("전사문이 교체됐다. 다시 시도해 주세요.");
}
export async function saveEmbeddingBatch(vid: string, revision: string | null, items: {seq:number;vector:number[]}[]) {
  if (!await mutation("save_embedding_batch", {p_vid:vid,p_revision:revision,p_items:items})) throw new Error("전사문이 교체됐다. 다시 시도해 주세요.");
}
export async function refreshVideoStatus(vid: string, revision: string | null) {
  if (!await mutation("refresh_video_status", {p_vid:vid,p_revision:revision})) throw new Error("전사문이 교체됐다. 다시 시도해 주세요.");
}

/** 저장해 둔 전사 원본 조각. 문단을 다시 나눌 때 쓴다. */
export async function getRaw(vid: string) {
  const { data, error } = await db().from("video").select("raw").eq("id", vid).maybeSingle();
  if (error) throw error;
  return (data?.raw ?? null) as { text: string; offset: number; duration: number }[] | null;
}

/** 받아쓴 조각을 이어 붙인다. 긴 영상은 구간을 나눠 받으므로 중간 결과를 쌓아야 한다.
 *  여기까지 받은 것은 남는다 — 다음 구간에서 끊겨도 처음부터 다시 하지 않는다. */
export async function appendRaw(vid: string, pieces: {text: string; offset: number; duration: number}[]) {
  const now = (await getRaw(vid)) ?? [];
  const { error } = await db().from("video").update({ raw: [...now, ...pieces] }).eq("id", vid);
  if (error) throw error;
}

/** 세 줄 요약을 적는다. 목차와 같이 받으므로 목차를 저장한 뒤에 부른다. */
/** 등록이 실패한 순간에만 한 칸을 채운다. 성공하면 비운다.
 *  기록이 안 되어도 사용자 응답은 막지 않는다 — 부르는 쪽에서 catch 한다. */
export async function recordFailure(vid: string, failure: import("./failure").Failure | null) {
  const { error } = await db().from("video").update({ last_failure: failure }).eq("id", vid);
  if (error) throw error;
}

export async function saveTldr(vid: string, lines: string[]) {
  const { error } = await db().from("video").update({ tldr: lines }).eq("id", vid);
  if (error) throw error;
}

/** 쌓아 둔 조각을 비운다. 끝나지 않은 영상을 처음부터 다시 받아쓸 때 부른다 —
 *  안 비우면 지난번에 받은 것 뒤에 또 붙어 같은 말이 두 번 나온다. */
export async function resetRaw(vid: string) {
  const { error } = await db().from("video").update({ raw: [] }).eq("id", vid);
  if (error) throw error;
}

/** 원본으로 문단만 다시 나눈다. 목차·벡터는 무효라 같이 지워진다. */
export async function rechunk(vid: string, revision: string, chunks: NewChunk[]) {
  if (!await mutation("rechunk", { p_vid: vid, p_revision: revision, p_chunks: chunks })) {
    throw new Error("영상을 찾지 못했다");
  }
}

/** Replace a complete outline and its summary atomically for the same transcript revision. */
export async function replaceOutline(vid: string, revision: string | null, items: Omit<Outline,"video_id">[], tldr: string[]) {
  if (!await mutation("replace_outline", {p_vid:vid,p_revision:revision,p_items:items,p_tldr:tldr})) throw new Error("전사문이 교체됐다. 다시 시도해 주세요.");
}
