/** 코퍼스를 채운다 — 전사 → 벡터 → 목차까지 한 편씩.
 *
 *   node --env-file=.env.local scripts/fill.mjs <vid> <vid> ...
 *
 * 배포(Vercel 무료)는 한 요청이 60초를 못 넘어 generate 를 못 쓴다. 로컬은
 * 제한이 없고 저장소는 같은 Supabase 라, 코퍼스는 여기서 채운다.
 * 한 편씩 돈다 — 동시에 걸면 Supadata 무료 플랜이 429 로 막는다.
 */
const BASE = "http://127.0.0.1:3000";
// 무료 플랜은 동시 요청을 막는다(429 limit-exceeded). 한 편씩 돈다.
const PAIR = 1;
const GAP_MS = 15000;   // 편 사이 간격 — 429 를 덜 만나게

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? `${r.status}`);
  return d;
}

async function one(vid) {
  const t0 = Date.now();
  let d = await post("/api/ingest", { url: `https://www.youtube.com/watch?v=${vid}` });
  while (d.state === "working") {
    await new Promise((s) => setTimeout(s, 5000));
    const r = await fetch(`${BASE}/api/ingest?job=${d.job}&vid=${d.vid}`);
    const next = await r.json();
    if (!r.ok) throw new Error(next.error ?? `${r.status}`);
    d = next.state === "working" ? d : next;
  }
  for (let i = 0; i < 10; i++) {
    const e = await post("/api/embed", { vid });
    if (!e.left) break;
  }
  const o = await post("/api/outline", { vid }).catch((e) => ({ error: e.message }));
  const sec = Math.round((Date.now() - t0) / 1000);
  return `${vid} · 문단 ${d.chunks} · ${d.chars}자 · 목차 ${o.kept ?? "실패"}/${o.n ?? "-"} · ${sec}초`;
}

const vids = process.argv.slice(2);
console.log(`${vids.length}편 · ${PAIR}편씩 동시에\n`);
for (let i = 0; i < vids.length; i += PAIR) {
  const part = vids.slice(i, i + PAIR);
  const out = await Promise.allSettled(part.map(one));
  out.forEach((r, k) =>
    console.log(r.status === "fulfilled" ? `  ✓ ${r.value}` : `  ✗ ${part[k]} — ${r.reason.message}`));
  await new Promise((s) => setTimeout(s, GAP_MS));
}
console.log("\n끝");
