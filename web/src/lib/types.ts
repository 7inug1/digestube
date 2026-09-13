export type Video = {
  id: string;
  title?: string | null;
  channel?: string | null;
  lang?: string | null;
  mode?: "native" | "generate" | "gemini" | null;
  requested_lang?: string | null;
  transcribed_at?: string | null;
  revision?: string | null;
  ingest_token?: string | null;
  pending_mode?: "native" | "generate" | "gemini" | null;
  pending_lang?: string | null;
  status?: string | null;
  job?: string | null;
  chars?: number | null;
  pieces?: number | null;
  /** 전사 원본 조각 — 재청킹용 */
  raw?: unknown;
};

/** 아직 저장되기 전의 문단 — chunker 가 만든 모양 */
export type NewChunk = { t: number; t_end: number; text: string };

export type Chunk = {
  video_id: string; seq: number; t: number; t_end: number; text: string;
};

export type Outline = {
  video_id: string; seq: number; t: number; label: string; quote: string;
  source?: "model" | "fallback"; attempts?: number; failure?: string | null;
};

export type Hit = Chunk & { score: number };
