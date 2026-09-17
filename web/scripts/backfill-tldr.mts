/** 이미 전사해 둔 영상에 세 줄 요약을 붙인다. 한 번만 돌린다.
 *
 *    npx tsx scripts/backfill-tldr.mts          # 무엇을 할지만 보여준다
 *    npx tsx scripts/backfill-tldr.mts --go     # 실제로 부른다
 *
 *  .mts 인 이유: 최상위 await 를 쓰기 때문이다.
 *
 *  앞으로 전사하는 영상은 목차와 같은 호출에서 요약을 같이 받는다(api/outline).
 *  여기는 그 전에 들어온 것들만 메운다 — 영상 한 편에 모델을 한 번 부르므로 값이 든다.
 */
// store.ts 는 최상위 await 로 저장소를 고른다 — 스크립트에서는 Supabase 를 바로 쓴다
import { listVideos, getVideo, saveTldr } from "../src/lib/store.supabase";
import { outlineWhole } from "../src/lib/outline-whole";

async function main() {
  const go = process.argv.includes("--go");

  const videos = await listVideos();
  const todo: string[] = [];
  for (const v of videos) {
    const full = await getVideo(v.id);
    if (!full?.chunks.length) continue;   // 아직 만들다 만 것
    if (full.tldr?.length) continue;      // 이미 있음
    todo.push(v.id);
  }

  console.log(`영상 ${videos.length}편 중 ${todo.length}편에 요약이 없다.`);
  if (!go) { console.log("실제로 부르려면 --go 를 붙인다."); process.exit(0); }

  let done = 0, failed = 0;
  for (const vid of todo) {
    const v = await getVideo(vid);
    if (!v) continue;
    try {
      const whole = await outlineWhole(v.chunks);
      if (!whole.tldr.length) { console.log(`- ${vid}: 요약이 비었다`); failed++; continue; }
      await saveTldr(vid, whole.tldr);
      done++;
      console.log(`✓ ${vid} · ${whole.tldr.length}줄 · ${whole.tldr[0].slice(0, 30)}…`);
    } catch (e) {
      failed++;
      console.log(`✕ ${vid}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  console.log(`끝. 붙임 ${done}편 · 실패 ${failed}편`);
}

main();
