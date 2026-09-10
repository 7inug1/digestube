/** Rechunk all stored transcripts without retranscribing.
 * node --experimental-websocket --env-file=.env.local --import tsx scripts/rechunk-library.ts [--apply]
 * Back up changed videos, retain transcription provenance, regenerate dependent data.
 */
import {mkdir,writeFile} from "node:fs/promises";
import {createClient} from "@supabase/supabase-js";
import {chunk,stats} from "../src/lib/chunker";
import type {Video,Chunk} from "../src/lib/types";
import assert from "node:assert/strict";

async function main() {
  const apply=process.argv.includes("--apply");
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const {data:videos,error}=await db.from("video").select("*").order("id");
  if(error)throw new Error(error.message);
  const root=`data/repairs/library-${Date.now()}`;
  await mkdir(root,{recursive:true});
  const summary:unknown[]=[];
  const normalize=(s:string)=>s.replace(/\s+/gu," ").trim();
  for(const old of videos as Video[]) {
    const vid=old.id;
    const {data,error}=await db.from("chunk").select("*").eq("video_id",vid).order("seq");
    if(error)throw new Error(error.message);
    const before=data as (Chunk & {id:string})[];
    if(!before.length)throw new Error(`Empty stored transcript: ${vid}`);
    const after=chunk(before.map(c=>({text:c.text,offset:c.t*1000,duration:(c.t_end-c.t)*1000})));
    assert.equal(normalize(after.map(c=>c.text).join(" ")),normalize(before.map(c=>c.text).join(" ")),`Transcript changed: ${vid}`);
    const changed=JSON.stringify(before.map(c=>c.text))!==JSON.stringify(after.map(c=>c.text));
    const record={vid,changed,before:stats(before),after:stats(after)};
    summary.push(record);console.log(JSON.stringify(record));
    if(!apply)continue;
    if(changed) {
      const o=await db.from("outline").select("*").eq("video_id",vid).order("seq");
      const b=await db.from("bookmark").select("*").in("chunk_id",before.map(c=>c.id));
      if(o.error || b.error)throw new Error("Cannot back up related records");
      if(b.data.length)throw new Error(`Bookmarks require remapping: ${vid}`);
      await writeFile(`${root}/${vid}.json`,JSON.stringify({video:old,chunk:before,outline:o.data,bookmark:b.data},null,2));
      const token=crypto.randomUUID();
      const reservation=await db.rpc("begin_ingest",{p_vid:vid,p_replace:true,p_token:token,p_mode:old.mode ?? null,p_lang:old.requested_lang ?? null});
      if(reservation.error || reservation.data!=="started")throw new Error(`Could not reserve ${vid}`);
      try {
        const current=await db.from("video").select("revision").eq("id",vid).single();
        if(current.error || current.data.revision !== old.revision)throw new Error(`Concurrent change: ${vid}`);
        const saved=await db.rpc("finish_ingest",{p_vid:vid,p_token:token,p_meta:{id:vid,title:old.title,channel:old.channel,lang:old.lang,pieces:old.pieces,chars:old.chars},p_chunks:after});
        if(saved.error || saved.data!==true)throw new Error(saved.error?.message ?? "Stale data");
        const restored=await db.from("video").update({transcribed_at:old.transcribed_at}).eq("id",vid).eq("revision",token).select("id");
        if(restored.error || restored.data.length!==1)throw new Error("Could not restore provenance date");
      } catch(e) {await db.rpc("cancel_ingest",{p_vid:vid,p_token:token});throw e;}
    }
    // Also resume any work left behind by an interrupted previous run.
    const base=process.env.DIGESTUBE_BASE_URL ?? "https://digestube-v2.vercel.app";
    for(const phase of ["outline","embed"]) {
      let left=0;
      do {
        const r=await fetch(`${base}/api/${phase}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({vid}),signal:AbortSignal.timeout(65000)});
        const result=await r.json();if(!r.ok)throw new Error(result.error ?? `${phase} failed`);
        left=result.left;
        if(left && !result.done)throw new Error("Processing stopped making progress");
        console.log(vid,phase,JSON.stringify(result));
      } while(left);
    }
    const saved=await db.from("chunk").select("text,embedding").eq("video_id",vid).order("seq");
    const titles=await db.from("outline").select("seq").eq("video_id",vid);
    const meta=await db.from("video").select("mode,lang,requested_lang,transcribed_at,status").eq("id",vid).single();
    if(saved.error || titles.error || meta.error)throw new Error("Verification read failed");
    assert.equal(normalize(saved.data.map(c=>c.text).join(" ")),normalize(before.map(c=>c.text).join(" ")));
    assert.equal(saved.data.length,titles.data.length);
    assert.ok(saved.data.every(c=>c.embedding!==null));
    assert.equal(meta.data.status,"완료");
    for(const k of ["mode","lang","requested_lang","transcribed_at"] as const)assert.equal(meta.data[k],old[k]);
    console.log("VERIFIED",vid);
    await writeFile(`${root}/summary.json`,JSON.stringify(summary,null,2));
  }
  await writeFile(`${root}/summary.json`,JSON.stringify(summary,null,2));
  console.log(`All ${videos.length} videos ${apply ? "applied and verified" : "planned"}. Report: ${root}/summary.json`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
