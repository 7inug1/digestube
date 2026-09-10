export type Video = {
  id: string;
  title?: string | null;
  channel?: string | null;
  lang?: string | null;
  status?: string | null;
  job?: string | null;
  chars?: number | null;
  pieces?: number | null;
};

/** 아직 저장되기 전의 문단 — chunker 가 만든 모양 */
export type NewChunk = { t: number; t_end: number; text: string };

export type Chunk = {
  video_id: string; seq: number; t: number; t_end: number; text: string;
};

export type Outline = {
  video_id: string; seq: number; t: number; label: string; quote: string;
};

export type Hit = Chunk & { score: number };
