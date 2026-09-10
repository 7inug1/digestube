/** Dry run: tsx --env-file=.env.local scripts/repair-chunking.ts
 * Apply to the reported video only: add --apply. Source fixture preserves the stored transcript.
 * Caption-level originals are unavailable, so timing uses old paragraph ranges. Backups stay in ignored data/repairs/.
 */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {prepareTranscript} from "../src/lib/transcript";
import {stats} from "../src/lib/chunker";

async function main() {
  const source=JSON.parse(await readFile("tests/fixtures/chunking-existing.json","utf8"));
  const prepared=prepareTranscript(source,source.requested_lang);
  console.log("After:",stats(prepared.chunks));
  for(const c of prepared.chunks) console.log(JSON.stringify({t:c.t,t_end:c.t_end,chars:c.text.length,first:c.text.slice(0,55),last:c.text.slice(-90)}));
  if(!process.argv.includes("--apply"))return;
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const vid=source.video_id;
  const backup:Record<string,unknown[]>={};
  for(const table of ["video","chunk","outline","bookmark"]) {
    let query=db.from(table).select("*");
    if(table==="bookmark") query=query.in("chunk_id", (backup.chunk as {id:string}[]).map(c=>c.id));
    else query=query.eq(table==="video" ? "id" : "video_id",vid);
    const {data,error}=await query;
    if(error)throw new Error(error.message);
    backup[table]=data ?? [];
  }
  if(backup.video.length!==1)throw new Error("Expected existing video");
  const old=backup.video[0] as Record<string,unknown>;
  if(old.revision !== source.expected_revision)throw new Error("Snapshot is outdated; refusing to replace changed data");
  if(backup.bookmark.length)throw new Error("Bookmarks exist: repair requires preserving their targets first");
  await mkdir("data/repairs",{recursive:true});
  const path=`data/repairs/${vid}-${Date.now()}.json`;
  await writeFile(path,JSON.stringify(backup,null,2));
  console.log("Backup:",path);
  const token=crypto.randomUUID();
  const reservation=await db.rpc("begin_ingest",{p_vid:vid,p_replace:true,p_token:token,p_mode:source.mode,p_lang:source.requested_lang});
  if(reservation.error || reservation.data!=="started")throw new Error("Could not reserve repair");
  try {
    const current=await db.from("video").select("revision").eq("id",vid).single();
    if(current.error || current.data.revision !== source.expected_revision)throw new Error("Video changed before repair");
    const result=await db.rpc("finish_ingest",{p_vid:vid,p_token:token,p_meta:{id:vid,title:old.title,channel:old.channel,lang:source.lang,pieces:old.pieces,chars:old.chars},p_chunks:prepared.chunks});
    if(result.error || result.data!==true)throw new Error(result.error?.message ?? "Stale repair");
    // Rechunking is not a new transcription: preserve its original provenance date.
    const restored=await db.from("video").update({transcribed_at:old.transcribed_at}).eq("id",vid).eq("revision",token).select("id");
    if(restored.error || restored.data?.length!==1)throw new Error("Could not restore transcription date");
  } catch(e) {
    await db.rpc("cancel_ingest",{p_vid:vid,p_token:token});throw e;
  }
  const base=process.env.DIGESTUBE_BASE_URL ?? "https://digestube-v2.vercel.app";
  for(const phase of ["outline","embed"]) {
    let left;
    do {
      const r=await fetch(`${base}/api/${phase}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({vid}),signal:AbortSignal.timeout(65000)});
      const d=await r.json();if(!r.ok)throw new Error(d.error ?? "Processing failed");
      console.log(phase,d);left=d.left;
    } while(left);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
