/** 목차를 다시 만든다. 붙는 자리를 고친 뒤 한 번 돌린다.
 *
 *    node --experimental-websocket --env-file=.env.local --import tsx scripts/redo-outline.mts
 *    node --experimental-websocket --env-file=.env.local --import tsx scripts/redo-outline.mts --go
 *
 *  목차는 "그 대목이 시작되는 문장"에 붙는다. 예전에는 "핵심 문장"에 붙어서,
 *  이야기가 한참 진행된 뒤에 제목이 나왔다(실측 최대 89초 늦음).
 *  요약(tldr)도 같은 호출에서 오므로 함께 새로 쓴다 — 값이 더 들지 않는다.
 */
import { listVideos, getVideo, replaceOutline, refreshVideoStatus } from "../src/lib/store.supabase";
import { outlineWhole } from "../src/lib/outline-whole";

const go = process.argv.includes("--go");
const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const videos = await listVideos();
console.log(`영상 ${videos.length}편.` + (go ? "" : " 실제로 부르려면 --go 를 붙인다."));
if (!go) process.exit(0);

let done = 0, failed = 0;
for (const v of videos) {
  const full = await getVideo(v.id);
  if (!full?.chunks.length) continue;
  try {
    const whole = await outlineWhole(full.chunks);
    if (whole.items.length < 2) { console.log(`- ${v.id}: 목차가 너무 적어 건너뜀`); failed++; continue; }
    await replaceOutline(v.id, full.revision ?? null, whole.items, whole.tldr);

    await refreshVideoStatus(v.id, full.revision ?? null);
    done++;
    const was = (full.outline ?? []).map(o => mm(o.t)).join(" ");
    const now = whole.items.map(o => mm(o.t)).join(" ");
    console.log(`✓ ${v.id}\n    전: ${was}\n    후: ${now}`);
  } catch (e) {
    failed++;
    console.log(`✕ ${v.id}: ${(e as Error).message.slice(0, 70)}`);
  }
}
console.log(`끝. 다시 만듦 ${done}편 · 실패 ${failed}편`);
