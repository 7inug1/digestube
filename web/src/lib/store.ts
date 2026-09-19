/** 저장소 — 부르는 쪽은 이 파일만 안다.
 *
 *  Supabase 키가 있으면 Supabase 를, 없으면 파일(db.json)을 쓴다.
 *  프로젝트를 만들기 전에도 화면이 돌아가야 해서 둘을 같이 둔다.
 *  키가 채워지면 이 파일은 자동으로 Supabase 쪽을 고른다.
 */
const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const impl = useSupabase
  ? await import("./store.supabase")
  : await import("./store.file");

export const { listVideos, getVideo, statsOf, outlineCounts, search, upsertVideo, putChunks, putOutline, putEmbeddings, chunksWithoutEmbedding, removeVideo, libraryIds, libraryCount, addToLibrary, removeFromLibrary, videosByIds, shareOf, setShareName, startShare, stopShare, userByShare, beginIngest, setIngestJob, cancelIngest, finishIngest, saveOutlineBatch, replaceOutline, saveEmbeddingBatch, refreshVideoStatus, getRaw, appendRaw, resetRaw, saveTldr, rechunk } = impl;
export type { Chunk, Hit, Outline, Video } from "./types";
