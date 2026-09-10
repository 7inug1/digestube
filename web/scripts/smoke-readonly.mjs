/** Existing-data smoke check; never reingests or replaces a video.
 * node scripts/smoke-readonly.mjs [http://localhost:3000] [video-id]
 */
import assert from "node:assert/strict";
const base=process.argv[2] ?? "http://localhost:3000";
const vid=process.argv[3] ?? "JRJd1ZrHmgg";
for(const path of ["/videos",`/videos/${vid}`,`/api/search?q=${encodeURIComponent("친절한 사람")}`]) {
  const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,200,path);
  if(path.startsWith("/api")) assert.ok(Array.isArray(await r.json()));
  console.log(`PASS ${path}`);
}
const r=await fetch(base+"/api/ingest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:`https://youtu.be/${vid}`})});
assert.equal(r.status,409);
assert.equal((await r.json()).code,"VIDEO_EXISTS");
console.log("PASS duplicate rejected before transcription");
