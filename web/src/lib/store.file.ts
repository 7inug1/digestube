/** 파일 저장소 — Supabase 를 붙이기 전까지 쓴다.
 *  옛 파이썬 서버가 만든 db.json 을 그대로 읽는다. 쓰기는 없다. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Chunk, Hit, Outline, Video } from "./types";

// 배포에도 같이 올라가야 하므로 프로젝트 안에 둔다.
const DB = path.join(process.cwd(), "data", "db.json");

type Raw = {
  video: Record<string, Video & { chunks?: number }>;
  chunk: (Chunk & { id: string; vector?: number[] })[];
  outline: Outline[];
};

const read = async () => JSON.parse(await readFile(DB, "utf8")) as Raw;

/** Supabase 쪽과 같은 규칙 — Gemini 전사 영상만 낸다(LIBRARY_ALL=1 로 끔). */
export async function listVideos(): Promise<Video[]> {
  const d = await read();
  const all = Object.values(d.video);
  if (process.env.LIBRARY_ALL === "1") return all;
  const withOutline = new Set((d.outline ?? []).map(o => o.video_id));
  return all.filter(v => v.mode === "gemini" && withOutline.has(v.id));
}

export async function getVideo(vid: string) {
  const d = await read();
  const v = d.video[vid];
  if (!v) return null;
  return {
    ...v,
    chunks: d.chunk.filter((c) => c.video_id === vid).sort((a, b) => a.seq - b.seq),
    outline: (d.outline ?? []).filter((o) => o.video_id === vid).sort((a, b) => a.seq - b.seq),
  };
}

/** 목차가 몇 개 붙어 있는지 — 랜딩에서 "읽을 준비가 끝난" 영상만 고르려고 센다. */
export async function outlineCounts(vids: string[]) {
  const d = await read();
  const out: Record<string, number> = {};
  for (const o of d.outline ?? []) {
    if (!vids.includes(o.video_id)) continue;
    out[o.video_id] = (out[o.video_id] ?? 0) + 1;
  }
  return out;
}

export async function statsOf(vids: string[]) {
  const d = await read();
  const out: Record<string, { chunks: number; seconds: number }> = {};
  for (const c of d.chunk) {
    if (!vids.includes(c.video_id)) continue;
    const s = (out[c.video_id] ??= { chunks: 0, seconds: 0 });
    s.chunks += 1;
    s.seconds = Math.max(s.seconds, c.t_end);
  }
  return out;
}

export async function search(): Promise<Hit[]> {
  throw new Error("파일 저장소에서는 검색을 하지 않는다. Supabase 를 붙여야 한다.");
}

export async function upsertVideo() {
  throw new Error("파일 저장소는 읽기 전용이다. Supabase 키를 넣어야 한다.");
}
export async function putChunks() {
  throw new Error("파일 저장소는 읽기 전용이다. Supabase 키를 넣어야 한다.");
}

export async function putOutline() {
  throw new Error("파일 저장소는 읽기 전용이다. Supabase 키를 넣어야 한다.");
}

export async function putEmbeddings() {
  throw new Error("파일 저장소는 읽기 전용이다. Supabase 키를 넣어야 한다.");
}
export async function chunksWithoutEmbedding() {
  return [] as { seq: number; text: string }[];
}

export async function removeVideo() {
  throw new Error("파일 저장소는 읽기 전용이다.");
}

export const beginIngest = upsertVideo;
export const setIngestJob = upsertVideo;
export const cancelIngest = upsertVideo;
export const finishIngest = upsertVideo;
export const saveOutlineBatch = upsertVideo;
export const saveEmbeddingBatch = upsertVideo;
export const refreshVideoStatus = upsertVideo;

export async function getRaw() {
  return null as { text: string; offset: number; duration: number }[] | null;
}
export async function rechunk() {
  throw new Error("파일 저장소는 읽기 전용이다.");
}
