/** db.json(파일 저장소) → Supabase 로 옮긴다. 한 번만 돌린다.
 *
 *   node scripts/migrate.mjs
 *
 * 벡터도 같이 옮긴다 — 다시 만들면 임베딩 호출이 또 든다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const DB = path.join(process.cwd(), "..", "_old", "web", "data", "db.json");
const d = JSON.parse(await readFile(DB, "utf8"));

const videos = Object.values(d.video ?? {});
console.log(`영상 ${videos.length} · 문단 ${(d.chunk ?? []).length} · 목차 ${(d.outline ?? []).length}`);

for (const v of videos) {
  const { error } = await db.from("video").upsert({
    id: v.id, title: v.title ?? null, lang: v.lang ?? null,
    status: v.status ?? "완료", pieces: v.pieces ?? null, chars: v.chars ?? null,
  });
  if (error) throw error;
}

const chunks = (d.chunk ?? []).map((c) => ({
  id: c.id, video_id: c.video_id, seq: c.seq,
  t: c.t, t_end: c.t_end, text: c.text,
  embedding: c.vector ?? null,
}));
if (chunks.length) {
  const { error } = await db.from("chunk").upsert(chunks);
  if (error) throw error;
}

const outline = (d.outline ?? []).map((o) => ({
  video_id: o.video_id, seq: o.seq, t: o.t, label: o.label, quote: o.quote,
}));
if (outline.length) {
  const { error } = await db.from("outline").upsert(outline, { onConflict: "video_id,seq" });
  if (error) throw error;
}

const n = await db.from("chunk").select("id", { count: "exact", head: true });
console.log(`옮김. Supabase 문단 ${n.count}개`);
